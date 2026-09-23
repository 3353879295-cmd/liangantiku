import type { StorageAdapter } from '../types/domain';
import {
  type AccountOutboxState,
  type AccountProfileSnapshot,
  type AccountSyncRequest,
  type SyncCommand,
  type SyncCommandAction,
  type SyncRevisionDomain,
} from '../types/account-sync';

export const ACCOUNT_OUTBOX_KEY = 'grain-practice:account-outbox';

const COALESCIBLE_ACTIONS = new Set<SyncCommandAction>([
  'updateProfile',
  'updatePreferences',
  'saveActiveSession',
]);
const SYNC_ACTIONS = new Set<SyncCommandAction>([
  'updateProfile',
  'updatePreferences',
  'saveActiveSession',
  'recordPractice',
  'setFavorite',
  'markMastered',
]);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const PROFILE_FIELDS = new Set<keyof AccountProfileSnapshot>([
  'nickname',
  'avatarUrl',
  'selectedCertificateKey',
  'dailyGoal',
  'answerTheme',
  'answerRevealMode',
]);

export const isSyncCommand = (value: unknown): value is SyncCommand => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Partial<SyncCommand>;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.action === 'string' &&
    SYNC_ACTIONS.has(item.action) &&
    item.schemaVersion === 1 &&
    Number.isInteger(item.expectedRevision) &&
    Number(item.expectedRevision) >= 0 &&
    Number.isFinite(item.createdAt) &&
    (item.state === 'pending' || item.state === 'sending') &&
    (item.changedFields === undefined ||
      (Array.isArray(item.changedFields) &&
        item.changedFields.every(
          (field) =>
            typeof field === 'string' && PROFILE_FIELDS.has(field as keyof AccountProfileSnapshot),
        )))
  );
};

const domainFor = (action: SyncCommandAction): SyncRevisionDomain =>
  action === 'updateProfile' || action === 'updatePreferences' ? 'profile' : 'progress';

export const revisionDomainForCommand = domainFor;

export class SyncOutbox {
  private state: AccountOutboxState;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = () =>
      `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  ) {
    this.state = this.read();
  }

  private read(): AccountOutboxState {
    const raw = this.storage.get<unknown>(ACCOUNT_OUTBOX_KEY);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return { schemaVersion: 1, commands: [] };
    const stored = raw as Partial<AccountOutboxState>;
    if (
      stored.schemaVersion !== 1 ||
      !Array.isArray(stored.commands) ||
      !stored.commands.every(isSyncCommand) ||
      (stored.blocked !== undefined && typeof stored.blocked !== 'boolean')
    ) {
      return { schemaVersion: 1, commands: [] };
    }
    // A request cannot still be in flight after process restart.
    const state: AccountOutboxState = {
      schemaVersion: 1,
      commands: stored.commands.map((command) => ({ ...clone(command), state: 'pending' })),
      ...(stored.blocked ? { blocked: true } : {}),
    };
    this.storage.set(ACCOUNT_OUTBOX_KEY, state);
    return state;
  }

  private persist(): void {
    this.storage.set(ACCOUNT_OUTBOX_KEY, clone(this.state));
  }

  list(): readonly SyncCommand[] {
    return clone(this.state.commands);
  }

  get size(): number {
    return this.state.commands.length;
  }

  get isBlocked(): boolean {
    return this.state.blocked === true;
  }

  enqueue(
    request: Exclude<
      AccountSyncRequest,
      { action: 'bootstrap' | 'deleteAccount' | 'clearLearningData' }
    > & { changedFields?: readonly (keyof AccountProfileSnapshot)[] },
  ): SyncCommand {
    const action = request.action;
    if (!this.isBlocked && COALESCIBLE_ACTIONS.has(action)) {
      const existing = [...this.state.commands]
        .reverse()
        .find((command) => command.action === action && command.state === 'pending');
      if (existing) {
        const changedFields =
          request.changedFields && existing.changedFields
            ? [...new Set([...(existing.changedFields ?? []), ...(request.changedFields ?? [])])]
            : undefined;
        const replacement: SyncCommand = {
          ...clone(request),
          id: existing.id,
          createdAt: existing.createdAt,
          state: 'pending',
          ...(changedFields ? { changedFields } : {}),
        };
        if (!changedFields) Reflect.deleteProperty(replacement, 'changedFields');
        const index = this.state.commands.findIndex((command) => command.id === existing.id);
        this.state.commands[index] = replacement;
        this.persist();
        return clone(replacement);
      }
    }
    const command: SyncCommand = {
      ...clone(request),
      id: this.createId(),
      createdAt: this.now(),
      state: 'pending',
    };
    this.state.commands.push(command);
    this.persist();
    return clone(command);
  }

  takeNext(): SyncCommand | null {
    if (this.isBlocked) return null;
    const command = this.state.commands.find((item) => item.state === 'pending');
    if (!command) return null;
    command.state = 'sending';
    this.persist();
    return clone(command);
  }

  markPending(id: string): void {
    const command = this.state.commands.find((item) => item.id === id);
    if (!command) return;
    command.state = 'pending';
    this.persist();
  }

  /** An invalidated in-flight request must be replayable after account recovery. */
  resetSending(): void {
    let changed = false;
    for (const command of this.state.commands) {
      if (command.state === 'sending') {
        command.state = 'pending';
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  block(): void {
    for (const command of this.state.commands) command.state = 'pending';
    this.state.blocked = true;
    this.persist();
  }

  /** Resume only after bootstrap verifies the same account and its latest revisions. */
  resumeAfterConflict(profileRevision: number, progressRevision: number): void {
    this.state.blocked = false;
    this.rebase(profileRevision, progressRevision);
  }

  remove(id: string): void {
    const next = this.state.commands.filter((command) => command.id !== id);
    if (next.length === this.state.commands.length) return;
    this.state.commands = next;
    this.persist();
  }

  clear(): void {
    this.state = { schemaVersion: 1, commands: [] };
    this.persist();
  }

  restore(commands: readonly SyncCommand[]): boolean {
    if (!commands.every(isSyncCommand)) return false;
    this.state = {
      schemaVersion: 1,
      commands: commands.map((command) => ({ ...clone(command), state: 'pending' })),
    };
    this.persist();
    return true;
  }

  mergeProfileChanges(
    cloudProfile: AccountProfileSnapshot,
    previousProfile: AccountProfileSnapshot,
  ): void {
    const projection = clone(cloudProfile);
    const base = clone(previousProfile);
    for (const command of this.state.commands) {
      if (command.action !== 'updateProfile' && command.action !== 'updatePreferences') continue;
      const fields: readonly (keyof AccountProfileSnapshot)[] =
        command.action === 'updateProfile'
          ? ['nickname', 'avatarUrl']
          : ['selectedCertificateKey', 'dailyGoal', 'answerTheme', 'answerRevealMode'];
      const values = Object.fromEntries(
        fields.map((field) => [field, (command as unknown as AccountProfileSnapshot)[field]]),
      ) as Partial<AccountProfileSnapshot>;
      const changed =
        command.changedFields?.filter((field) => fields.includes(field)) ??
        fields.filter((field) => values[field] !== base[field]);
      // Legacy deltas compare successive local payloads, never the merged cloud projection.
      Object.assign(base, values);
      for (const field of changed) Object.assign(projection, { [field]: values[field] });
      if (command.state === 'pending') {
        Object.assign(
          command,
          Object.fromEntries(fields.map((field) => [field, projection[field]])),
          { changedFields: [...changed] },
        );
      }
    }
    this.persist();
  }

  /** Reassign only commands that have not been sent, after a cloud revision advances. */
  rebase(profileRevision: number, progressRevision: number): void {
    if (this.isBlocked) return;
    let profile = profileRevision;
    let progress = progressRevision;
    for (const command of this.state.commands) {
      const domain = domainFor(command.action);
      if (command.state === 'pending')
        command.expectedRevision = domain === 'profile' ? profile : progress;
      if (domain === 'profile') profile += 1;
      else progress += 1;
    }
    this.persist();
  }
}

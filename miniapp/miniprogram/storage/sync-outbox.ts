import type { StorageAdapter } from '../types/domain';
import {
  type AccountOutboxState,
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

const isCommand = (value: unknown): value is SyncCommand => {
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
    (item.state === 'pending' || item.state === 'sending')
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
      !stored.commands.every(isCommand)
    ) {
      return { schemaVersion: 1, commands: [] };
    }
    // A request cannot still be in flight after process restart.
    const state: AccountOutboxState = {
      schemaVersion: 1,
      commands: stored.commands.map((command) => ({ ...clone(command), state: 'pending' })),
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

  enqueue(
    request: Exclude<
      AccountSyncRequest,
      { action: 'bootstrap' | 'deleteAccount' | 'clearLearningData' }
    >,
  ): SyncCommand {
    const action = request.action;
    if (COALESCIBLE_ACTIONS.has(action)) {
      const existing = [...this.state.commands]
        .reverse()
        .find((command) => command.action === action && command.state === 'pending');
      if (existing) {
        const replacement: SyncCommand = {
          ...clone(request),
          id: existing.id,
          createdAt: existing.createdAt,
          state: 'pending',
        };
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

  /** Reassign only commands that have not been sent, after a cloud revision advances. */
  rebase(profileRevision: number, progressRevision: number): void {
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

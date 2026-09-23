import { createAccountCacheEnvelope } from '../storage/progress-repository';
import type { ProgressRepository } from '../storage/progress-repository';
import type { SyncOutbox } from '../storage/sync-outbox';
import {
  ACCOUNT_SYNC_SCHEMA_VERSION,
  type AccountCacheEnvelope,
  type AccountSyncCommandInput,
  type AccountSyncRequest,
  type AccountSyncSnapshot,
  type AccountSyncState,
  type ProgressScope,
  type SyncCommand,
} from '../types/account-sync';

export interface AccountSyncCaller {
  call(
    request: Exclude<AccountSyncRequest, { action: 'deleteAccount' | 'clearLearningData' }>,
  ): Promise<AccountSyncSnapshot>;
}
export interface CloudSyncOptions {
  getScope: () => ProgressScope;
  onAccountVerified?: () => void;
  isClearPending?: () => boolean;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const UNAVAILABLE_NOTICE = '记录已保存在本机，联网后会自动重试保存。';
const IDENTITY_NOTICE = '当前账号与本机待同步记录不一致，已保留本机记录。';
const requestFor = (command: SyncCommand) => {
  const request = clone(command) as unknown as Record<string, unknown>;
  Reflect.deleteProperty(request, 'id');
  Reflect.deleteProperty(request, 'createdAt');
  Reflect.deleteProperty(request, 'state');
  Reflect.deleteProperty(request, 'changedFields');
  return request as unknown as Exclude<
    AccountSyncRequest,
    { action: 'bootstrap' | 'deleteAccount' | 'clearLearningData' }
  >;
};
const envelopeFor = (snapshot: AccountSyncSnapshot): AccountCacheEnvelope => ({
  cacheVersion: 1,
  ...clone(snapshot),
});
const isErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;
const preferenceSnapshotMatches = (command: SyncCommand, snapshot: AccountSyncSnapshot): boolean =>
  command.action !== 'updatePreferences' ||
  (snapshot.profile.selectedCertificateKey === command.selectedCertificateKey &&
    snapshot.profile.dailyGoal === command.dailyGoal &&
    snapshot.profile.answerTheme === command.answerTheme &&
    snapshot.profile.answerRevealMode === command.answerRevealMode);

export class CloudSyncService {
  private running: Promise<boolean> | null = null;
  private state: AccountSyncState = { status: 'idle', pendingCount: 0, notice: null };
  private readonly maxAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private generation = 0;
  private verifiedPrefix: string | null = null;
  private runningGeneration: number | null = null;
  private refreshRequested = false;
  private bootstrapping = false;
  private restoringIdentity = false;
  constructor(
    private readonly client: AccountSyncCaller,
    private readonly repository: ProgressRepository,
    private readonly outbox: SyncOutbox,
    private readonly options: CloudSyncOptions,
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sleep = options.sleep ?? delay;
    this.repository.recoverAccountSwitch(this.outbox);
    this.refreshState(this.outbox.size > 0 ? 'pending' : 'idle');
  }
  getState(): AccountSyncState {
    return clone(this.state);
  }
  getLastSyncedAt(): string | null {
    return this.cache()?.syncedAt ?? null;
  }
  getAvatarUploadPathPrefix(): string | null {
    return this.cache()?.avatarUploadPathPrefix || null;
  }
  getConfirmedAvatarUrl(): string | null {
    return this.cache()?.profile.avatarUrl ?? null;
  }
  suspend(): void {
    this.generation += 1;
    this.verifiedPrefix = null;
    this.restoringIdentity = false;
    this.outbox.resetSending();
    this.refreshState(this.outbox.size === 0 ? 'idle' : 'pending', null);
  }
  private refreshState(
    status: AccountSyncState['status'] = this.state.status,
    notice = this.state.notice,
  ): void {
    this.state = { status, pendingCount: this.outbox.size, notice };
  }
  private assertAccountScope(): boolean {
    return this.options.getScope() === 'account' || this.restoringIdentity;
  }
  private valid(generation: number): boolean {
    return generation === this.generation && this.assertAccountScope();
  }
  private cache(): AccountCacheEnvelope | null {
    return this.repository.loadAccountCache();
  }
  private saveSnapshot(snapshot: AccountSyncSnapshot, keepReview = true): void {
    const next = envelopeFor(snapshot);
    const cache = this.cache();
    const session = cache?.progress.session;
    if (
      keepReview &&
      cache !== null &&
      session?.status === 'submitted' &&
      cache.avatarUploadPathPrefix &&
      cache.avatarUploadPathPrefix === next.avatarUploadPathPrefix &&
      next.progress.session === null &&
      next.progressRevision >= cache.progressRevision &&
      (['answered', 'correct', 'durationMs'] as const).every(
        (key) => next.progress.summary[key] >= cache.progress.summary[key],
      )
    ) {
      next.progress.session = session;
      // Preserve this report's local marker so viewing it cannot count it twice.
      if (cache.progress.recordedSessionIds.includes(session.id)) {
        next.progress.recordedSessionIds = [
          ...new Set([...next.progress.recordedSessionIds, session.id]),
        ];
      }
    }
    this.repository.saveAccountCache(next);
  }
  private updateMetadata(snapshot: AccountSyncSnapshot): void {
    const current = this.cache();
    if (!current) return this.saveSnapshot(snapshot);
    this.repository.saveAccountCache(
      createAccountCacheEnvelope(current.progress, {
        profileRevision: snapshot.profileRevision,
        progressRevision: snapshot.progressRevision,
        avatarUploadPathPrefix: snapshot.avatarUploadPathPrefix,
        syncedAt: snapshot.syncedAt,
        profile: snapshot.profile,
      }),
    );
  }
  private commandInput(command: AccountSyncCommandInput, expectedRevision: number) {
    return {
      ...clone(command),
      schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
      expectedRevision,
    } as Exclude<
      AccountSyncRequest,
      { action: 'bootstrap' | 'deleteAccount' | 'clearLearningData' }
    >;
  }
  enqueue(command: AccountSyncCommandInput): boolean {
    if (this.options.getScope() !== 'account') return false;
    const profile = command.action === 'updateProfile' || command.action === 'updatePreferences';
    if (this.options.isClearPending?.() && !profile) return false;
    const cache = this.cache();
    if (!cache) return false;
    this.outbox.enqueue(
      this.commandInput(command, profile ? cache.profileRevision : cache.progressRevision),
    );
    this.outbox.rebase(cache.profileRevision, cache.progressRevision);
    this.refreshState('pending', null);
    return true;
  }
  replaceAfterLearningClear(snapshot: AccountSyncSnapshot): void {
    this.suspend();
    this.saveSnapshot(snapshot, false);
    this.verifiedPrefix = snapshot.avatarUploadPathPrefix || null;
    this.repository.removeSequentialSessions('account');
    this.outbox.rebase(snapshot.profileRevision, snapshot.progressRevision);
    this.refreshState(this.outbox.size === 0 ? 'idle' : 'pending', null);
  }
  async bootstrap(restoreIdentity = false): Promise<boolean> {
    if (restoreIdentity) this.restoringIdentity = true;
    const generation = this.generation;
    try {
      return await this.start(true);
    } finally {
      if (generation === this.generation) this.restoringIdentity = false;
    }
  }
  async retry(): Promise<void> {
    await this.start(true);
  }
  async process(): Promise<void> {
    if (this.options.isClearPending?.()) return;
    await this.start(this.verifiedPrefix === null);
  }
  private start(pull: boolean): Promise<boolean> {
    if (!this.assertAccountScope()) return Promise.resolve(false);
    if (this.options.isClearPending?.() && !pull) {
      this.refreshState(this.outbox.size === 0 ? 'idle' : 'pending', null);
      return Promise.resolve(false);
    }
    if (this.running) {
      if (this.runningGeneration !== this.generation)
        return this.running.then(() => this.start(pull));
      if (pull && !this.bootstrapping) this.refreshRequested = true;
      return this.running;
    }
    const generation = this.generation;
    this.runningGeneration = generation;
    this.running = this.run(generation, pull).finally(() => {
      if (this.valid(generation)) {
        this.outbox.resetSending();
        if (this.state.status === 'syncing') this.refreshState('pending', null);
      }
      this.running = null;
      this.runningGeneration = null;
      this.refreshRequested = false;
    });
    return this.running;
  }
  private async run(generation: number, pull: boolean): Promise<boolean> {
    try {
      let needsPull = pull || this.verifiedPrefix === null;
      do {
        this.refreshRequested = false;
        if (needsPull) {
          const snapshot = await this.fetchBootstrap(generation);
          if (!snapshot || !this.acceptBootstrap(snapshot, generation)) return false;
        }
        if (!this.valid(generation)) return false;
        if (this.options.isClearPending?.()) return true;
        if (this.outbox.size === 0) this.refreshState('idle', null);
        else await this.drain(generation);
        // Upload failure does not prevent login after a verified bootstrap.
        if (!this.valid(generation)) return false;
        needsPull = this.refreshRequested;
      } while (needsPull);
      return true;
    } catch (error) {
      if (this.valid(generation))
        this.refreshState(
          'failed',
          isErrorCode(error, 'SCHEMA_INCOMPATIBLE')
            ? '云端学习记录格式不兼容，请更新小程序后重试。'
            : UNAVAILABLE_NOTICE,
        );
      return false;
    }
  }
  private async fetchBootstrap(generation: number): Promise<AccountSyncSnapshot | null> {
    this.bootstrapping = true;
    try {
      const snapshot = await this.client.call({
        action: 'bootstrap',
        schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
      });
      return this.valid(generation) ? snapshot : null;
    } finally {
      this.bootstrapping = false;
    }
  }
  private acceptBootstrap(snapshot: AccountSyncSnapshot, generation: number): boolean {
    if (!this.valid(generation)) return false;
    let cache = this.cache();
    const cachedPrefix = cache?.avatarUploadPathPrefix ?? '';
    const cloudPrefix = snapshot.avatarUploadPathPrefix;
    if (!cloudPrefix && (cachedPrefix || this.outbox.size > 0)) {
      this.refreshState('failed', '云端账号服务需要更新，本机记录已保留。');
      return false;
    }
    if (cloudPrefix && cachedPrefix !== cloudPrefix) {
      this.repository.switchAccount(snapshot, this.outbox);
      cache = this.cache();
    }
    this.verifiedPrefix = cloudPrefix || null;
    this.outbox.mergeProfileChanges(snapshot.profile, cache?.profile ?? snapshot.profile);
    if (this.outbox.isBlocked)
      this.outbox.resumeAfterConflict(snapshot.profileRevision, snapshot.progressRevision);
    if (this.outbox.size === 0) this.saveSnapshot(snapshot);
    else {
      this.updateMetadata(snapshot);
      this.outbox.rebase(snapshot.profileRevision, snapshot.progressRevision);
    }
    this.refreshState(this.outbox.size === 0 ? 'idle' : 'pending', null);
    this.options.onAccountVerified?.();
    return true;
  }
  private commandStillPresent(command: SyncCommand, generation: number): boolean {
    return this.valid(generation) && this.outbox.list().some((item) => item.id === command.id);
  }
  private async drain(generation: number): Promise<boolean> {
    while (this.valid(generation) && !this.options.isClearPending?.()) {
      const command = this.outbox.takeNext();
      if (!command) {
        this.refreshState('idle', null);
        return true;
      }
      this.refreshState('syncing', null);
      const snapshot = await this.sendWithRecovery(command, generation);
      if (
        !snapshot ||
        !this.commandStillPresent(command, generation) ||
        this.options.isClearPending?.()
      )
        return false;
      this.outbox.remove(command.id);
      this.outbox.mergeProfileChanges(snapshot.profile, this.cache()?.profile ?? snapshot.profile);
      this.outbox.rebase(snapshot.profileRevision, snapshot.progressRevision);
      if (this.outbox.size === 0) this.saveSnapshot(snapshot);
      else this.updateMetadata(snapshot);
      this.refreshState(this.outbox.size === 0 ? 'idle' : 'pending', null);
    }
    return false;
  }
  private async sendWithRecovery(
    command: SyncCommand,
    generation: number,
  ): Promise<AccountSyncSnapshot | null> {
    for (
      let recovery = 0;
      recovery < 3 &&
      this.commandStillPresent(command, generation) &&
      !this.options.isClearPending?.();
      recovery += 1
    ) {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const snapshot = await this.client.call(requestFor(command));
          if (!this.commandStillPresent(command, generation) || this.options.isClearPending?.())
            return null;
          if (this.verifiedPrefix !== snapshot.avatarUploadPathPrefix) {
            this.verifiedPrefix = null;
            this.outbox.markPending(command.id);
            this.refreshState('failed', IDENTITY_NOTICE);
            return null;
          }
          if (!preferenceSnapshotMatches(command, snapshot)) {
            this.outbox.markPending(command.id);
            this.refreshState('failed', '云端未确认本次设置，本机记录已保留。');
            return null;
          }
          return snapshot;
        } catch (error) {
          if (!this.commandStillPresent(command, generation) || this.options.isClearPending?.())
            return null;
          if (isErrorCode(error, 'REVISION_CONFLICT')) {
            this.outbox.markPending(command.id);
            break;
          }
          if (
            isErrorCode(error, 'SCHEMA_INCOMPATIBLE') ||
            isErrorCode(error, 'ACCOUNT_DELETING') ||
            attempt === this.maxAttempts
          ) {
            this.outbox.markPending(command.id);
            this.refreshState('failed', UNAVAILABLE_NOTICE);
            return null;
          }
          await this.sleep(250 * 2 ** (attempt - 1));
          if (!this.commandStillPresent(command, generation) || this.options.isClearPending?.())
            return null;
        }
      }
      const latest = await this.fetchBootstrap(generation);
      if (
        !latest ||
        !this.acceptBootstrap(latest, generation) ||
        !this.commandStillPresent(command, generation)
      )
        return null;
      // rebase replaces the persisted command; never resend the stale immutable request copy.
      const rebased = this.outbox.takeNext();
      if (!rebased || rebased.id !== command.id) return null;
      command = rebased;
    }
    if (this.commandStillPresent(command, generation)) {
      this.outbox.markPending(command.id);
      this.refreshState('failed', '云端记录持续更新，本机记录已保留，将自动重试。');
    }
    return null;
  }
}

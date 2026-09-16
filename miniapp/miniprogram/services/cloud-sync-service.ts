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
  call(request: Extract<AccountSyncRequest, { action: 'bootstrap' }>): Promise<AccountSyncSnapshot>;
  call(
    request: Exclude<
      AccountSyncRequest,
      { action: 'bootstrap' | 'deleteAccount' | 'clearLearningData' }
    >,
  ): Promise<AccountSyncSnapshot>;
}

export interface CloudSyncOptions {
  getScope: () => ProgressScope;
  /** Prevent learning writes while the server is resumably clearing them. */
  isClearPending?: () => boolean;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const CONFLICT_NOTICE = '本地待同步记录已保留；检测到数据冲突，需要处理后才能继续同步。';

const requestFor = (
  command: SyncCommand,
): Exclude<AccountSyncRequest, { action: 'bootstrap' | 'deleteAccount' | 'clearLearningData' }> => {
  const request = clone(command) as unknown as Record<string, unknown>;
  Reflect.deleteProperty(request, 'id');
  Reflect.deleteProperty(request, 'createdAt');
  Reflect.deleteProperty(request, 'state');
  return request as unknown as Exclude<
    AccountSyncRequest,
    {
      action: 'bootstrap' | 'deleteAccount' | 'clearLearningData';
    }
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
  private processing: Promise<void> | null = null;
  private state: AccountSyncState = { status: 'idle', pendingCount: 0, notice: null };
  private readonly maxAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly client: AccountSyncCaller,
    private readonly repository: ProgressRepository,
    private readonly outbox: SyncOutbox,
    private readonly options: CloudSyncOptions,
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sleep = options.sleep ?? delay;
    this.refreshState();
  }

  getState(): AccountSyncState {
    return clone(this.state);
  }

  /** A display-only value from the validated account cache. */
  getLastSyncedAt(): string | null {
    return this.cache()?.syncedAt ?? null;
  }

  getAvatarUploadPathPrefix(): string | null {
    return this.cache()?.avatarUploadPathPrefix || null;
  }

  getConfirmedAvatarUrl(): string | null {
    return this.cache()?.profile.avatarUrl ?? null;
  }

  private refreshState(
    status: AccountSyncState['status'] = this.state.status,
    notice = this.state.notice,
  ): void {
    if (this.outbox.isBlocked) {
      this.state = { status: 'conflict', pendingCount: this.outbox.size, notice: CONFLICT_NOTICE };
      return;
    }
    this.state = { status, pendingCount: this.outbox.size, notice };
  }

  private assertAccountScope(): boolean {
    return this.options.getScope() === 'account';
  }

  private cache(): AccountCacheEnvelope | null {
    return this.repository.loadAccountCache();
  }

  private saveSnapshot(snapshot: AccountSyncSnapshot): void {
    this.repository.saveAccountCache(envelopeFor(snapshot));
  }

  /** Do not let an older bootstrap replace a newer optimistic projection. */
  private saveBootstrapSnapshot(snapshot: AccountSyncSnapshot): boolean {
    const current = this.cache();
    if (
      current &&
      (current.profileRevision > snapshot.profileRevision ||
        current.progressRevision > snapshot.progressRevision)
    ) {
      return false;
    }
    this.saveSnapshot(snapshot);
    return true;
  }

  private updateMetadata(snapshot: AccountSyncSnapshot): void {
    const current = this.cache();
    if (!current) {
      this.saveSnapshot(snapshot);
      return;
    }
    // Keep the optimistic projection while queued commands depend on it.
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
    if (!this.assertAccountScope()) return false;
    const isProfileCommand =
      command.action === 'updateProfile' || command.action === 'updatePreferences';
    if (this.options.isClearPending?.() && !isProfileCommand) return false;
    const cache = this.cache();
    if (!cache) return false;
    const domain =
      command.action === 'updateProfile' || command.action === 'updatePreferences'
        ? 'profile'
        : 'progress';
    const currentRevision = domain === 'profile' ? cache.profileRevision : cache.progressRevision;
    this.outbox.enqueue(this.commandInput(command, currentRevision));
    if (!this.outbox.isBlocked) this.outbox.rebase(cache.profileRevision, cache.progressRevision);
    this.refreshState(this.outbox.isBlocked ? 'conflict' : 'pending');
    return true;
  }

  /** Replace a completed clear snapshot and rebase deferred profile writes. */
  replaceAfterLearningClear(snapshot: AccountSyncSnapshot): void {
    this.saveSnapshot(snapshot);
    this.outbox.rebase(snapshot.profileRevision, snapshot.progressRevision);
    this.refreshState(this.outbox.size === 0 ? 'idle' : 'pending', null);
  }

  async bootstrap(): Promise<boolean> {
    if (!this.assertAccountScope()) return false;
    if (this.outbox.isBlocked) {
      this.refreshState();
      return true;
    }
    try {
      // Replay persisted writes before bootstrap so the server can report conflicts.
      if (this.outbox.size > 0) {
        await this.process();
        if (this.state.status === 'conflict') return true;
        if (this.state.status === 'failed') return false;
      }
      const finalSnapshot = await this.client.call({
        action: 'bootstrap',
        schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
      });
      // Let an in-flight drain settle before applying this bootstrap observation.
      if (this.processing) await this.processing;
      if (this.state.status === 'conflict') return true;
      // Preserve pending commands and their original expected revisions.
      if (this.outbox.size === 0) this.saveBootstrapSnapshot(finalSnapshot);
      const status =
        this.outbox.size === 0 ? 'idle' : this.state.status === 'failed' ? 'failed' : 'pending';
      this.refreshState(status, status === 'failed' ? this.state.notice : null);
      return true;
    } catch (error) {
      this.refreshState(
        'failed',
        isErrorCode(error, 'SCHEMA_INCOMPATIBLE')
          ? '云端学习记录格式不兼容，请更新小程序后重试。'
          : '云端学习同步暂不可用，请稍后重试。',
      );
      return false;
    }
  }

  async process(): Promise<void> {
    if (!this.assertAccountScope()) return;
    if (this.outbox.isBlocked) {
      this.refreshState();
      return;
    }
    // Profile updates are retained locally during a resumable learning clear,
    // but must not race the server's clearing/deleting write barrier.
    if (this.options.isClearPending?.()) {
      this.refreshState(this.outbox.size === 0 ? 'idle' : 'pending', null);
      return;
    }
    if (this.processing) return this.processing;
    this.processing = this.drain().finally(() => {
      this.processing = null;
    });
    return this.processing;
  }

  async retry(): Promise<void> {
    await this.process();
  }

  private async drain(): Promise<void> {
    while (this.assertAccountScope()) {
      const command = this.outbox.takeNext();
      if (!command) {
        this.refreshState('idle', null);
        return;
      }
      this.refreshState('syncing', null);
      const snapshot = await this.sendWithRetry(command);
      if (snapshot === null) return;
      if (!preferenceSnapshotMatches(command, snapshot)) {
        this.outbox.block();
        this.refreshState();
        return;
      }
      this.outbox.remove(command.id);
      this.outbox.rebase(snapshot.profileRevision, snapshot.progressRevision);
      if (this.outbox.size === 0) this.saveSnapshot(snapshot);
      else this.updateMetadata(snapshot);
      this.refreshState(this.outbox.size === 0 ? 'idle' : 'pending', null);
    }
  }

  private async sendWithRetry(command: SyncCommand): Promise<AccountSyncSnapshot | null> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.client.call(requestFor(command));
      } catch (error) {
        if (isErrorCode(error, 'REVISION_CONFLICT')) {
          this.outbox.block();
          this.refreshState();
          return null;
        }
        if (isErrorCode(error, 'SCHEMA_INCOMPATIBLE') || isErrorCode(error, 'ACCOUNT_DELETING')) {
          this.outbox.markPending(command.id);
          this.refreshState('failed', '云端学习同步暂不可用，请稍后重试。');
          return null;
        }
        if (attempt === this.maxAttempts) {
          this.outbox.markPending(command.id);
          this.refreshState('failed', '学习记录待同步，请在网络恢复后重试。');
          return null;
        }
        await this.sleep(250 * 2 ** (attempt - 1));
      }
    }
    return null;
  }
}

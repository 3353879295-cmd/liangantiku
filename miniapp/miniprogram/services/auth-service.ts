import { ACCOUNT_SYNC_SCHEMA_VERSION } from '../types/account-sync';
import type { AccountSyncClient } from '../repositories/account-sync-client';
import type { ProgressRepository } from '../storage/progress-repository';
import type { SyncOutbox } from '../storage/sync-outbox';
import type { StorageAdapter } from '../types/domain';
import type { CloudSyncService } from './cloud-sync-service';
import type { ProgressService } from './progress-service';

export const AUTH_PREFERENCE_KEY = 'grain-practice:auth-preference';
export const ACCOUNT_CLEAR_PENDING_KEY = 'grain-practice:account-clear-pending';
export type AuthPreference = 'undecided' | 'guest' | 'account';
export type AuthStatus = 'checking' | 'guest' | 'authenticated' | 'error';

export interface AuthState {
  status: AuthStatus;
  preference: AuthPreference;
  temporaryGuest: boolean;
  notice: string | null;
}

export interface LogoutResult {
  needsDecision: boolean;
}

type AccountActions = Pick<AccountSyncClient, 'call'>;
type AvatarFiles = {
  remove(fileID: string): Promise<void>;
  pending?(): readonly string[];
  reconcile?(boundFileID: string | null, retainedFileIDs?: readonly string[]): Promise<void>;
};

export const readAuthPreference = (storage: StorageAdapter): AuthPreference => {
  const value = storage.get<unknown>(AUTH_PREFERENCE_KEY);
  return value === 'guest' || value === 'account' ? value : 'undecided';
};
export const hasPendingLearningClear = (storage: StorageAdapter, prefix: string | null): boolean =>
  !!prefix &&
  Array.isArray(storage.get<unknown>(ACCOUNT_CLEAR_PENDING_KEY)) &&
  (storage.get<unknown>(ACCOUNT_CLEAR_PENDING_KEY) as unknown[]).includes(prefix);

/** Account lifecycle state. */
export class AuthService {
  private state: AuthState;
  private initialization: Promise<AuthState> | null = null;
  private initialized = false;
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: StorageAdapter,
    private readonly progress: ProgressService,
    private readonly repository: ProgressRepository,
    private readonly outbox: SyncOutbox,
    private readonly sync: CloudSyncService,
    private readonly client: AccountActions,
    private readonly maxDeletionSteps = 32,
    private readonly avatarFiles?: AvatarFiles,
    initialPreference?: AuthPreference,
  ) {
    const preference = initialPreference ?? readAuthPreference(storage);
    this.state = {
      status: 'checking',
      preference,
      temporaryGuest: false,
      notice: null,
    };
    if (storage.get<unknown>(ACCOUNT_CLEAR_PENDING_KEY) === true) {
      const prefix = repository.loadAccountCache()?.avatarUploadPathPrefix;
      if (prefix) storage.set(ACCOUNT_CLEAR_PENDING_KEY, [prefix]);
    }
  }

  getState(): AuthState {
    return { ...this.state };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  refreshFromCache(): void {
    if (this.progress.getScope() !== 'account') return;
    this.progress.refreshAccountSnapshot();
    this.state.notice = this.sync.getState().notice;
    this.notify();
  }

  private savePreference(preference: AuthPreference): void {
    if (preference === 'undecided') this.storage.remove(AUTH_PREFERENCE_KEY);
    else this.storage.set(AUTH_PREFERENCE_KEY, preference);
    this.state.preference = preference;
  }

  isLearningClearPending(): boolean {
    return hasPendingLearningClear(this.storage, this.sync.getAvatarUploadPathPrefix());
  }

  private setLearningClearPending(pending: boolean): void {
    const prefix = this.sync.getAvatarUploadPathPrefix();
    if (!prefix) return;
    const value = this.storage.get<unknown>(ACCOUNT_CLEAR_PENDING_KEY);
    const items = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
    const next = pending
      ? [...new Set([...items, prefix])]
      : items.filter((item) => item !== prefix);
    if (next.length) this.storage.set(ACCOUNT_CLEAR_PENDING_KEY, next);
    else this.storage.remove(ACCOUNT_CLEAR_PENDING_KEY);
  }

  private async continueLearningClear(): Promise<boolean> {
    const generation = this.generation;
    try {
      const snapshot = await this.client.call({
        action: 'clearLearningData',
        schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
      });
      if (generation !== this.generation || this.progress.getScope() !== 'account') return false;
      this.sync.replaceAfterLearningClear(snapshot);
      this.setLearningClearPending(false);
      await this.sync.process();
      if (generation !== this.generation) return false;
      this.progress.refreshAccountSnapshot();
      this.enterAuthenticated();
      return true;
    } catch {
      if (generation !== this.generation) return false;
      this.state = {
        ...this.state,
        status: 'authenticated',
        notice: '学习数据清除未完成，请稍后重试。',
      };
      this.notify();
      return false;
    }
  }

  private enterGuest(temporaryGuest: boolean, notice: string | null = null): void {
    this.generation += 1;
    this.sync.suspend();
    this.progress.switchScope('guest');
    this.state = {
      status: 'guest',
      preference: this.state.preference,
      temporaryGuest,
      notice,
    };
    this.notify();
  }

  private enterAuthenticated(): void {
    this.progress.refreshAccountSnapshot();
    this.state = {
      status: 'authenticated',
      preference: this.state.preference,
      temporaryGuest: false,
      notice: this.sync.getState().notice,
    };
    this.notify();
  }

  private async reconcileAvatars(): Promise<void> {
    if (!this.avatarFiles?.reconcile) return;
    const retained = this.outbox
      .list()
      .filter((command) => command.action === 'updateProfile')
      .map((command) => command.avatarUrl)
      .filter((avatarUrl) => avatarUrl.startsWith('cloud://'));
    await this.avatarFiles.reconcile(this.sync.getConfirmedAvatarUrl(), [
      ...retained,
      ...this.otherAccountAvatars(),
    ]);
  }

  private otherAccountAvatars(): readonly string[] {
    const prefix = this.sync.getAvatarUploadPathPrefix();
    return (this.avatarFiles?.pending?.() ?? []).filter(
      (id) => !prefix || !id.includes(`/${prefix}/`),
    );
  }

  private async reconcileAvatarsInBackground(): Promise<void> {
    try {
      await this.reconcileAvatars();
    } catch {
      // Retry cleanup later.
    }
  }

  async initialize(): Promise<AuthState> {
    if (this.initialized) return this.getState();
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeInternal().finally(() => {
      this.initialization = null;
      this.initialized = true;
    });
    return this.initialization;
  }

  private async initializeInternal(): Promise<AuthState> {
    if (this.state.preference === 'account') await this.recoverAccount();
    else this.enterGuest(false);
    return this.getState();
  }

  chooseGuest(): void {
    this.savePreference('guest');
    this.enterGuest(false);
  }

  async login(): Promise<boolean> {
    return this.state.status === 'authenticated' || this.recoverAccount(true);
  }

  async retry(): Promise<boolean> {
    return this.state.preference === 'account' && this.recoverAccount();
  }

  private async recoverAccount(explicitLogin = false): Promise<boolean> {
    this.progress.switchScope('guest');
    const generation = this.generation;
    const recovered = await this.sync.bootstrap(true);
    if (generation !== this.generation) return false;
    if (!recovered) {
      this.progress.switchScope('guest');
      this.state = { ...this.state, status: 'error', notice: '账号记录已保留，联网后会自动恢复。' };
      this.notify();
      return false;
    }
    if (explicitLogin) this.savePreference('account');
    this.progress.switchScope('account');
    if (this.isLearningClearPending()) return this.continueLearningClear();
    this.enterAuthenticated();
    void this.reconcileAvatarsInBackground();
    return true;
  }

  useTemporaryGuest(): void {
    if (this.state.preference !== 'account') return;
    this.enterGuest(true, '当前使用本机游客记录；账号记录将在下次启动时继续恢复。');
  }

  async retryBackground(): Promise<void> {
    if (this.state.preference !== 'account' || this.state.temporaryGuest) return;
    if (this.state.status === 'checking') {
      await this.initialize();
      return;
    }
    if (this.state.status === 'error') {
      await this.retry();
      return;
    }
    if (this.state.status !== 'authenticated') return;
    if (this.isLearningClearPending()) {
      await this.retry();
      return;
    }
    const generation = this.generation;
    await this.sync.retry();
    if (generation !== this.generation) return;
    this.refreshFromCache();
    if (this.sync.getState().status !== 'failed') void this.reconcileAvatarsInBackground();
  }

  logout(): Promise<LogoutResult> {
    if (this.state.status !== 'authenticated') return Promise.resolve({ needsDecision: false });
    if (this.isLearningClearPending()) return Promise.resolve({ needsDecision: true });
    // Keep offline work for the same account's next login.
    this.savePreference('guest');
    this.enterGuest(false);
    return Promise.resolve({ needsDecision: false });
  }

  async clearLearningData(): Promise<boolean> {
    if (this.progress.getScope() !== 'account') {
      this.progress.clearLearningData();
      return true;
    }
    if (!(await this.verifyCurrentAccount())) return false;
    // Keep recoverable commands until the durable queue converges.
    if (this.isLearningClearPending()) return this.continueLearningClear();
    await this.sync.process();
    if (this.sync.getState().pendingCount > 0) return false;
    this.setLearningClearPending(true);
    return this.continueLearningClear();
  }

  async deleteAccount(): Promise<boolean> {
    if (this.progress.getScope() !== 'account') return false;
    if (!(await this.verifyCurrentAccount())) return false;
    this.sync.suspend();
    this.outbox.clear();
    try {
      for (let step = 0; step < this.maxDeletionSteps; step += 1) {
        const result = await this.client.call({
          action: 'deleteAccount',
          schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
        });
        if (!result.done) continue;
        if (this.avatarFiles?.reconcile)
          await this.avatarFiles.reconcile(null, this.otherAccountAvatars());
        const avatarUrl = this.progress.getPreferences().avatarUrl;
        if (avatarUrl.startsWith('cloud://') && this.avatarFiles)
          await this.avatarFiles.remove(avatarUrl);
        this.setLearningClearPending(false);
        this.repository.remove('account');
        this.outbox.clear();
        this.savePreference('guest');
        this.enterGuest(false);
        return true;
      }
    } catch {
      // Preserve resumable deletion state.
    }
    this.state = {
      ...this.state,
      status: 'authenticated',
      notice: '账号注销未完成，请稍后重试。',
    };
    return false;
  }

  private async verifyCurrentAccount(): Promise<boolean> {
    const prefix = this.sync.getAvatarUploadPathPrefix();
    return (
      !!prefix &&
      (await this.sync.bootstrap(true)) &&
      prefix === this.sync.getAvatarUploadPathPrefix()
    );
  }
}

import { ACCOUNT_SYNC_SCHEMA_VERSION } from '../types/account-sync';
import type { AccountSyncClient } from '../repositories/account-sync-client';
import type { ProgressRepository } from '../storage/progress-repository';
import type { SyncOutbox } from '../storage/sync-outbox';
import type { StorageAdapter } from '../types/domain';
import type { CloudSyncService } from './cloud-sync-service';
import type { ProgressService } from './progress-service';

export const AUTH_PREFERENCE_KEY = 'grain-practice:auth-preference';
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

export const readAuthPreference = (storage: StorageAdapter): AuthPreference => {
  const value = storage.get<unknown>(AUTH_PREFERENCE_KEY);
  return value === 'guest' || value === 'account' ? value : 'undecided';
};

/** Coordinates account lifecycle without exposing cloud protocol to pages. */
export class AuthService {
  private state: AuthState;
  private initialization: Promise<AuthState> | null = null;
  private initialized = false;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly progress: ProgressService,
    private readonly repository: ProgressRepository,
    private readonly outbox: SyncOutbox,
    private readonly sync: CloudSyncService,
    private readonly client: AccountActions,
    private readonly maxDeletionSteps = 32,
  ) {
    const preference = readAuthPreference(storage);
    this.state = {
      status: 'checking',
      preference,
      temporaryGuest: false,
      notice: null,
    };
  }

  getState(): AuthState {
    return { ...this.state };
  }

  private savePreference(preference: AuthPreference): void {
    if (preference === 'undecided') this.storage.remove(AUTH_PREFERENCE_KEY);
    else this.storage.set(AUTH_PREFERENCE_KEY, preference);
    this.state.preference = preference;
  }

  private enterGuest(temporaryGuest: boolean, notice: string | null = null): void {
    this.progress.switchScope('guest');
    this.state = {
      status: 'guest',
      preference: this.state.preference,
      temporaryGuest,
      notice,
    };
  }

  private enterAuthenticated(): void {
    this.progress.refreshAccountSnapshot();
    this.state = {
      status: 'authenticated',
      preference: this.state.preference,
      temporaryGuest: false,
      notice: this.sync.getState().notice,
    };
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
    if (this.state.preference !== 'account') {
      this.enterGuest(false);
      return this.getState();
    }
    this.progress.switchScope('account');
    const recovered = await this.sync.bootstrap();
    if (recovered) this.enterAuthenticated();
    else {
      this.state = {
        status: 'error',
        preference: 'account',
        temporaryGuest: false,
        notice: '账号记录暂时无法恢复，请重试或暂时使用本机游客记录。',
      };
    }
    return this.getState();
  }

  chooseGuest(): void {
    this.savePreference('guest');
    this.enterGuest(false);
  }

  async login(): Promise<boolean> {
    const previousScope = this.progress.getScope();
    // An explicit new login must never revive a stale local account projection.
    this.repository.remove('account');
    this.outbox.clear();
    this.progress.switchScope('account');
    const recovered = await this.sync.bootstrap();
    if (recovered) {
      this.savePreference('account');
      this.enterAuthenticated();
      return true;
    }
    this.progress.switchScope(previousScope);
    this.state = {
      status: 'error',
      preference: this.state.preference,
      temporaryGuest: false,
      notice: '微信登录暂不可用，请稍后重试。',
    };
    return false;
  }

  async retry(): Promise<boolean> {
    if (this.state.preference !== 'account') return false;
    this.progress.switchScope('account');
    const recovered = await this.sync.bootstrap();
    if (recovered) this.enterAuthenticated();
    else
      this.state = { ...this.state, status: 'error', notice: '账号记录暂时无法恢复，请稍后重试。' };
    return recovered;
  }

  useTemporaryGuest(): void {
    if (this.state.preference !== 'account') return;
    this.enterGuest(true, '当前使用本机游客记录；账号记录将在下次启动时继续恢复。');
  }

  async retryBackground(): Promise<void> {
    if (this.state.status !== 'authenticated') return;
    await this.sync.retry();
    this.progress.refreshAccountSnapshot();
  }

  async logout(discardFailed = false): Promise<LogoutResult> {
    if (this.state.status !== 'authenticated') return { needsDecision: false };
    await this.sync.process();
    const pending = this.sync.getState().pendingCount;
    if (pending > 0 && !discardFailed) return { needsDecision: true };
    if (pending > 0) this.outbox.clear();
    this.repository.remove('account');
    this.outbox.clear();
    this.savePreference('guest');
    this.enterGuest(false);
    return { needsDecision: false };
  }

  async clearLearningData(): Promise<boolean> {
    if (this.progress.getScope() !== 'account') {
      this.progress.clearLearningData();
      return true;
    }
    // Do not silently discard profile/settings (or any other recoverable
    // command).  Clearing can begin only after the durable queue converges.
    await this.sync.process();
    if (this.sync.getState().pendingCount > 0) return false;
    try {
      const snapshot = await this.client.call({
        action: 'clearLearningData',
        schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
      });
      this.repository.saveAccountCache({ cacheVersion: 1, ...snapshot });
      this.progress.refreshAccountSnapshot();
      this.enterAuthenticated();
      return true;
    } catch {
      this.state = {
        ...this.state,
        status: 'authenticated',
        notice: '学习数据清除未完成，请稍后重试。',
      };
      return false;
    }
  }

  async deleteAccount(): Promise<boolean> {
    if (this.progress.getScope() !== 'account') return false;
    this.outbox.clear();
    try {
      for (let step = 0; step < this.maxDeletionSteps; step += 1) {
        const result = await this.client.call({
          action: 'deleteAccount',
          schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
        });
        if (!result.done) continue;
        this.repository.remove('account');
        this.outbox.clear();
        this.savePreference('guest');
        this.enterGuest(false);
        return true;
      }
    } catch {
      // Keep the preference and cache: cloud deletion is deliberately resumable.
    }
    this.state = {
      ...this.state,
      status: 'authenticated',
      notice: '账号注销未完成，请稍后重试。',
    };
    return false;
  }
}

import { isPersistedSession, migrateProgress } from './migrations';
import type { MigrationResult, CurrentProgressData, PersistedPracticeSession } from './migrations';
import type { StorageAdapter } from '../types/domain';
import type { CertificateKey } from '../types/domain';
import type { ProgressScope } from '../types/account-sync';
import {
  ACCOUNT_SYNC_SCHEMA_VERSION,
  type AccountCacheEnvelope,
  type AccountProgressSnapshot,
} from '../types/account-sync';
import { isProgressDataV4 } from './migrations';
import { isSyncCommand, type SyncOutbox } from './sync-outbox';
import type { AccountSyncSnapshot, SyncCommand } from '../types/account-sync';

export const LEGACY_STORAGE_KEY = 'grain-practice:progress';
export const GUEST_PROGRESS_KEY = 'grain-practice:guest-progress';
export const ACCOUNT_CACHE_KEY = 'grain-practice:account-cache';
export const STORAGE_KEY = GUEST_PROGRESS_KEY;
export const RECOVERY_BACKUP_KEY = 'grain-practice:progress:recovery-backup';
const ACCOUNT_SWITCH_KEY = 'grain-practice:account-switch';
const archiveKey = (prefix: string) => `grain-practice:account-archive:${prefix || 'unverified'}`;

interface AccountArchive {
  cache: AccountCacheEnvelope;
  commands: readonly SyncCommand[];
  sessions: Partial<Record<CertificateKey, PersistedPracticeSession>>;
}

const isArchive = (value: unknown): value is AccountArchive => {
  const item = value as AccountArchive | null;
  return (
    !!item &&
    isAccountCacheEnvelope(item.cache) &&
    Array.isArray(item.commands) &&
    item.commands.every(isSyncCommand) &&
    !!item.sessions &&
    typeof item.sessions === 'object' &&
    Object.values(item.sessions).every(
      (session) => isPersistedSession(session) && session.mode === 'sequential',
    )
  );
};

const SEQUENTIAL_CERTIFICATE_KEYS: readonly CertificateKey[] = [
  '4-02-06-01:5',
  '4-02-06-01:4',
  '4-02-06-01:3',
  '4-02-06-01:2',
  '4-02-06-01:1',
  '4-08-05-01:5',
  '4-08-05-01:4',
  '4-08-05-01:3',
  '4-08-05-01:2',
  '4-08-05-01:1',
];

export interface RecoveryBackup {
  capturedAt: number;
  reason: string;
  value: unknown;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cacheProfile = (progress: AccountProgressSnapshot): AccountCacheEnvelope['profile'] => ({
  nickname: progress.preferences.nickname,
  avatarUrl: progress.preferences.avatarUrl,
  selectedCertificateKey: progress.preferences.selectedCertificateKey,
  dailyGoal: progress.preferences.dailyGoal,
  answerTheme: progress.preferences.answerTheme,
  answerRevealMode: progress.preferences.answerRevealMode,
});

const isCacheProfile = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.nickname === 'string' &&
    typeof profile.avatarUrl === 'string' &&
    typeof profile.selectedCertificateKey === 'string' &&
    Number.isInteger(profile.dailyGoal) &&
    Number(profile.dailyGoal) > 0 &&
    (profile.answerTheme === 'light' || profile.answerTheme === 'night') &&
    (profile.answerRevealMode === 'immediate' || profile.answerRevealMode === 'deferred')
  );
};

export const isAccountCacheEnvelope = (value: unknown): value is AccountCacheEnvelope => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<AccountCacheEnvelope>;
  return (
    candidate.cacheVersion === 1 &&
    candidate.schemaVersion === ACCOUNT_SYNC_SCHEMA_VERSION &&
    typeof candidate.avatarUploadPathPrefix === 'string' &&
    (candidate.avatarUploadPathPrefix === '' ||
      /^account-avatars\/[a-f0-9]{64}$/.test(candidate.avatarUploadPathPrefix)) &&
    Number.isInteger(candidate.profileRevision) &&
    Number(candidate.profileRevision) >= 0 &&
    Number.isInteger(candidate.progressRevision) &&
    Number(candidate.progressRevision) >= 0 &&
    typeof candidate.syncedAt === 'string' &&
    isCacheProfile(candidate.profile) &&
    isProgressDataV4(candidate.progress)
  );
};

const isLocalAccountProjection = (value: unknown): value is { progress: CurrentProgressData } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as {
    cacheVersion?: unknown;
    schemaVersion?: unknown;
    avatarUploadPathPrefix?: unknown;
    progress?: unknown;
  };
  return (
    candidate.cacheVersion === 1 &&
    candidate.schemaVersion === ACCOUNT_SYNC_SCHEMA_VERSION &&
    (candidate.avatarUploadPathPrefix === '' || candidate.avatarUploadPathPrefix === undefined) &&
    isProgressDataV4(candidate.progress)
  );
};

export const createAccountCacheEnvelope = (
  progress: AccountProgressSnapshot,
  metadata?: Pick<
    AccountCacheEnvelope,
    'avatarUploadPathPrefix' | 'profileRevision' | 'progressRevision' | 'syncedAt' | 'profile'
  >,
): AccountCacheEnvelope => ({
  cacheVersion: 1,
  schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
  avatarUploadPathPrefix: metadata?.avatarUploadPathPrefix ?? '',
  profileRevision: metadata?.profileRevision ?? 0,
  progressRevision: metadata?.progressRevision ?? 0,
  syncedAt: metadata?.syncedAt ?? '',
  profile: metadata?.profile ?? cacheProfile(progress),
  progress: clone(progress),
});

export class ProgressRepository {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly now: () => number = Date.now,
  ) {}

  private keyFor(scope: ProgressScope): string {
    return scope === 'guest' ? GUEST_PROGRESS_KEY : ACCOUNT_CACHE_KEY;
  }

  private sequentialKeyFor(scope: ProgressScope, key: CertificateKey): string {
    return `grain-practice:${scope}:sequential:${key}`;
  }

  load(scope: ProgressScope = 'guest'): MigrationResult {
    const storageKey = this.keyFor(scope);
    let value = this.storage.get<unknown>(storageKey);
    if (scope === 'account' && isAccountCacheEnvelope(value)) {
      return { data: clone(value.progress), recovered: false };
    }
    if (scope === 'account' && isLocalAccountProjection(value)) {
      return { data: clone(value.progress), recovered: false };
    }
    let migratedLegacyValue = false;
    if (scope === 'guest' && value === null) {
      const legacyValue = this.storage.get<unknown>(LEGACY_STORAGE_KEY);
      if (legacyValue !== null) {
        value = legacyValue;
        migratedLegacyValue = true;
      }
    }
    const result = migrateProgress(value);
    if (result.recovered) {
      this.storage.set<RecoveryBackup>(RECOVERY_BACKUP_KEY, {
        capturedAt: this.now(),
        reason: result.reason ?? 'unknown recovery reason',
        value,
      });
    }
    if (result.recovered || value === null || migratedLegacyValue || result.data !== value) {
      this.storage.set(
        storageKey,
        scope === 'account' ? createAccountCacheEnvelope(result.data) : result.data,
      );
    }
    return result;
  }

  save(scope: ProgressScope, data: CurrentProgressData): void {
    if (scope === 'guest') {
      this.storage.set(GUEST_PROGRESS_KEY, clone(data));
      return;
    }
    const existing = this.storage.get<unknown>(ACCOUNT_CACHE_KEY);
    const metadata = isAccountCacheEnvelope(existing)
      ? {
          profileRevision: existing.profileRevision,
          progressRevision: existing.progressRevision,
          avatarUploadPathPrefix: existing.avatarUploadPathPrefix,
          syncedAt: existing.syncedAt,
          profile: existing.profile,
        }
      : undefined;
    this.storage.set(ACCOUNT_CACHE_KEY, createAccountCacheEnvelope(data, metadata));
  }

  loadAccountCache(): AccountCacheEnvelope | null {
    const value = this.storage.get<unknown>(ACCOUNT_CACHE_KEY);
    return isAccountCacheEnvelope(value) ? clone(value) : null;
  }

  saveAccountCache(cache: AccountCacheEnvelope): void {
    this.storage.set(ACCOUNT_CACHE_KEY, clone(cache));
  }

  /** Complete an interrupted local switch before any queue can be sent. */
  recoverAccountSwitch(outbox: SyncOutbox): void {
    const saved = this.storage.get<unknown>(ACCOUNT_SWITCH_KEY);
    if (isArchive(saved)) this.applyAccountSwitch(saved, outbox);
  }

  switchAccount(snapshot: AccountSyncSnapshot, outbox: SyncOutbox): void {
    const current = this.loadAccountCache();
    if (current) {
      const sessions: AccountArchive['sessions'] = {};
      for (const key of SEQUENTIAL_CERTIFICATE_KEYS) {
        const session = this.loadSequentialSession('account', key);
        if (session) sessions[key] = session;
      }
      this.storage.set(archiveKey(current.avatarUploadPathPrefix), {
        cache: current,
        commands: outbox.list(),
        sessions,
      });
    }
    const saved = this.storage.get<unknown>(archiveKey(snapshot.avatarUploadPathPrefix));
    const next: AccountArchive =
      isArchive(saved) && saved.cache.avatarUploadPathPrefix === snapshot.avatarUploadPathPrefix
        ? saved
        : { cache: { cacheVersion: 1, ...clone(snapshot) }, commands: [], sessions: {} };
    // This durable marker makes the multi-key cache/queue switch recoverable after restart.
    this.storage.set(ACCOUNT_SWITCH_KEY, next);
    this.applyAccountSwitch(next, outbox);
  }

  private applyAccountSwitch(next: AccountArchive, outbox: SyncOutbox): void {
    outbox.clear();
    this.remove('account');
    this.saveAccountCache(next.cache);
    for (const key of SEQUENTIAL_CERTIFICATE_KEYS) {
      const session = next.sessions[key];
      if (session) this.saveSequentialSession('account', key, session);
    }
    outbox.restore(next.commands);
    this.storage.remove(archiveKey(next.cache.avatarUploadPathPrefix));
    this.storage.remove(ACCOUNT_SWITCH_KEY);
  }

  loadSequentialSession(
    scope: ProgressScope,
    key: CertificateKey,
  ): PersistedPracticeSession | null {
    const value = this.storage.get<unknown>(this.sequentialKeyFor(scope, key));
    return isPersistedSession(value) && value.mode === 'sequential' ? clone(value) : null;
  }

  saveSequentialSession(
    scope: ProgressScope,
    key: CertificateKey,
    session: PersistedPracticeSession | null,
  ): void {
    const storageKey = this.sequentialKeyFor(scope, key);
    if (session === null) {
      this.storage.remove(storageKey);
      return;
    }
    this.storage.set(storageKey, clone(session));
  }

  removeSequentialSessions(scope: ProgressScope): void {
    for (const key of SEQUENTIAL_CERTIFICATE_KEYS) {
      this.storage.remove(this.sequentialKeyFor(scope, key));
    }
  }

  remove(scope: ProgressScope): void {
    this.storage.remove(this.keyFor(scope));
    this.removeSequentialSessions(scope);
  }
}

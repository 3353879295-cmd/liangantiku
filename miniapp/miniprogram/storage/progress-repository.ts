import { migrateProgress } from './migrations';
import type { MigrationResult, CurrentProgressData } from './migrations';
import type { StorageAdapter } from '../types/domain';
import type { ProgressScope } from '../types/account-sync';
import {
  ACCOUNT_SYNC_SCHEMA_VERSION,
  type AccountCacheEnvelope,
  type AccountProgressSnapshot,
} from '../types/account-sync';
import { isProgressDataV4 } from './migrations';

export const LEGACY_STORAGE_KEY = 'grain-practice:progress';
export const GUEST_PROGRESS_KEY = 'grain-practice:guest-progress';
export const ACCOUNT_CACHE_KEY = 'grain-practice:account-cache';
export const STORAGE_KEY = GUEST_PROGRESS_KEY;
export const RECOVERY_BACKUP_KEY = 'grain-practice:progress:recovery-backup';

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

  remove(scope: ProgressScope): void {
    this.storage.remove(this.keyFor(scope));
  }
}

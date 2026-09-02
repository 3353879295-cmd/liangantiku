import { migrateProgress } from './migrations';
import type { MigrationResult, CurrentProgressData } from './migrations';
import type { StorageAdapter } from '../types/domain';
import type { ProgressScope } from '../types/account-sync';

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
      this.storage.set(storageKey, result.data);
    }
    return result;
  }

  save(scope: ProgressScope, data: CurrentProgressData): void {
    this.storage.set(this.keyFor(scope), data);
  }

  remove(scope: ProgressScope): void {
    this.storage.remove(this.keyFor(scope));
  }
}

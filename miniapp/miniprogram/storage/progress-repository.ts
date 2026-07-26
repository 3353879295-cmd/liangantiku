import { migrateProgress } from './migrations';
import type { MigrationResult, ProgressDataV3 } from './migrations';
import type { StorageAdapter } from '../types/domain';

export const STORAGE_KEY = 'grain-practice:progress';
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

  load(): MigrationResult {
    const value = this.storage.get<unknown>(STORAGE_KEY);
    const result = migrateProgress(value);
    if (result.recovered) {
      this.storage.set<RecoveryBackup>(RECOVERY_BACKUP_KEY, {
        capturedAt: this.now(),
        reason: result.reason ?? 'unknown recovery reason',
        value,
      });
    }
    if (result.recovered || (value !== null && result.data !== value)) {
      this.storage.set(STORAGE_KEY, result.data);
    }
    return result;
  }

  save(data: ProgressDataV3): void {
    this.storage.set(STORAGE_KEY, data);
  }

  remove(): void {
    this.storage.remove(STORAGE_KEY);
  }
}

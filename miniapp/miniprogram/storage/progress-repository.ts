import { migrateProgress } from './migrations';
import type { MigrationResult, ProgressDataV1 } from './migrations';
import type { StorageAdapter } from '../types/domain';

export const STORAGE_KEY = 'grain-practice:progress';

export class ProgressRepository {
  constructor(private readonly storage: StorageAdapter) {}

  load(): MigrationResult {
    return migrateProgress(this.storage.get<unknown>(STORAGE_KEY));
  }

  save(data: ProgressDataV1): void {
    this.storage.set(STORAGE_KEY, data);
  }

  remove(): void {
    this.storage.remove(STORAGE_KEY);
  }
}

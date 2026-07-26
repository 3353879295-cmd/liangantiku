import { describe, expect, it } from 'vitest';

import { ThemeService } from '../miniprogram/services/theme-service';
import { ProgressService } from '../miniprogram/services/progress-service';
import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import type { StorageAdapter } from '../miniprogram/types/domain';

class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  remove(key: string): void {
    this.values.delete(key);
  }
}

describe('ThemeService', () => {
  it('persists and restores the answer theme through ProgressService', () => {
    const repository = new ProgressRepository(new MemoryStorageAdapter());
    const progress = new ProgressService(repository);
    const theme = new ThemeService(progress);

    expect(theme.get()).toBe('light');
    expect(theme.toggle()).toBe('night');
    expect(progress.getPreferences().answerTheme).toBe('night');
    expect(new ThemeService(new ProgressService(repository)).get()).toBe('night');
  });

  it('sets an explicit theme and returns the persisted value', () => {
    const progress = new ProgressService(new ProgressRepository(new MemoryStorageAdapter()));
    const theme = new ThemeService(progress);

    expect(theme.set('night')).toBe('night');
    expect(theme.set('light')).toBe('light');
    expect(progress.getPreferences().answerTheme).toBe('light');
  });
});

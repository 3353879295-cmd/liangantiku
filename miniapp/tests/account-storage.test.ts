import { describe, expect, it } from 'vitest';

import { createEmptyProgress } from '../miniprogram/storage/migrations';
import {
  ACCOUNT_CACHE_KEY,
  GUEST_PROGRESS_KEY,
  LEGACY_STORAGE_KEY,
  ProgressRepository,
} from '../miniprogram/storage/progress-repository';

class MemoryStorageAdapter {
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

describe('account-scoped progress storage', () => {
  it('migrates the legacy progress only into an empty guest profile', () => {
    const storage = new MemoryStorageAdapter();
    const legacy = createEmptyProgress();
    legacy.summary.answered = 2;
    storage.set(LEGACY_STORAGE_KEY, legacy);

    const repository = new ProgressRepository(storage);

    expect(repository.load('guest').data).toEqual(legacy);
    expect(storage.get(GUEST_PROGRESS_KEY)).toEqual(legacy);
    expect(storage.get(ACCOUNT_CACHE_KEY)).toBeNull();
  });

  it('never overwrites an existing guest profile with legacy progress', () => {
    const storage = new MemoryStorageAdapter();
    const guest = createEmptyProgress();
    guest.summary.answered = 1;
    const legacy = createEmptyProgress();
    legacy.summary.answered = 9;
    storage.set(GUEST_PROGRESS_KEY, guest);
    storage.set(LEGACY_STORAGE_KEY, legacy);

    expect(new ProgressRepository(storage).load('guest').data).toEqual(guest);
    expect(storage.get(GUEST_PROGRESS_KEY)).toEqual(guest);
  });

  it('keeps account cache independent from the guest profile', () => {
    const storage = new MemoryStorageAdapter();
    const guest = createEmptyProgress();
    guest.summary.answered = 3;
    storage.set(GUEST_PROGRESS_KEY, guest);
    const repository = new ProgressRepository(storage);

    expect(repository.load('account').data).toEqual(createEmptyProgress());
    const account = createEmptyProgress();
    account.summary.answered = 7;
    repository.save('account', account);

    expect(repository.load('guest').data.summary.answered).toBe(3);
    expect(repository.load('account').data.summary.answered).toBe(7);
  });
});

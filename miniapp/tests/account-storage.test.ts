import { describe, expect, it } from 'vitest';

import { createEmptyProgress } from '../miniprogram/storage/migrations';
import {
  ACCOUNT_CACHE_KEY,
  GUEST_PROGRESS_KEY,
  LEGACY_STORAGE_KEY,
  ProgressRepository,
  createAccountCacheEnvelope,
} from '../miniprogram/storage/progress-repository';
import { SyncOutbox } from '../miniprogram/storage/sync-outbox';

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
  const account = (letter: string, answered = 0) => {
    const data = createEmptyProgress();
    data.summary.answered = answered;
    const cache = createAccountCacheEnvelope(data);
    cache.avatarUploadPathPrefix = `account-avatars/${letter.repeat(64)}`;
    return cache;
  };

  it('archives cached history, offline commands and sequential practice independently per account', () => {
    const storage = new MemoryStorageAdapter();
    const repository = new ProgressRepository(storage);
    const outbox = new SyncOutbox(storage);
    repository.saveAccountCache(account('a', 7));
    outbox.enqueue({
      action: 'setFavorite',
      schemaVersion: 1,
      expectedRevision: 0,
      questionId: 'Q1',
      favorite: true,
    });
    const session = {
      id: 'saved-a',
      mode: 'sequential' as const,
      questionIds: ['Q1'],
      currentIndex: 0,
      answers: {},
      status: 'active' as const,
      startedAt: 1,
      updatedAt: 2,
      progressRecorded: false,
      answerRevealMode: 'immediate' as const,
    };
    repository.saveSequentialSession('account', '4-02-06-01:5', session);
    repository.switchAccount(account('b', 2), outbox);
    expect(repository.load('account').data.summary.answered).toBe(2);
    expect(repository.loadSequentialSession('account', '4-02-06-01:5')).toBeNull();
    expect(outbox.size).toBe(0);
    repository.switchAccount(account('a'), outbox);
    expect(repository.load('account').data.summary.answered).toBe(7);
    expect(repository.loadSequentialSession('account', '4-02-06-01:5')).toEqual(session);
    expect(outbox.list()).toMatchObject([{ questionId: 'Q1', state: 'pending' }]);
  });

  it('completes an interrupted cache/queue switch before any restored command can be sent', () => {
    class InterruptedStorage extends MemoryStorageAdapter {
      failOnce = false;
      override set<T>(key: string, value: T): void {
        if (key === ACCOUNT_CACHE_KEY && this.failOnce) {
          this.failOnce = false;
          throw new Error('interrupted');
        }
        super.set(key, value);
      }
    }
    const storage = new InterruptedStorage();
    const repository = new ProgressRepository(storage);
    const outbox = new SyncOutbox(storage);
    repository.saveAccountCache(account('a', 7));
    outbox.enqueue({
      action: 'setFavorite',
      schemaVersion: 1,
      expectedRevision: 0,
      questionId: 'Q1',
      favorite: true,
    });
    storage.failOnce = true;
    expect(() => repository.switchAccount(account('b', 2), outbox)).toThrow('interrupted');
    const restarted = new SyncOutbox(storage);
    repository.recoverAccountSwitch(restarted);
    expect(repository.loadAccountCache()?.avatarUploadPathPrefix).toBe(
      account('b').avatarUploadPathPrefix,
    );
    expect(restarted.size).toBe(0);
    repository.switchAccount(account('a'), restarted);
    expect(repository.load('account').data.summary.answered).toBe(7);
    expect(restarted.list()).toMatchObject([{ questionId: 'Q1' }]);
  });

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
    repository.saveAccountCache({
      cacheVersion: 1,
      schemaVersion: 1,
      avatarUploadPathPrefix: `account-avatars/${'a'.repeat(64)}`,
      profileRevision: 0,
      progressRevision: 0,
      syncedAt: '',
      profile: {
        nickname: account.preferences.nickname,
        avatarUrl: account.preferences.avatarUrl,
        selectedCertificateKey: account.preferences.selectedCertificateKey,
        dailyGoal: account.preferences.dailyGoal,
        answerTheme: account.preferences.answerTheme,
        answerRevealMode: account.preferences.answerRevealMode,
      },
      progress: account,
    });

    expect(repository.load('guest').data.summary.answered).toBe(3);
    expect(repository.load('account').data.summary.answered).toBe(7);
  });

  it('keeps cloud cache revisions and profile metadata when account progress is saved', () => {
    const storage = new MemoryStorageAdapter();
    const repository = new ProgressRepository(storage);
    const account = createEmptyProgress();
    repository.saveAccountCache({
      cacheVersion: 1,
      schemaVersion: 1,
      avatarUploadPathPrefix: `account-avatars/${'a'.repeat(64)}`,
      profileRevision: 3,
      progressRevision: 8,
      syncedAt: '2026-09-02T00:00:00.000Z',
      profile: {
        nickname: '云端用户',
        avatarUrl: '',
        selectedCertificateKey: '4-02-06-01:5',
        dailyGoal: 20,
        answerTheme: 'light',
        answerRevealMode: 'immediate',
      },
      progress: account,
    });
    account.summary.answered = 2;
    repository.save('account', account);

    const cache = repository.loadAccountCache();
    expect(cache).toMatchObject({
      profileRevision: 3,
      progressRevision: 8,
      avatarUploadPathPrefix: `account-avatars/${'a'.repeat(64)}`,
      profile: { nickname: '云端用户' },
    });
    expect(cache?.progress.summary.answered).toBe(2);
    if (cache) cache.progress.summary.answered = 99;
    expect(repository.loadAccountCache()?.progress.summary.answered).toBe(2);
  });

  it('accepts a normalized legacy account cache without avatar upload support', () => {
    const storage = new MemoryStorageAdapter();
    const repository = new ProgressRepository(storage);
    const account = createEmptyProgress();
    storage.set(ACCOUNT_CACHE_KEY, {
      cacheVersion: 1,
      schemaVersion: 1,
      avatarUploadPathPrefix: '',
      profileRevision: 0,
      progressRevision: 0,
      syncedAt: '',
      profile: {
        nickname: '旧缓存',
        avatarUrl: '',
        selectedCertificateKey: '4-02-06-01:5',
        dailyGoal: 20,
        answerTheme: 'light',
        answerRevealMode: 'immediate',
      },
      progress: account,
    });

    account.summary.answered = 6;
    expect(repository.load('account').data.summary.answered).toBe(6);
    expect(repository.loadAccountCache()).toMatchObject({ avatarUploadPathPrefix: '' });
  });

  it('recovers a pre-upgrade account cache without a prefix but does not trust it for sync', () => {
    const storage = new MemoryStorageAdapter();
    const account = createEmptyProgress();
    account.summary.answered = 6;
    storage.set(ACCOUNT_CACHE_KEY, {
      cacheVersion: 1,
      schemaVersion: 1,
      profileRevision: 0,
      progressRevision: 0,
      syncedAt: '',
      profile: {},
      progress: account,
    });

    const repository = new ProgressRepository(storage);
    expect(repository.load('account').data.summary.answered).toBe(6);
    expect(repository.loadAccountCache()).toBeNull();
  });
});

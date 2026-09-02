import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_CLEAR_PENDING_KEY,
  AuthService,
  AUTH_PREFERENCE_KEY,
} from '../miniprogram/services/auth-service';
import {
  CloudSyncService,
  type AccountSyncCaller,
} from '../miniprogram/services/cloud-sync-service';
import { ProgressService } from '../miniprogram/services/progress-service';
import type { AccountSyncClient } from '../miniprogram/repositories/account-sync-client';
import { createEmptyProgress } from '../miniprogram/storage/migrations';
import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import { SyncOutbox } from '../miniprogram/storage/sync-outbox';
import type { AccountSyncSnapshot } from '../miniprogram/types/account-sync';
import type { StorageAdapter } from '../miniprogram/types/domain';

class MemoryStorage implements StorageAdapter {
  values = new Map<string, unknown>();
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

const snapshot = (): AccountSyncSnapshot => ({
  schemaVersion: 1,
  profileRevision: 0,
  progressRevision: 0,
  syncedAt: '2026-09-02T00:00:00.000Z',
  profile: {
    nickname: '云端用户',
    avatarUrl: '',
    selectedCertificateKey: '4-02-06-01:5',
    dailyGoal: 20,
    answerTheme: 'light',
    answerRevealMode: 'immediate',
  },
  progress: createEmptyProgress(),
});

const createAuth = (preference: 'undecided' | 'guest' | 'account' = 'undecided') => {
  const storage = new MemoryStorage();
  if (preference !== 'undecided') storage.set(AUTH_PREFERENCE_KEY, preference);
  const repository = new ProgressRepository(storage);
  const progress = new ProgressService(repository);
  const outbox = new SyncOutbox(storage);
  const client: AccountSyncCaller = { call: () => Promise.resolve(snapshot()) };
  const sync = new CloudSyncService(client, repository, outbox, {
    getScope: () => progress.getScope(),
  });
  return {
    storage,
    progress,
    outbox,
    auth: new AuthService(storage, progress, repository, outbox, sync, client as AccountSyncClient),
  };
};

describe('AuthService', () => {
  it('treats account-preference login as lossless recovery and authenticated login as a no-op', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const outbox = new SyncOutbox(storage);
    outbox.enqueue({
      action: 'updateProfile',
      schemaVersion: 1,
      expectedRevision: 0,
      nickname: '缓存资料',
      avatarUrl: '',
    });
    const progress = new ProgressService(repository, 'account');
    let online = false;
    const call = vi.fn(() =>
      online ? Promise.resolve(snapshot()) : Promise.reject(new Error('offline')),
    );
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
      maxAttempts: 1,
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    await expect(auth.login()).resolves.toBe(false);
    expect(repository.loadAccountCache()).not.toBeNull();
    expect(outbox.size).toBe(1);
    online = true;
    await expect(auth.login()).resolves.toBe(true);
    const calls = call.mock.calls.length;
    await expect(auth.login()).resolves.toBe(true);
    expect(call).toHaveBeenCalledTimes(calls);
  });

  it('single-flights startup recovery and does not bootstrap again after completion', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const repository = new ProgressRepository(storage);
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    const call = vi.fn(() => Promise.resolve(snapshot()));
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    await Promise.all([auth.initialize(), auth.initialize(), auth.initialize()]);
    await auth.initialize();
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith({ action: 'bootstrap', schemaVersion: 1 });
  });

  it('keeps undecided and guest startup local without calling cloud bootstrap', async () => {
    const { auth, progress } = createAuth();
    await auth.initialize();
    expect(auth.getState()).toMatchObject({ status: 'guest', preference: 'undecided' });
    expect(progress.getScope()).toBe('guest');
  });

  it('restores an account archive without reading the guest archive', async () => {
    const { auth, progress } = createAuth('account');
    progress.recordAnswer({ questionId: 'guest', correct: true, durationMs: 1, at: '2026-09-02' });
    await auth.initialize();
    expect(auth.getState().status).toBe('authenticated');
    expect(progress.getDashboard('2026-09-02').answered).toBe(0);
  });

  it('keeps account preference when temporarily using guest data', async () => {
    const { auth, storage } = createAuth('account');
    await auth.initialize();
    auth.useTemporaryGuest();
    expect(auth.getState()).toMatchObject({
      status: 'guest',
      temporaryGuest: true,
      preference: 'account',
    });
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
  });

  it('does not change guest data or preference when explicit login fails', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'guest');
    const repository = new ProgressRepository(storage);
    const progress = new ProgressService(repository);
    progress.recordAnswer({
      questionId: 'guest-q',
      correct: true,
      durationMs: 1,
      at: '2026-09-02',
    });
    const outbox = new SyncOutbox(storage);
    const client = {
      call: () => Promise.reject(new Error('offline')),
    } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
      maxAttempts: 1,
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    await expect(auth.login()).resolves.toBe(false);
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('guest');
    expect(progress.getScope()).toBe('guest');
    expect(progress.getDashboard('2026-09-02').answered).toBe(1);
  });

  it('retains cache, queue and account preference when recovery cannot reach cloud', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const outbox = new SyncOutbox(storage);
    outbox.enqueue({
      action: 'setFavorite',
      schemaVersion: 1,
      expectedRevision: 0,
      questionId: 'Q1',
      favorite: true,
    });
    const progress = new ProgressService(repository, 'account');
    const client = {
      call: () => Promise.reject(new Error('offline')),
    } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
      maxAttempts: 1,
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    await auth.initialize();
    expect(auth.getState().status).toBe('error');
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
    expect(repository.loadAccountCache()).not.toBeNull();
    expect(outbox.size).toBe(1);
  });

  it('does not discard pending account commands before cloud learning data is cleared', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    outbox.enqueue({
      action: 'updateProfile',
      schemaVersion: 1,
      expectedRevision: 0,
      nickname: '待同步',
      avatarUrl: '',
    });
    const call = vi.fn((request: { action: string }) =>
      request.action === 'bootstrap'
        ? Promise.resolve(snapshot())
        : Promise.reject(Object.assign(new Error('offline'), { code: 'ACCOUNT_SYNC_UNAVAILABLE' })),
    );
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
      maxAttempts: 1,
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    await expect(auth.clearLearningData()).resolves.toBe(false);
    expect(outbox.size).toBe(1);
    expect(repository.loadAccountCache()).not.toBeNull();
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
    expect(call).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'clearLearningData' }));
  });

  it('persists a failed cloud clear, blocks new learning commands, and resumes it after restart', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    let clearFails = true;
    const call = vi.fn((request: { action: string }) =>
      request.action === 'clearLearningData' && clearFails
        ? Promise.reject(Object.assign(new Error('clearing'), { code: 'ACCOUNT_SYNC_UNAVAILABLE' }))
        : Promise.resolve(snapshot()),
    );
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
      isClearPending: () => storage.get(ACCOUNT_CLEAR_PENDING_KEY) === true,
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    progress.setAccountMutationListener((command) => {
      void sync.enqueue(command);
    });
    await expect(auth.clearLearningData()).resolves.toBe(false);
    expect(storage.get(ACCOUNT_CLEAR_PENDING_KEY)).toBe(true);
    progress.toggleFavorite('Q1', 1);
    expect(outbox.size).toBe(0);

    clearFails = false;
    const restarted = new AuthService(storage, progress, repository, outbox, sync, client);
    await restarted.initialize();
    expect(storage.get(ACCOUNT_CLEAR_PENDING_KEY)).toBeNull();
    expect(call).toHaveBeenCalledWith({ action: 'clearLearningData', schemaVersion: 1 });
  });

  it('allows a user to discard local recovery and exit while retaining an unfinished cloud clear marker', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    storage.set(ACCOUNT_CLEAR_PENDING_KEY, true);
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    const client = {
      call: vi.fn(() => Promise.resolve(snapshot())),
    } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    // Simulate the already-authenticated account page where clearing was interrupted.
    await auth.retry();
    storage.set(ACCOUNT_CLEAR_PENDING_KEY, true);
    await expect(auth.logout()).resolves.toEqual({ needsDecision: true });
    await expect(auth.logout(true)).resolves.toEqual({ needsDecision: false });
    expect(repository.loadAccountCache()).toBeNull();
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('guest');
    expect(storage.get(ACCOUNT_CLEAR_PENDING_KEY)).toBe(true);
    await expect(auth.login()).resolves.toBe(true);
    expect(storage.get(ACCOUNT_CLEAR_PENDING_KEY)).toBeNull();
  });

  it('requires an explicit decision before discarding pending logout data', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const guest = createEmptyProgress();
    guest.summary.answered = 2;
    const repository = new ProgressRepository(storage);
    repository.save('guest', guest);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    const call = vi.fn((request: { action: string }) =>
      request.action === 'bootstrap'
        ? Promise.resolve(snapshot())
        : Promise.reject(Object.assign(new Error('offline'), { code: 'ACCOUNT_SYNC_UNAVAILABLE' })),
    );
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
      maxAttempts: 1,
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    await auth.initialize();
    outbox.enqueue({
      action: 'updateProfile',
      schemaVersion: 1,
      expectedRevision: 0,
      nickname: '未同步',
      avatarUrl: '',
    });

    await expect(auth.logout()).resolves.toEqual({ needsDecision: true });
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
    expect(repository.loadAccountCache()).not.toBeNull();
    expect(outbox.size).toBe(1);

    await expect(auth.logout(true)).resolves.toEqual({ needsDecision: false });
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('guest');
    expect(repository.loadAccountCache()).toBeNull();
    expect(outbox.size).toBe(0);
    expect(progress.getScope()).toBe('guest');
    expect(progress.getDashboard('2026-09-02').answered).toBe(2);
  });

  it('logs in from guest using only the cloud snapshot and preserves the guest archive', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'guest');
    const repository = new ProgressRepository(storage);
    const progress = new ProgressService(repository);
    progress.recordAnswer({
      questionId: 'guest-q',
      correct: true,
      durationMs: 1,
      at: '2026-09-02',
    });
    const cloud = snapshot();
    cloud.progress.summary.answered = 7;
    const outbox = new SyncOutbox(storage);
    const call = vi.fn(() => Promise.resolve(cloud));
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);

    await expect(auth.login()).resolves.toBe(true);
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
    expect(progress.getScope()).toBe('account');
    expect(progress.getDashboard('2026-09-02').answered).toBe(7);
    progress.switchScope('guest');
    expect(progress.getDashboard('2026-09-02').answered).toBe(1);
  });

  it('recovers an account after a temporary guest session without changing its preference', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const repository = new ProgressRepository(storage);
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    let offline = true;
    const call = vi.fn(() =>
      offline ? Promise.reject(new Error('offline')) : Promise.resolve(snapshot()),
    );
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);

    await auth.initialize();
    auth.useTemporaryGuest();
    offline = false;
    await expect(auth.retry()).resolves.toBe(true);
    expect(auth.getState()).toMatchObject({ status: 'authenticated', preference: 'account' });
    expect(progress.getScope()).toBe('account');
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
  });

  it('clears guest data locally without cloud and replaces account data only after cloud success', async () => {
    const guestSetup = createAuth('guest');
    guestSetup.progress.recordAnswer({
      questionId: 'guest-q',
      correct: true,
      durationMs: 1,
      at: '2026-09-02',
    });
    await expect(guestSetup.auth.clearLearningData()).resolves.toBe(true);
    expect(guestSetup.progress.getDashboard('2026-09-02').answered).toBe(0);

    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const repository = new ProgressRepository(storage);
    const cloud = snapshot();
    cloud.progress.summary.answered = 5;
    repository.saveAccountCache({ cacheVersion: 1, ...cloud });
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    const cleared = snapshot();
    const call = vi.fn((request: { action: string }) =>
      Promise.resolve(request.action === 'clearLearningData' ? cleared : cloud),
    );
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    await auth.initialize();

    await expect(auth.clearLearningData()).resolves.toBe(true);
    expect(progress.getDashboard('2026-09-02').answered).toBe(0);
    expect(auth.getState().status).toBe('authenticated');
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
  });

  it('keeps an account usable and cached when cloud clearing fails', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const repository = new ProgressRepository(storage);
    const cloud = snapshot();
    cloud.progress.summary.answered = 5;
    repository.saveAccountCache({ cacheVersion: 1, ...cloud });
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    const call = vi.fn((request: { action: string }) =>
      request.action === 'bootstrap'
        ? Promise.resolve(cloud)
        : Promise.reject(new Error('offline')),
    );
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
      maxAttempts: 1,
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client);
    await auth.initialize();

    await expect(auth.clearLearningData()).resolves.toBe(false);
    expect(progress.getDashboard('2026-09-02').answered).toBe(5);
    expect(repository.loadAccountCache()).not.toBeNull();
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
    expect(auth.getState()).toMatchObject({ status: 'authenticated', notice: expect.any(String) });
  });

  it('keeps deletion recoverable on failure and restores guest only after done', async () => {
    const storage = new MemoryStorage();
    storage.set(AUTH_PREFERENCE_KEY, 'account');
    const guest = createEmptyProgress();
    guest.summary.answered = 3;
    const repository = new ProgressRepository(storage);
    repository.save('guest', guest);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const progress = new ProgressService(repository, 'account');
    const outbox = new SyncOutbox(storage);
    let deletionAttempt = 0;
    const call = vi.fn((request: { action: string }) => {
      if (request.action === 'bootstrap') return Promise.resolve(snapshot());
      deletionAttempt += 1;
      if (deletionAttempt === 1) return Promise.reject(new Error('offline'));
      if (deletionAttempt === 2)
        return Promise.resolve({ schemaVersion: 1, done: false, stage: 'records' as const });
      return Promise.resolve({ schemaVersion: 1, done: true, stage: 'done' as const });
    });
    const client = { call } as unknown as AccountSyncClient;
    const sync = new CloudSyncService(client, repository, outbox, {
      getScope: () => progress.getScope(),
    });
    const auth = new AuthService(storage, progress, repository, outbox, sync, client, 4);
    await auth.initialize();

    await expect(auth.deleteAccount()).resolves.toBe(false);
    expect(repository.loadAccountCache()).not.toBeNull();
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('account');
    expect(progress.getScope()).toBe('account');
    expect(auth.getState()).toMatchObject({ status: 'authenticated', notice: expect.any(String) });

    await expect(auth.deleteAccount()).resolves.toBe(true);
    expect(repository.loadAccountCache()).toBeNull();
    expect(storage.get(AUTH_PREFERENCE_KEY)).toBe('guest');
    expect(progress.getScope()).toBe('guest');
    expect(progress.getDashboard('2026-09-02').answered).toBe(3);
  });
});

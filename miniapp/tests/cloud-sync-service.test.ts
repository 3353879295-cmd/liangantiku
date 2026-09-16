import { describe, expect, it } from 'vitest';

import {
  CloudSyncService,
  type AccountSyncCaller,
} from '../miniprogram/services/cloud-sync-service';
import { AccountSyncClient } from '../miniprogram/repositories/account-sync-client';
import { createEmptyProgress } from '../miniprogram/storage/migrations';
import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import { SyncOutbox } from '../miniprogram/storage/sync-outbox';
import type { AccountSyncRequest, AccountSyncSnapshot } from '../miniprogram/types/account-sync';
import type { StorageAdapter } from '../miniprogram/types/domain';

class MemoryStorage implements StorageAdapter {
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

const snapshot = (profileRevision = 0, progressRevision = 0): AccountSyncSnapshot => ({
  schemaVersion: 1,
  avatarUploadPathPrefix: `account-avatars/${'a'.repeat(64)}`,
  profileRevision,
  progressRevision,
  syncedAt: '2026-09-02T00:00:00.000Z',
  profile: {
    nickname: '仓廪小麦',
    avatarUrl: '',
    selectedCertificateKey: '4-02-06-01:5',
    dailyGoal: 20,
    answerTheme: 'light',
    answerRevealMode: 'immediate',
  },
  progress: createEmptyProgress(),
});

describe('CloudSyncService', () => {
  it('exposes the validated server-derived avatar upload prefix', () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const service = new CloudSyncService(
      { call: () => Promise.resolve(snapshot()) },
      repository,
      new SyncOutbox(storage),
      { getScope: () => 'account' },
    );

    expect(service.getAvatarUploadPathPrefix()).toBe(`account-avatars/${'a'.repeat(64)}`);
  });

  it('restores a legacy snapshot while disabling avatar uploads', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    const legacySnapshot = snapshot();
    legacySnapshot.avatarUploadPathPrefix = '';
    legacySnapshot.progress.summary.answered = 6;
    const service = new CloudSyncService(
      { call: () => Promise.resolve(legacySnapshot) },
      repository,
      new SyncOutbox(storage),
      { getScope: () => 'account' },
    );

    await expect(service.bootstrap()).resolves.toBe(true);
    expect(repository.load('account').data.summary.answered).toBe(6);
    expect(service.getAvatarUploadPathPrefix()).toBeNull();
  });

  it('normalizes a raw legacy bootstrap response before restoring account progress', async () => {
    const storage = new MemoryStorage();
    const rawSnapshot = snapshot();
    rawSnapshot.progress.summary.answered = 6;
    Reflect.deleteProperty(rawSnapshot, 'avatarUploadPathPrefix');
    const service = new CloudSyncService(
      new AccountSyncClient(() => Promise.resolve({ result: { ok: true, data: rawSnapshot } })),
      new ProgressRepository(storage),
      new SyncOutbox(storage),
      { getScope: () => 'account' },
    );

    await expect(service.bootstrap()).resolves.toBe(true);
    expect(new ProgressRepository(storage).load('account').data.summary.answered).toBe(6);
    expect(service.getAvatarUploadPathPrefix()).toBeNull();
  });
  it('holds progress commands while a durable learning clear is pending but keeps profile writes', () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const service = new CloudSyncService(
      { call: () => Promise.resolve(snapshot()) },
      repository,
      new SyncOutbox(storage),
      { getScope: () => 'account', isClearPending: () => true },
    );
    expect(service.enqueue({ action: 'setFavorite', questionId: 'Q1', favorite: true })).toBe(
      false,
    );
    expect(
      service.enqueue({ action: 'updateProfile', nickname: '资料仍可改', avatarUrl: '' }),
    ).toBe(true);
  });

  it('defers retained profile commands until clearing completes, then sends exactly once', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    let clearing = true;
    const calls: unknown[] = [];
    const service = new CloudSyncService(
      {
        call: (request) => {
          calls.push(request);
          const next = snapshot(1, 0);
          next.profile.nickname = '清除后资料';
          return Promise.resolve(next);
        },
      },
      repository,
      new SyncOutbox(storage),
      { getScope: () => 'account', isClearPending: () => clearing },
    );
    service.enqueue({ action: 'updateProfile', nickname: '清除后资料', avatarUrl: '' });
    await service.process();
    expect(calls).toEqual([]);
    expect(service.getState()).toMatchObject({ status: 'pending', pendingCount: 1 });

    clearing = false;
    await service.process();
    expect(calls).toEqual([expect.objectContaining({ action: 'updateProfile' })]);
    expect(repository.loadAccountCache()?.profile.nickname).toBe('清除后资料');
  });

  it('never calls cloud functions in guest scope', async () => {
    const calls: unknown[] = [];
    const client: AccountSyncCaller = {
      call: (request) => {
        calls.push(request);
        return Promise.resolve(snapshot());
      },
    };
    const storage = new MemoryStorage();
    const service = new CloudSyncService(
      client,
      new ProgressRepository(storage),
      new SyncOutbox(storage),
      { getScope: () => 'guest' },
    );
    expect(service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true })).toBe(
      false,
    );
    expect(await service.bootstrap()).toBe(false);
    await service.process();
    expect(calls).toEqual([]);
  });

  it('serializes pending commands and retries transient failures with the original id', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    const requests: { action: string; expectedRevision?: number }[] = [];
    let failures = 1;
    const client: AccountSyncCaller = {
      call: (request) => {
        requests.push(request);
        if (request.action === 'setFavorite' && failures-- > 0) {
          return Promise.reject(
            Object.assign(new Error('offline'), { code: 'ACCOUNT_SYNC_UNAVAILABLE' }),
          );
        }
        return Promise.resolve(snapshot(0, request.action === 'setFavorite' ? 1 : 2));
      },
    };
    let commandNumber = 0;
    const service = new CloudSyncService(
      client,
      repository,
      new SyncOutbox(
        storage,
        () => 1,
        () => `stable-id-${++commandNumber}`,
      ),
      { getScope: () => 'account', sleep: () => Promise.resolve(), maxAttempts: 2 },
    );
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    service.enqueue({ action: 'markMastered', questionId: 'q1', mastered: true });
    await service.process();
    expect(requests.map((item) => item.action)).toEqual([
      'setFavorite',
      'setFavorite',
      'markMastered',
    ]);
    expect(requests.map((item) => item.expectedRevision)).toEqual([0, 0, 1]);
    expect(service.getState().status).toBe('idle');
  });

  it('replays persisted commands before bootstrap using their original revision', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(2, 3) });
    const outbox = new SyncOutbox(storage);
    outbox.enqueue({
      action: 'setFavorite',
      schemaVersion: 1,
      expectedRevision: 3,
      questionId: 'q1',
      favorite: true,
    });
    const calls: { action: string; expectedRevision?: number }[] = [];
    const client: AccountSyncCaller = {
      call: (request) => {
        calls.push(request);
        return Promise.resolve(request.action === 'bootstrap' ? snapshot(2, 4) : snapshot(2, 4));
      },
    };
    const service = new CloudSyncService(client, repository, outbox, {
      getScope: () => 'account',
    });

    await service.bootstrap();
    expect(calls).toEqual([
      expect.objectContaining({ action: 'setFavorite', expectedRevision: 3 }),
      expect.objectContaining({ action: 'bootstrap' }),
    ]);
  });

  it('keeps a persisted preference command payload unchanged through bootstrap and retry', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(19, 0) });
    const outbox = new SyncOutbox(storage);
    const command = {
      action: 'updatePreferences' as const,
      schemaVersion: 1 as const,
      expectedRevision: 19,
      selectedCertificateKey: '4-08-05-01:4' as const,
      dailyGoal: 20,
      answerTheme: 'light' as const,
      answerRevealMode: 'immediate' as const,
    };
    outbox.enqueue(command);
    const requests: AccountSyncRequest[] = [];
    const matchingSnapshot = snapshot(20, 0);
    matchingSnapshot.profile = {
      ...matchingSnapshot.profile,
      selectedCertificateKey: command.selectedCertificateKey,
    };
    const service = new CloudSyncService(
      {
        call: (request) => {
          requests.push(request);
          return Promise.resolve(
            request.action === 'bootstrap' ? matchingSnapshot : matchingSnapshot,
          );
        },
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );

    await service.bootstrap();
    expect(requests[0]).toMatchObject(command);

    const retryOutbox = new SyncOutbox(storage);
    retryOutbox.enqueue({ ...command, expectedRevision: 20 });
    const retryRequests: AccountSyncRequest[] = [];
    const retryService = new CloudSyncService(
      {
        call: (request) => {
          retryRequests.push(request);
          return Promise.resolve(matchingSnapshot);
        },
      },
      repository,
      retryOutbox,
      { getScope: () => 'account' },
    );
    await retryService.retry();
    expect(retryRequests).toEqual([expect.objectContaining({ ...command, expectedRevision: 20 })]);
  });

  it('blocks a preference response that does not confirm the sent payload', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    const cached = snapshot(19, 3);
    cached.progress.summary.answered = 10;
    repository.saveAccountCache({ cacheVersion: 1, ...cached });
    const outbox = new SyncOutbox(storage);
    const command = {
      action: 'updatePreferences' as const,
      selectedCertificateKey: '4-08-05-01:4' as const,
      dailyGoal: 20,
      answerTheme: 'light' as const,
      answerRevealMode: 'immediate' as const,
    };
    const service = new CloudSyncService(
      { call: () => Promise.resolve(snapshot(19, 3)) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    service.enqueue(command);
    const cacheBefore = repository.loadAccountCache();
    const outboxBefore = outbox.list();

    await service.process();

    expect(outbox.isBlocked).toBe(true);
    expect(outbox.list()).toEqual(outboxBefore);
    expect(repository.loadAccountCache()).toEqual(cacheBefore);
    expect(service.getState()).toMatchObject({ status: 'conflict', pendingCount: 1 });

    const calls: AccountSyncRequest[] = [];
    const restarted = new CloudSyncService(
      {
        call: (request) => {
          calls.push(request);
          return Promise.resolve(snapshot());
        },
      },
      repository,
      new SyncOutbox(storage),
      { getScope: () => 'account' },
    );
    await restarted.bootstrap();
    await restarted.retry();
    expect(calls).toEqual([]);
    expect(restarted.getState()).toMatchObject({ status: 'conflict', pendingCount: 1 });
  });

  it('confirms a preference command when the returned profile matches it', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(19, 3) });
    const outbox = new SyncOutbox(storage);
    const response = snapshot(20, 3);
    response.profile = {
      ...response.profile,
      selectedCertificateKey: '4-08-05-01:4',
      dailyGoal: 30,
      answerTheme: 'night',
      answerRevealMode: 'deferred',
    };
    const service = new CloudSyncService(
      { call: () => Promise.resolve(response) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    service.enqueue({
      action: 'updatePreferences',
      selectedCertificateKey: '4-08-05-01:4',
      dailyGoal: 30,
      answerTheme: 'night',
      answerRevealMode: 'deferred',
    });

    await service.process();

    expect(outbox.list()).toEqual([]);
    expect(outbox.isBlocked).toBe(false);
    expect(repository.loadAccountCache()).toMatchObject({
      profileRevision: 20,
      profile: response.profile,
    });
  });

  it('does not overwrite a completed practice sync with a late bootstrap snapshot', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(0, 0) });
    let resolveBootstrap: ((value: AccountSyncSnapshot) => void) | undefined;
    const client: AccountSyncCaller = {
      call: (request) => {
        if (request.action === 'bootstrap') {
          return new Promise<AccountSyncSnapshot>((resolve) => {
            resolveBootstrap = resolve;
          });
        }
        return Promise.resolve(snapshot(0, 1));
      },
    };
    const service = new CloudSyncService(client, repository, new SyncOutbox(storage), {
      getScope: () => 'account',
    });

    const bootstrapping = service.bootstrap();
    await Promise.resolve();
    const optimistic = repository.load('account').data;
    optimistic.summary.answered = 12;
    repository.save('account', optimistic);
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    await service.process();
    resolveBootstrap?.(snapshot(0, 0));

    await expect(bootstrapping).resolves.toBe(true);
    expect(repository.loadAccountCache()?.progressRevision).toBe(1);
  });

  it('waits for an in-flight sync before applying a bootstrap snapshot', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(0, 0) });
    let resolveBootstrap: ((value: AccountSyncSnapshot) => void) | undefined;
    let resolvePractice: ((value: AccountSyncSnapshot) => void) | undefined;
    const client: AccountSyncCaller = {
      call: (request) => {
        if (request.action === 'bootstrap') {
          return new Promise<AccountSyncSnapshot>((resolve) => {
            resolveBootstrap = resolve;
          });
        }
        return new Promise<AccountSyncSnapshot>((resolve) => {
          resolvePractice = resolve;
        });
      },
    };
    const service = new CloudSyncService(client, repository, new SyncOutbox(storage), {
      getScope: () => 'account',
    });

    const bootstrapping = service.bootstrap();
    await Promise.resolve();
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    const processing = service.process();
    await Promise.resolve();
    resolveBootstrap?.(snapshot(0, 0));
    await Promise.resolve();
    expect(repository.loadAccountCache()?.progressRevision).toBe(0);
    resolvePractice?.(snapshot(0, 1));

    await Promise.all([bootstrapping, processing]);
    expect(repository.loadAccountCache()?.progressRevision).toBe(1);
  });

  it('retains a pending optimistic projection when a late bootstrap arrives after sync failure', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(0, 0) });
    let resolveBootstrap: ((value: AccountSyncSnapshot) => void) | undefined;
    const client: AccountSyncCaller = {
      call: (request) => {
        if (request.action === 'bootstrap') {
          return new Promise<AccountSyncSnapshot>((resolve) => {
            resolveBootstrap = resolve;
          });
        }
        return Promise.reject(
          Object.assign(new Error('offline'), { code: 'ACCOUNT_SYNC_UNAVAILABLE' }),
        );
      },
    };
    const outbox = new SyncOutbox(storage);
    const service = new CloudSyncService(client, repository, outbox, {
      getScope: () => 'account',
      maxAttempts: 1,
    });

    const bootstrapping = service.bootstrap();
    await Promise.resolve();
    const optimistic = repository.load('account').data;
    optimistic.summary.answered = 12;
    repository.save('account', optimistic);
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    await service.process();
    resolveBootstrap?.(snapshot(0, 0));

    await expect(bootstrapping).resolves.toBe(true);
    expect(outbox.list()).toEqual([
      expect.objectContaining({ action: 'setFavorite', state: 'pending' }),
    ]);
    expect(repository.loadAccountCache()?.progress.summary.answered).toBe(12);
    expect(service.getState().status).toBe('failed');
  });

  it('keeps local cache and pending journal when an older bootstrap response arrives during a conflict', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(0, 0) });
    let resolveOriginalBootstrap: ((value: AccountSyncSnapshot) => void) | undefined;
    const client: AccountSyncCaller = {
      call: (request) => {
        if (request.action !== 'bootstrap') {
          return Promise.reject(
            Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' }),
          );
        }
        return new Promise<AccountSyncSnapshot>((resolve) => {
          resolveOriginalBootstrap = resolve;
        });
      },
    };
    const service = new CloudSyncService(client, repository, new SyncOutbox(storage), {
      getScope: () => 'account',
    });

    const bootstrapping = service.bootstrap();
    await Promise.resolve();
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    const processing = service.process();
    await Promise.resolve();
    resolveOriginalBootstrap?.(snapshot(0, 0));

    await Promise.all([bootstrapping, processing]);
    expect(service.getState()).toMatchObject({
      status: 'conflict',
      pendingCount: 1,
      notice: '本地待同步记录已保留；检测到数据冲突，需要处理后才能继续同步。',
    });
    expect(repository.loadAccountCache()?.progressRevision).toBe(0);
  });

  it('coalesces same-type pending commands without advancing their revision', () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(4, 8) });
    const outbox = new SyncOutbox(storage);
    const service = new CloudSyncService(
      { call: () => Promise.resolve(snapshot()) },
      repository,
      outbox,
      {
        getScope: () => 'account',
      },
    );
    service.enqueue({ action: 'updateProfile', nickname: '甲', avatarUrl: '' });
    service.enqueue({ action: 'updateProfile', nickname: '乙', avatarUrl: '' });
    expect(outbox.list()).toEqual([
      expect.objectContaining({ action: 'updateProfile', nickname: '乙', expectedRevision: 4 }),
    ]);
  });

  it('keeps an in-flight request immutable and preserves later optimistic progress until convergence', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(0, 0) });
    const resolvers: ((value: AccountSyncSnapshot) => void)[] = [];
    const requests: { action: string; expectedRevision?: number }[] = [];
    const client: AccountSyncCaller = {
      call: (request) => {
        requests.push(request);
        return new Promise<AccountSyncSnapshot>((resolve) => resolvers.push(resolve));
      },
    };
    const outbox = new SyncOutbox(storage);
    const service = new CloudSyncService(client, repository, outbox, { getScope: () => 'account' });
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    const processing = service.process();
    await Promise.resolve();
    const optimistic = repository.load('account').data;
    optimistic.summary.answered = 99;
    repository.save('account', optimistic);
    service.enqueue({ action: 'markMastered', questionId: 'q1', mastered: true });
    resolvers.shift()?.(snapshot(0, 1));
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toEqual([
      expect.objectContaining({ action: 'setFavorite', expectedRevision: 0 }),
      expect.objectContaining({ action: 'markMastered', expectedRevision: 1 }),
    ]);
    expect(repository.loadAccountCache()?.progress.summary.answered).toBe(99);
    resolvers.shift()?.(snapshot(0, 2));
    await processing;
    expect(repository.loadAccountCache()?.progress.summary.answered).toBe(0);
  });

  it('preserves every command and optimistic cache on a revision conflict without bootstrap recovery', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    const cached = snapshot(4, 8);
    cached.progress.summary.answered = 17;
    repository.saveAccountCache({ cacheVersion: 1, ...cached });
    let commandNumber = 0;
    const outbox = new SyncOutbox(
      storage,
      () => 1,
      () => `command-${++commandNumber}`,
    );
    const calls: unknown[] = [];
    const client: AccountSyncCaller = {
      call: (request) => {
        calls.push(request);
        return Promise.reject(Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' }));
      },
    };
    const service = new CloudSyncService(client, repository, outbox, { getScope: () => 'account' });
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    service.enqueue({ action: 'markMastered', questionId: 'q2', mastered: true });
    service.enqueue({ action: 'saveActiveSession', session: null });
    service.enqueue({ action: 'recordPractice', sessionId: 's1', mode: 'random', answers: [] });
    const before = outbox.list();
    const cacheBefore = repository.loadAccountCache();
    await service.process();
    expect(calls).toEqual([
      expect.objectContaining({ action: 'setFavorite', expectedRevision: 8 }),
    ]);
    expect(service.getState()).toMatchObject({
      status: 'conflict',
      pendingCount: 4,
      notice: '本地待同步记录已保留；检测到数据冲突，需要处理后才能继续同步。',
    });
    expect(outbox.isBlocked).toBe(true);
    expect(outbox.list()).toEqual(before.map((command) => ({ ...command, state: 'pending' })));
    expect(repository.loadAccountCache()).toEqual(cacheBefore);
  });

  it('keeps a persisted conflict blocked across restart without cloud calls', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(0, 0) });
    const outbox = new SyncOutbox(storage);
    outbox.enqueue({
      action: 'setFavorite',
      schemaVersion: 1,
      expectedRevision: 0,
      questionId: 'q1',
      favorite: true,
    });
    const initial = new CloudSyncService(
      {
        call: () =>
          Promise.reject(Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' })),
      },
      repository,
      outbox,
      {
        getScope: () => 'account',
      },
    );
    await initial.process();
    const cacheBefore = repository.loadAccountCache();
    const outboxBefore = outbox.list();
    const calls: unknown[] = [];
    const restarted = new CloudSyncService(
      {
        call: (request) => {
          calls.push(request);
          return Promise.resolve(snapshot());
        },
      },
      repository,
      new SyncOutbox(storage),
      {
        getScope: () => 'account',
      },
    );

    await expect(restarted.bootstrap()).resolves.toBe(true);
    await restarted.retry();
    await restarted.process();
    expect(calls).toEqual([]);
    expect(new SyncOutbox(storage).list()).toEqual(outboxBefore);
    expect(repository.loadAccountCache()).toEqual(cacheBefore);
    expect(restarted.getState()).toMatchObject({ status: 'conflict', pendingCount: 1 });
  });

  it('appends without coalescing or rebasing while blocked, then clear resets the block', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(1, 2) });
    const outbox = new SyncOutbox(storage);
    const client: AccountSyncCaller = {
      call: () =>
        Promise.reject(Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' })),
    };
    const service = new CloudSyncService(client, repository, outbox, { getScope: () => 'account' });
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    await service.process();
    const original = outbox.list();
    service.enqueue({ action: 'saveActiveSession', session: null });
    service.enqueue({ action: 'saveActiveSession', session: null });
    expect(outbox.list().slice(0, 1)).toEqual(original);
    expect(
      outbox
        .list()
        .slice(1)
        .map((command) => command.expectedRevision),
    ).toEqual([2, 2]);
    expect(outbox.list()).toHaveLength(3);
    outbox.clear();
    expect(outbox.isBlocked).toBe(false);
    expect(outbox.list()).toEqual([]);
  });
});

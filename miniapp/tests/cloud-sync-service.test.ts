import { describe, expect, it } from 'vitest';

import {
  CloudSyncService,
  type AccountSyncCaller,
} from '../miniprogram/services/cloud-sync-service';
import { createEmptyProgress } from '../miniprogram/storage/migrations';
import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import { SyncOutbox } from '../miniprogram/storage/sync-outbox';
import type { AccountSyncSnapshot } from '../miniprogram/types/account-sync';
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

  it('drops unsafe commands and restores the cloud snapshot on a revision conflict', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
    let bootstrapCalls = 0;
    const client: AccountSyncCaller = {
      call: (request) => {
        if (request.action === 'bootstrap') {
          bootstrapCalls += 1;
          return Promise.resolve(snapshot(5, 6));
        }
        return Promise.reject(Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' }));
      },
    };
    const service = new CloudSyncService(client, repository, new SyncOutbox(storage), {
      getScope: () => 'account',
    });
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    service.enqueue({ action: 'markMastered', questionId: 'q1', mastered: true });
    await service.process();
    expect(bootstrapCalls).toBe(1);
    expect(service.getState()).toMatchObject({
      status: 'conflict',
      pendingCount: 0,
      notice: '数据已在其他设备更新，已恢复云端记录',
    });
    expect(repository.loadAccountCache()?.progressRevision).toBe(6);
  });

  it('treats a successfully recovered startup conflict as an authenticated bootstrap', async () => {
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
    const client: AccountSyncCaller = {
      call: (request) =>
        request.action === 'bootstrap'
          ? Promise.resolve(snapshot(4, 5))
          : Promise.reject(Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' })),
    };
    const service = new CloudSyncService(client, repository, outbox, {
      getScope: () => 'account',
    });

    await expect(service.bootstrap()).resolves.toBe(true);
    expect(service.getState()).toMatchObject({ status: 'conflict', pendingCount: 0 });
  });

  it('retains the outbox and cache when conflict recovery bootstrap fails', async () => {
    const storage = new MemoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveAccountCache({ cacheVersion: 1, ...snapshot(1, 2) });
    const outbox = new SyncOutbox(storage);
    const client: AccountSyncCaller = {
      call: (request) =>
        Promise.reject(
          Object.assign(new Error(request.action === 'bootstrap' ? 'offline' : 'conflict'), {
            code: request.action === 'bootstrap' ? 'ACCOUNT_SYNC_UNAVAILABLE' : 'REVISION_CONFLICT',
          }),
        ),
    };
    const service = new CloudSyncService(client, repository, outbox, { getScope: () => 'account' });
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    await service.process();
    expect(outbox.list()).toHaveLength(1);
    expect(outbox.list()[0]).toMatchObject({ state: 'pending', expectedRevision: 2 });
    expect(repository.loadAccountCache()?.progressRevision).toBe(2);
    expect(service.getState().status).toBe('failed');
  });
});

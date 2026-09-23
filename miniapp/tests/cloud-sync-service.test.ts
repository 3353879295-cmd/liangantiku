import { AccountSyncClient } from '../miniprogram/repositories/account-sync-client';
import { describe, expect, it } from 'vitest';
import {
  CloudSyncService,
  type AccountSyncCaller,
} from '../miniprogram/services/cloud-sync-service';
import { createEmptyProgress } from '../miniprogram/storage/migrations';
import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import { SyncOutbox } from '../miniprogram/storage/sync-outbox';
import { ProgressService } from '../miniprogram/services/progress-service';
import type { AccountSyncSnapshot } from '../miniprogram/types/account-sync';
import type { StorageAdapter } from '../miniprogram/types/domain';

class MemoryStorage implements StorageAdapter {
  private values = new Map<string, unknown>();
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
const prefix = `account-avatars/${'a'.repeat(64)}`;
const snapshot = (
  profileRevision = 0,
  progressRevision = 0,
  avatarUploadPathPrefix = prefix,
): AccountSyncSnapshot => ({
  schemaVersion: 1,
  avatarUploadPathPrefix,
  profileRevision,
  progressRevision,
  syncedAt: '2026-09-19T00:00:00.000Z',
  profile: {
    nickname: '用户',
    avatarUrl: '',
    selectedCertificateKey: '4-02-06-01:5',
    dailyGoal: 20,
    answerTheme: 'light',
    answerRevealMode: 'immediate',
  },
  progress: createEmptyProgress(),
});
const setup = () => {
  const storage = new MemoryStorage();
  const repository = new ProgressRepository(storage);
  repository.saveAccountCache({ cacheVersion: 1, ...snapshot() });
  const outbox = new SyncOutbox(storage);
  return { storage, repository, outbox };
};
const submittedSession = (id = 'submitted-session') => ({
  id,
  mode: 'random' as const,
  questionIds: ['Q1'],
  currentIndex: 0,
  answers: { Q1: ['A'] },
  status: 'submitted' as const,
  startedAt: 1,
  updatedAt: 2,
  submittedAt: 2,
  progressRecorded: true,
  answerRevealMode: 'immediate' as const,
});
const activeSession = (id = 'active-session') => {
  const session = submittedSession(id);
  Reflect.deleteProperty(session, 'submittedAt');
  return {
    ...session,
    status: 'active' as const,
    progressRecorded: false,
  };
};
const withSession = (
  base: AccountSyncSnapshot,
  session: ReturnType<typeof submittedSession> | ReturnType<typeof activeSession> | null,
  recordedSessionIds: string[] = [],
): AccountSyncSnapshot => ({
  ...base,
  progress: { ...base.progress, session, recordedSessionIds },
});

describe('CloudSyncService automatic recovery', () => {
  it('reads cloud first and automatically resumes a persisted blocked journal', async () => {
    const { repository, outbox } = setup();
    outbox.enqueue({
      action: 'setFavorite',
      schemaVersion: 1,
      expectedRevision: 0,
      questionId: 'q1',
      favorite: true,
    });
    outbox.block();
    const calls: string[] = [];
    const service = new CloudSyncService(
      {
        call: (request) => {
          calls.push(request.action);
          return Promise.resolve(request.action === 'bootstrap' ? snapshot(2, 5) : snapshot(2, 6));
        },
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await expect(service.bootstrap()).resolves.toBe(true);
    expect(calls).toEqual(['bootstrap', 'setFavorite']);
    expect(outbox.size).toBe(0);
    expect(outbox.isBlocked).toBe(false);
  });

  it('rebases a revision conflict on a fresh snapshot and replays the same command', async () => {
    const { repository, outbox } = setup();
    const calls: { action: string; expectedRevision?: number }[] = [];
    let conflicted = false;
    const client: AccountSyncCaller = {
      call: (request) => {
        calls.push(request);
        if (request.action === 'bootstrap') return Promise.resolve(snapshot(0, conflicted ? 4 : 0));
        if (!conflicted) {
          conflicted = true;
          return Promise.reject(
            Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' }),
          );
        }
        return Promise.resolve(snapshot(0, 5));
      },
    };
    const service = new CloudSyncService(client, repository, outbox, { getScope: () => 'account' });
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    await service.process();
    expect(calls.map((item) => item.action)).toEqual([
      'bootstrap',
      'setFavorite',
      'bootstrap',
      'setFavorite',
    ]);
    expect(calls.at(-1)).toMatchObject({ expectedRevision: 4 });
    expect(outbox.size).toBe(0);
  });

  it('refreshes cloud data on retry even when the queue is empty', async () => {
    const { repository, outbox } = setup();
    let revision = 0;
    const service = new CloudSyncService(
      { call: () => Promise.resolve(snapshot(0, ++revision)) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await service.retry();
    expect(repository.loadAccountCache()?.progressRevision).toBe(1);
    await service.retry();
    expect(repository.loadAccountCache()?.progressRevision).toBe(2);
  });

  it('keeps offline writes and sends them when a later retry succeeds', async () => {
    const { repository, outbox } = setup();
    let online = false;
    const service = new CloudSyncService(
      {
        call: (request) => {
          if (!online)
            return Promise.reject(
              Object.assign(new Error('offline'), { code: 'ACCOUNT_SYNC_UNAVAILABLE' }),
            );
          return Promise.resolve(request.action === 'bootstrap' ? snapshot() : snapshot(0, 1));
        },
      },
      repository,
      outbox,
      { getScope: () => 'account', maxAttempts: 1 },
    );
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    await service.process();
    expect(outbox.size).toBe(1);
    online = true;
    await service.retry();
    expect(outbox.size).toBe(0);
  });

  it('bounds a hot conflict loop and leaves the command pending for foreground retry', async () => {
    const { repository, outbox } = setup();
    const service = new CloudSyncService(
      {
        call: (request) =>
          request.action === 'bootstrap'
            ? Promise.resolve(snapshot())
            : Promise.reject(Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' })),
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    await service.process();
    expect(outbox.size).toBe(1);
    expect(outbox.isBlocked).toBe(false);
    expect(service.getState().status).toBe('failed');
  });

  it('archives a different account journal and loads the verified new account without replaying it', async () => {
    const { repository, outbox } = setup();
    outbox.enqueue({
      action: 'setFavorite',
      schemaVersion: 1,
      expectedRevision: 0,
      questionId: 'q1',
      favorite: true,
    });
    const other = `account-avatars/${'b'.repeat(64)}`;
    const calls: string[] = [];
    const service = new CloudSyncService(
      {
        call: (request) => {
          calls.push(request.action);
          return Promise.resolve(snapshot(0, 0, other));
        },
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await expect(service.bootstrap()).resolves.toBe(true);
    expect(calls).toEqual(['bootstrap']);
    expect(outbox.size).toBe(0);
    expect(repository.loadAccountCache()?.avatarUploadPathPrefix).toBe(other);
    repository.switchAccount(snapshot(), outbox);
    expect(outbox.list()).toMatchObject([{ action: 'setFavorite', questionId: 'q1' }]);
  });

  it('ignores an in-flight response after suspend clears the journal', async () => {
    const { repository, outbox } = setup();
    let resolve!: (value: AccountSyncSnapshot) => void;
    const service = new CloudSyncService(
      {
        call: (request) =>
          request.action === 'bootstrap'
            ? Promise.resolve(snapshot())
            : new Promise((done) => {
                resolve = done;
              }),
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await service.bootstrap();
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    const syncing = service.process();
    await Promise.resolve();
    service.suspend();
    outbox.clear();
    resolve(snapshot(0, 1));
    await syncing;
    expect(outbox.size).toBe(0);
    expect(repository.loadAccountCache()?.progressRevision).toBe(0);
  });

  it('uses one shared bootstrap/process flight', async () => {
    const { repository, outbox } = setup();
    let calls = 0;
    let resolve!: (value: AccountSyncSnapshot) => void;
    const service = new CloudSyncService(
      {
        call: () => {
          calls += 1;
          return calls === 1
            ? new Promise((done) => {
                resolve = done;
              })
            : Promise.resolve(snapshot());
        },
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    const first = service.bootstrap();
    const second = service.retry();
    resolve(snapshot());
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it('never uploads from guest scope', async () => {
    const { repository, outbox } = setup();
    let calls = 0;
    const service = new CloudSyncService(
      {
        call: () => {
          calls += 1;
          return Promise.resolve(snapshot());
        },
      },
      repository,
      outbox,
      { getScope: () => 'guest' },
    );
    expect(service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true })).toBe(
      false,
    );
    await service.process();
    expect(calls).toBe(0);
  });

  it('backs off transient transport failures without changing the command revision', async () => {
    const { repository, outbox } = setup();
    let attempts = 0;
    const waits: number[] = [];
    const service = new CloudSyncService(
      {
        call: (request) => {
          if (request.action === 'bootstrap') return Promise.resolve(snapshot());
          attempts += 1;
          return attempts < 3
            ? Promise.reject(
                Object.assign(new Error('offline'), { code: 'ACCOUNT_SYNC_UNAVAILABLE' }),
              )
            : Promise.resolve(snapshot(0, 1));
        },
      },
      repository,
      outbox,
      {
        getScope: () => 'account',
        maxAttempts: 3,
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
    );
    service.enqueue({ action: 'setFavorite', questionId: 'q1', favorite: true });
    await service.process();
    expect(attempts).toBe(3);
    expect(waits).toEqual([250, 500]);
    expect(outbox.size).toBe(0);
  });

  it('keeps profile writes behind a learning-clear barrier', async () => {
    const { repository, outbox } = setup();
    let clearing = true;
    const calls: string[] = [];
    const service = new CloudSyncService(
      {
        call: (request) => {
          calls.push(request.action);
          return Promise.resolve(request.action === 'bootstrap' ? snapshot() : snapshot(1, 0));
        },
      },
      repository,
      outbox,
      { getScope: () => 'account', isClearPending: () => clearing },
    );
    service.enqueue({ action: 'updateProfile', nickname: '资料', avatarUrl: '' });
    await service.process();
    expect(calls).toEqual([]);
    clearing = false;
    await service.process();
    expect(calls).toEqual(['bootstrap', 'updateProfile']);
  });

  it('retains a preference command when cloud does not confirm its values', async () => {
    const { repository, outbox } = setup();
    const service = new CloudSyncService(
      {
        call: (request) =>
          Promise.resolve(request.action === 'bootstrap' ? snapshot() : snapshot(1, 0)),
      },
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
    expect(outbox.size).toBe(1);
    expect(service.getState().status).toBe('failed');
  });
});

describe('account sync concurrency and failure retention', () => {
  it('keeps optimistic progress until all immutable in-flight and newly queued edits are acknowledged', async () => {
    const { repository, outbox } = setup();
    let finish!: (value: AccountSyncSnapshot) => void;
    let writes = 0;
    const requests: unknown[] = [];
    const service = new CloudSyncService(
      {
        call: (request) => {
          if (request.action === 'bootstrap') return Promise.resolve(snapshot());
          requests.push(request);
          if (++writes === 1)
            return new Promise((resolve) => {
              finish = resolve;
            });
          expect(repository.loadAccountCache()?.progress.summary.answered).toBe(9);
          return Promise.resolve(snapshot(2));
        },
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await service.bootstrap();
    service.enqueue({ action: 'updateProfile', nickname: 'first', avatarUrl: '' });
    const saving = service.process();
    const optimistic = repository.load('account').data;
    optimistic.summary.answered = 9;
    repository.save('account', optimistic);
    service.enqueue({ action: 'updateProfile', nickname: 'second', avatarUrl: '' });
    expect(outbox.size).toBe(2);
    finish(snapshot(1));
    await saving;
    expect(requests).toMatchObject([
      { nickname: 'first', expectedRevision: 0 },
      { nickname: 'second', expectedRevision: 1 },
    ]);
    expect(outbox.size).toBe(0);
  });

  it('keeps a retried command immutable when another edit is made during conflict recovery', async () => {
    const { repository, outbox } = setup();
    let finish!: (value: AccountSyncSnapshot) => void;
    let onRetry!: () => void;
    const retryStarted = new Promise<void>((resolve) => {
      onRetry = resolve;
    });
    const names: string[] = [];
    let writes = 0;
    const service = new CloudSyncService(
      {
        call: (request) => {
          if (request.action === 'bootstrap') return Promise.resolve(snapshot(3));
          if (request.action === 'updateProfile') names.push(request.nickname);
          writes += 1;
          if (writes === 1)
            return Promise.reject(
              Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' }),
            );
          if (writes === 2)
            return new Promise((resolve) => {
              finish = resolve;
              onRetry();
            });
          return Promise.resolve(snapshot(5));
        },
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    service.enqueue({ action: 'updateProfile', nickname: 'first', avatarUrl: '' });
    const saving = service.process();
    await retryStarted;
    service.enqueue({ action: 'updateProfile', nickname: 'second', avatarUrl: '' });
    expect(outbox.size).toBe(2);
    finish(snapshot(4));
    await saving;
    expect(names).toEqual(['first', 'first', 'second']);
    expect(outbox.size).toBe(0);
  });

  it('awaits a foreground refresh requested during an upload before notifying callers', async () => {
    const { repository, outbox } = setup();
    let finish!: (value: AccountSyncSnapshot) => void;
    let pulls = 0;
    const service = new CloudSyncService(
      {
        call: (request) =>
          request.action === 'bootstrap'
            ? Promise.resolve(snapshot(0, pulls++ === 0 ? 0 : 2))
            : new Promise((resolve) => {
                finish = resolve;
              }),
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await service.bootstrap();
    service.enqueue({ action: 'setFavorite', questionId: 'Q1', favorite: true });
    const saving = service.process();
    const refreshing = service.retry();
    finish(snapshot(0, 1));
    await Promise.all([saving, refreshing]);
    expect(pulls).toBe(2);
    expect(repository.loadAccountCache()?.progressRevision).toBe(2);
  });

  it('resumes a suspended in-flight command on the next login instead of leaving it sending', async () => {
    const { repository, outbox } = setup();
    let finish!: (value: AccountSyncSnapshot) => void;
    let writes = 0;
    const service = new CloudSyncService(
      {
        call: (request) =>
          request.action === 'bootstrap'
            ? Promise.resolve(snapshot())
            : ++writes === 1
              ? new Promise((resolve) => {
                  finish = resolve;
                })
              : Promise.resolve(snapshot(0, 1)),
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await service.bootstrap();
    service.enqueue({ action: 'setFavorite', questionId: 'Q1', favorite: true });
    const saving = service.process();
    service.suspend();
    expect(outbox.list()[0]?.state).toBe('pending');
    const login = service.bootstrap();
    finish(snapshot(0, 1));
    await saving;
    await expect(login).resolves.toBe(true);
    expect(writes).toBe(2);
    expect(outbox.size).toBe(0);
  });

  it.each(['SCHEMA_INCOMPATIBLE', 'ACCOUNT_DELETING'])(
    'retains incompatible or unavailable writes without retry storms: %s',
    async (code) => {
      const { repository, outbox } = setup();
      let writes = 0;
      const service = new CloudSyncService(
        {
          call: (request) => {
            if (request.action === 'bootstrap') return Promise.resolve(snapshot());
            writes += 1;
            return Promise.reject(Object.assign(new Error(code), { code }));
          },
        },
        repository,
        outbox,
        { getScope: () => 'account' },
      );
      service.enqueue({ action: 'setFavorite', questionId: 'Q1', favorite: true });
      await expect(service.bootstrap()).resolves.toBe(true);
      expect(writes).toBe(1);
      expect(outbox.list()[0]?.state).toBe('pending');
      expect(service.getState().status).toBe('failed');
    },
  );

  it('preserves the queue and rejects a response belonging to another account', async () => {
    const { repository, outbox } = setup();
    const service = new CloudSyncService(
      {
        call: (request) =>
          Promise.resolve(
            request.action === 'bootstrap'
              ? snapshot()
              : snapshot(0, 99, `account-avatars/${'b'.repeat(64)}`),
          ),
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    service.enqueue({ action: 'setFavorite', questionId: 'Q1', favorite: true });
    await service.process();
    expect(outbox.list()[0]?.state).toBe('pending');
    expect(repository.loadAccountCache()?.avatarUploadPathPrefix).toBe(prefix);
    expect(repository.loadAccountCache()?.progressRevision).toBe(0);
    expect(service.getState().status).toBe('failed');
  });

  it('accepts a cloud learning clear even when its fresh revision is lower than the cached one', async () => {
    const { repository, outbox } = setup();
    const old = snapshot(0, 20);
    old.progress.summary.answered = 12;
    repository.saveAccountCache({ cacheVersion: 1, ...old });
    const service = new CloudSyncService(
      { call: () => Promise.resolve(snapshot()) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await service.retry();
    expect(repository.loadAccountCache()?.progress.summary.answered).toBe(0);
  });

  it('does not acknowledge an upload after the learning-clear barrier starts', async () => {
    const { repository, outbox } = setup();
    let clearing = false;
    let finish!: (value: AccountSyncSnapshot) => void;
    const service = new CloudSyncService(
      {
        call: (request) =>
          request.action === 'bootstrap'
            ? Promise.resolve(snapshot())
            : new Promise((resolve) => {
                finish = resolve;
              }),
      },
      repository,
      outbox,
      { getScope: () => 'account', isClearPending: () => clearing },
    );
    await service.bootstrap();
    service.enqueue({ action: 'updateProfile', nickname: 'pending', avatarUrl: '' });
    const saving = service.process();
    clearing = true;
    finish(snapshot(1));
    await saving;
    expect(outbox.list()[0]?.state).toBe('pending');
    expect(repository.loadAccountCache()?.profileRevision).toBe(0);
  });
});

describe('CloudSyncService practice-session snapshot preservation', () => {
  const saveLocalSession = (
    repository: ProgressRepository,
    session: ReturnType<typeof submittedSession> | ReturnType<typeof activeSession>,
    recordedSessionIds = [session.id],
    revision = 3,
  ) =>
    repository.saveAccountCache({
      cacheVersion: 1,
      ...withSession(snapshot(0, revision), session, recordedSessionIds),
    });

  it('keeps a submitted session after an upload response omits it, including its recorded marker only', async () => {
    const { repository, outbox } = setup();
    const local = submittedSession();
    saveLocalSession(repository, local, [local.id, 'unrelated-local-record']);
    const cloud = snapshot(0, 4);
    cloud.progress.summary.answered = 8;
    cloud.progress.favorites = { cloud: 1 };
    const calls: string[] = [];
    const service = new CloudSyncService(
      {
        call: (request) => {
          calls.push(request.action);
          return Promise.resolve({
            ...cloud,
            progressRevision: request.action === 'bootstrap' ? 4 : 5,
          });
        },
      },
      repository,
      outbox,
      { getScope: () => 'account' },
    );

    service.enqueue({ action: 'saveActiveSession', session: null });
    await service.process();

    expect(calls).toEqual(['bootstrap', 'saveActiveSession']);
    expect(repository.loadAccountCache()?.progress).toMatchObject({
      session: local,
      recordedSessionIds: [local.id],
      summary: { answered: 8 },
      favorites: { cloud: 1 },
    });
    expect(new ProgressService(repository, 'account').restoreSession()).toEqual(local);
  });

  it('continues preserving a submitted session on a later bootstrap', async () => {
    const { repository, outbox } = setup();
    const local = submittedSession();
    saveLocalSession(repository, local);
    const service = new CloudSyncService(
      { call: () => Promise.resolve(snapshot(0, 5)) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );

    await service.bootstrap();
    await service.bootstrap();

    expect(repository.loadAccountCache()?.progress.session).toEqual(local);
    expect(repository.loadAccountCache()?.progress.recordedSessionIds).toEqual([local.id]);
  });

  it('prefers an active cloud session and clears a local active session when cloud has none', async () => {
    const { repository, outbox } = setup();
    const local = activeSession('local-active');
    const remote = activeSession('cloud-active');
    saveLocalSession(repository, local, []);
    const service = new CloudSyncService(
      { call: () => Promise.resolve(withSession(snapshot(0, 4), remote)) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );

    await service.retry();
    expect(repository.loadAccountCache()?.progress.session).toEqual(remote);

    saveLocalSession(repository, local, []);
    const localFirst = new CloudSyncService(
      { call: () => Promise.resolve(snapshot(0, 5)) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );
    await localFirst.retry();
    expect(repository.loadAccountCache()?.progress.session).toBeNull();
  });

  it('does not revive a session after an explicit learning clear or a reset cloud snapshot', async () => {
    const { repository, outbox } = setup();
    const local = submittedSession();
    saveLocalSession(repository, local, [local.id], 20);
    const cleared = snapshot(0, 0);
    let cloud = cleared;
    const service = new CloudSyncService(
      { call: () => Promise.resolve(cloud) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );

    service.replaceAfterLearningClear(cleared);
    expect(repository.loadAccountCache()?.progress.session).toBeNull();

    saveLocalSession(repository, local, [local.id], 20);
    const cached = repository.loadAccountCache()!;
    cached.progress.summary.answered = 1;
    repository.saveAccountCache(cached);
    cloud = snapshot(0, 21);
    await service.retry();
    expect(repository.loadAccountCache()?.progress.session).toBeNull();
  });

  it('does not carry a submitted session into another verified account', async () => {
    const { repository, outbox } = setup();
    const local = submittedSession();
    saveLocalSession(repository, local);
    const other = snapshot(0, 4, `account-avatars/${'b'.repeat(64)}`);
    const service = new CloudSyncService(
      { call: () => Promise.resolve(other) },
      repository,
      outbox,
      { getScope: () => 'account' },
    );

    await service.retry();

    expect(repository.loadAccountCache()?.avatarUploadPathPrefix).toBe(
      other.avatarUploadPathPrefix,
    );
    expect(repository.loadAccountCache()?.progress.session).toBeNull();
  });
});

describe('preserved account sync contracts', () => {
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
});

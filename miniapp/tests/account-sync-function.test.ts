import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createAccountKey } = require('../cloudfunctions/accountSync/lib/account-key.js') as {
  createAccountKey: (appId: string, openId: string) => string;
};
const { createHandler } = require('../cloudfunctions/accountSync/lib/handler.js') as {
  createHandler: (dependencies: {
    store: ReturnType<typeof createStore>;
    hash: (appId: string, openId: string) => string;
  }) => (event: unknown, context?: unknown) => Promise<unknown>;
};

const createStore = (options: { failCreateProgress?: boolean } = {}) => {
  const accounts = new Map<string, Record<string, unknown>>();
  const progress = new Map<string, Record<string, unknown>>();
  let queue = Promise.resolve();
  const store = {
    accounts,
    progress,
    getAccount(id: string) {
      return Promise.resolve(accounts.get(id) ?? null);
    },
    getProgress(id: string) {
      return Promise.resolve(progress.get(id) ?? null);
    },
    createAccount(id: string, value: Record<string, unknown>) {
      accounts.set(id, value);
      return Promise.resolve();
    },
    createProgress(id: string, value: Record<string, unknown>) {
      if (options.failCreateProgress) return Promise.reject(new Error('database details'));
      progress.set(id, value);
      return Promise.resolve();
    },
    saveAccount(id: string, value: Record<string, unknown>) {
      accounts.set(id, value);
      return Promise.resolve();
    },
    saveProgress(id: string, value: Record<string, unknown>) {
      progress.set(id, value);
      return Promise.resolve();
    },
  };
  return {
    ...store,
    transaction<T>(work: (transactionStore: typeof store) => Promise<T>): Promise<T> {
      const result = queue.then(async () => {
        const accountBackup = new Map(accounts);
        const progressBackup = new Map(progress);
        try {
          return await work(store);
        } catch (error) {
          accounts.clear();
          progress.clear();
          for (const [id, value] of accountBackup) accounts.set(id, value);
          for (const [id, value] of progressBackup) progress.set(id, value);
          throw error;
        }
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
};

const context = { APPID: 'wx-test', OPENID: 'openid-test' };
const bootstrap = { action: 'bootstrap', schemaVersion: 1 };

describe('accountSync handler', () => {
  it('derives the stable SHA-256 account key from app ID and open ID', () => {
    expect(createAccountKey('wx-test', 'openid-test')).toBe(
      'e69e0e04e995205840d0516d710afb99484fac2acfb95f97b249d1fffb80c1ad',
    );
  });
  it('passes the trusted app and open IDs as separate hash inputs', async () => {
    const hash = vi.fn((appId: string, openId: string) => `${appId}:${openId}`);
    const handler = createHandler({ store: createStore(), hash });

    await expect(handler(bootstrap, context)).resolves.toMatchObject({ ok: true });
    expect(hash).toHaveBeenCalledWith('wx-test', 'openid-test');
  });
  it('uses trusted context to bootstrap an empty account without exposing internal IDs', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });

    const response = await handler(bootstrap, context);

    expect(response).toMatchObject({ ok: true, data: { profileRevision: 0, progressRevision: 0 } });
    expect(JSON.stringify(response)).not.toMatch(/openid|hashed|_id/i);
    expect(store.accounts.has('account_hashed')).toBe(true);
    expect(store.progress.has('progress_hashed')).toBe(true);
  });

  it('rolls back account creation when bootstrap cannot create the progress document', async () => {
    const store = createStore({ failCreateProgress: true });
    const handler = createHandler({ store, hash: () => 'hashed' });

    await expect(handler(bootstrap, context)).resolves.toEqual({
      ok: false,
      error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' },
    });
    expect(store.accounts.size).toBe(0);
    expect(store.progress.size).toBe(0);
  });

  it('maps nested snake-case database aggregates to the camel-case client snapshot', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    Object.assign(store.progress.get('progress_hashed')!, {
      question_totals: { Q1: { attempts: 2, correct_attempts: 1 } },
      daily_totals: { '2026-09-02': { answered: 2, correct: 1, duration_ms: 900 } },
    });

    await expect(handler(bootstrap, context)).resolves.toMatchObject({
      ok: true,
      data: {
        progress: {
          questionTotals: { Q1: { attempts: 2, correctAttempts: 1 } },
          dailyTotals: { '2026-09-02': { answered: 2, correct: 1, durationMs: 900 } },
        },
      },
    });
  });

  it('rejects caller-supplied identity, unknown fields and actions', async () => {
    const handler = createHandler({ store: createStore(), hash: () => 'hashed' });

    for (const event of [
      { ...bootstrap, openid: 'forged' },
      { ...bootstrap, unexpected: true },
      { action: 'anything', schemaVersion: 1 },
    ]) {
      await expect(handler(event, context)).resolves.toEqual({
        ok: false,
        error: { code: 'INVALID_REQUEST' },
      });
    }

    await expect(handler(bootstrap, { APPID: '', OPENID: 'openid-test' })).resolves.toEqual({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    await expect(handler({ ...bootstrap, schemaVersion: 2 }, context)).resolves.toEqual({
      ok: false,
      error: { code: 'SCHEMA_INCOMPATIBLE' },
    });
  });

  it('validates profile input and makes repeated final profile updates idempotent', async () => {
    const handler = createHandler({ store: createStore(), hash: () => 'hashed' });
    await handler(bootstrap, context);

    await expect(
      handler(
        {
          action: 'updateProfile',
          schemaVersion: 1,
          expectedRevision: 0,
          nickname: 'x'.repeat(13),
          avatarUrl: '',
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });

    const request = {
      action: 'updateProfile' as const,
      schemaVersion: 1 as const,
      expectedRevision: 0,
      nickname: '新昵称',
      avatarUrl: '',
    };
    const first = await handler(request, context);
    const repeated = await handler(request, context);
    expect(first).toMatchObject({ ok: true, data: { profileRevision: 1 } });
    expect(repeated).toMatchObject({ ok: true, data: { profileRevision: 1 } });
  });

  it('accepts only the four built-in avatar paths and complete active sessions', async () => {
    const handler = createHandler({ store: createStore(), hash: () => 'hashed' });
    await handler(bootstrap, context);

    await expect(
      handler(
        {
          action: 'updateProfile',
          schemaVersion: 1,
          expectedRevision: 0,
          nickname: '昵称',
          avatarUrl: '/assets/avatars/../outside.svg',
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await expect(
      handler(
        {
          action: 'saveActiveSession',
          schemaVersion: 1,
          expectedRevision: 0,
          session: { id: 's' },
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('rejects writes while an account is deleting or learning data is clearing without leaking errors', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    const account = store.accounts.get('account_hashed');
    account!.status = 'deleting';

    await expect(
      handler(
        {
          action: 'setFavorite',
          schemaVersion: 1,
          expectedRevision: 0,
          questionId: 'Q1',
          favorite: true,
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'ACCOUNT_DELETING' } });
  });

  it('serializes concurrent progress revisions so only one competing target can succeed', async () => {
    const handler = createHandler({ store: createStore(), hash: () => 'hashed' });
    await handler(bootstrap, context);

    const [first, second] = await Promise.all([
      handler(
        {
          action: 'setFavorite',
          schemaVersion: 1,
          expectedRevision: 0,
          questionId: 'Q1',
          favorite: true,
        },
        context,
      ),
      handler(
        {
          action: 'setFavorite',
          schemaVersion: 1,
          expectedRevision: 0,
          questionId: 'Q2',
          favorite: true,
        },
        context,
      ),
    ]);

    expect([first, second].filter((response) => (response as { ok: boolean }).ok)).toHaveLength(1);
    expect([first, second]).toContainEqual({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  });
});

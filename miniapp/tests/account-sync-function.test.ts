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
    deleteFiles?: (fileIDs: string[]) => Promise<{ fileID: string; status: number }[]>;
  }) => (event: unknown, context?: unknown) => Promise<unknown>;
};
const { isKnownAction } = require('../cloudfunctions/accountSync/lib/validation.js') as {
  isKnownAction: (action: unknown) => boolean;
};

const createStore = (
  options: { failCreateProgress?: boolean; failRemoveRecordsOnce?: boolean } = {},
) => {
  const accounts = new Map<string, Record<string, unknown>>();
  const progress = new Map<string, Record<string, unknown>>();
  const records = new Map<string, Record<string, unknown>>();
  let queue = Promise.resolve();
  let shouldFailRecordRemoval = options.failRemoveRecordsOnce === true;
  const store = {
    accounts,
    progress,
    records,
    getRecord(id: string) {
      return Promise.resolve(records.get(id) ?? null);
    },
    createRecord(id: string, value: Record<string, unknown>) {
      records.set(id, { ...value, submitted_at: 'SERVER_DATE' });
      return Promise.resolve();
    },
    listRecordIdsForAccount(accountKey: string) {
      return Promise.resolve(
        [...records.entries()]
          .filter(([, record]) => record.account_key === accountKey)
          .slice(0, 50)
          .map(([id]) => id),
      );
    },
    removeRecords(ids: string[]) {
      if (shouldFailRecordRemoval) {
        shouldFailRecordRemoval = false;
        return Promise.reject(new Error('database details'));
      }
      ids.forEach((id) => records.delete(id));
      return Promise.resolve();
    },
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
    removeProgress(id: string) {
      progress.delete(id);
      return Promise.resolve();
    },
    removeAccount(id: string) {
      accounts.delete(id);
      return Promise.resolve();
    },
  };
  return {
    ...store,
    transaction<T>(work: (transactionStore: typeof store) => Promise<T>): Promise<T> {
      const result = queue.then(async () => {
        const accountBackup = new Map(accounts);
        const progressBackup = new Map(progress);
        const recordBackup = new Map(records);
        try {
          return await work(store);
        } catch (error) {
          accounts.clear();
          progress.clear();
          records.clear();
          for (const [id, value] of accountBackup) accounts.set(id, value);
          for (const [id, value] of progressBackup) progress.set(id, value);
          for (const [id, value] of recordBackup) records.set(id, value);
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
const avatarKey = 'a'.repeat(64);

const fillQuestionTotalsPastResponseLimit = (store: ReturnType<typeof createStore>) => {
  const questionTotals: Record<string, { attempts: number; correct_attempts: number }> = {};
  for (let index = 0; index < 10_000; index += 1) {
    questionTotals[`Q${index}-${'x'.repeat(96)}`] = { attempts: 1, correct_attempts: 1 };
  }
  store.progress.get('progress_hashed')!.question_totals = questionTotals;
};

describe('accountSync handler', () => {
  it('uses the request action whitelist for safe logging', () => {
    expect(isKnownAction('bootstrap')).toBe(true);
    expect(isKnownAction('deleteAccount')).toBe(true);
    expect(isKnownAction('openid-sensitive-value')).toBe(false);
    expect(isKnownAction(null)).toBe(false);
  });

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
    expect(JSON.stringify(response)).not.toMatch(/openid|_id/i);
    expect(store.accounts.has('account_hashed')).toBe(true);
    expect(store.progress.has('progress_hashed')).toBe(true);
  });

  it('rolls back account creation when bootstrap cannot create the progress document', async () => {
    const store = createStore({ failCreateProgress: true });
    const handler = createHandler({ store, hash: () => avatarKey });

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

  it('rejects an oversized bootstrap snapshot without exposing progress content', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    fillQuestionTotalsPastResponseLimit(store);

    await expect(handler(bootstrap, context)).resolves.toEqual({
      ok: false,
      error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' },
    });
  });

  it('rolls back a mutation whose snapshot would exceed the response limit', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    fillQuestionTotalsPastResponseLimit(store);
    const before = structuredClone(store.progress.get('progress_hashed')!);

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
    ).resolves.toEqual({ ok: false, error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' } });

    expect(store.progress.get('progress_hashed')).toEqual(before);
  });

  it('rejects caller-supplied identity, unknown fields and actions', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });

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

    const hash = vi.fn(() => 'platform-metadata');
    const platformHandler = createHandler({ store: createStore(), hash });
    await expect(
      platformHandler(
        {
          ...bootstrap,
          tcbContext: { OPENID: 'forged-tcb-openid' },
          userInfo: { openId: 'forged-user-openid' },
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(hash).toHaveBeenCalledWith(context.APPID, context.OPENID);

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

  it('accepts built-in and controlled cloud avatar paths but rejects unsafe avatar URLs', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => avatarKey });
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
          action: 'updateProfile',
          schemaVersion: 1,
          expectedRevision: 0,
          nickname: '昵称',
          avatarUrl: `cloud://cloud1-d2gglad830c91db10.bucket/account-avatars/${avatarKey}/nonce0001.png`,
        },
        context,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(store.accounts.get(`account_${avatarKey}`)?.avatar_file_ids).toEqual([
      `cloud://cloud1-d2gglad830c91db10.bucket/account-avatars/${avatarKey}/nonce0001.png`,
    ]);
    for (const avatarUrl of [
      'https://example.com/avatar.png',
      'cloud://test-env/other/avatar.png',
      'cloud://test-env/account-avatars/../avatar.png',
      'cloud://cloud1-d2gglad830c91db10/account-avatars/other-account.png',
      'cloud://Test-env/account-avatars/avatar.png',
      'cloud://test-env..bucket/account-avatars/avatar.png',
      'cloud://test-env.bucket.extra/account-avatars/avatar.png',
      'cloud://test-env.bucket//account-avatars/avatar.png',
      'cloud://test-env/account-avatars/avatar.svg',
      `cloud://test-env/account-avatars/${'a'.repeat(97)}.jpg`,
    ]) {
      await expect(
        handler(
          {
            action: 'updateProfile',
            schemaVersion: 1,
            expectedRevision: 1,
            nickname: '昵称',
            avatarUrl,
          },
          context,
        ),
      ).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
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

  it('records a completed practice exactly once by its stable session ID', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    store.progress.get('progress_hashed')!.active_session = {
      id: 'session-1',
      mode: 'random',
      question_ids: ['Q1', 'Q2'],
      current_index: 1,
      answers: {},
      status: 'active',
      started_at: 1,
      updated_at: 2,
      answer_reveal_mode: 'immediate',
    };
    const request = {
      action: 'recordPractice',
      schemaVersion: 1,
      expectedRevision: 0,
      sessionId: 'session-1',
      mode: 'random',
      answers: [
        { questionId: 'Q1', correct: false, durationMs: 100, at: '2026-09-02' },
        { questionId: 'Q2', correct: true, durationMs: 200, at: '2026-09-03' },
      ],
    };
    expect(await handler(request, context)).toMatchObject({
      ok: true,
      data: { progressRevision: 1 },
    });
    expect(await handler(request, context)).toMatchObject({
      ok: true,
      data: { progressRevision: 1 },
    });
    expect(store.progress.get('progress_hashed')).toMatchObject({
      summary: { answered: 2, correct: 1, duration_ms: 300, first_answered_at: '2026-09-02' },
      question_totals: {
        Q1: { attempts: 1, correct_attempts: 0 },
        Q2: { attempts: 1, correct_attempts: 1 },
      },
      wrong_questions: {
        Q1: {
          question_id: 'Q1',
          error_count: 1,
          first_wrong_at: '2026-09-02',
          last_wrong_at: '2026-09-02',
          mastered: false,
          last_retry_correct: false,
        },
      },
      daily_totals: {
        '2026-09-02': { answered: 1, correct: 0, duration_ms: 100 },
        '2026-09-03': { answered: 1, correct: 1, duration_ms: 200 },
      },
      recent_question_ids: ['Q2', 'Q1'],
      active_session: null,
    });
    expect([...store.records.values()][0]).toMatchObject({
      schema_version: 1,
      account_key: 'hashed',
      session_id: 'session-1',
      answered: 2,
      correct: 1,
      duration_ms: 300,
      submitted_at: expect.any(String),
    });
  });

  it('isolates equal practice session IDs by account and accepts stale retries idempotently', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: (_appId: string, openId: string) => openId });
    const firstContext = { APPID: 'wx-test', OPENID: 'first' };
    const secondContext = { APPID: 'wx-test', OPENID: 'second' };
    const request = {
      action: 'recordPractice',
      schemaVersion: 1,
      expectedRevision: 0,
      sessionId: 'same',
      mode: 'random',
      answers: [{ questionId: 'Q1', correct: true, durationMs: 1, at: '2026-09-02' }],
    };
    await handler(bootstrap, firstContext);
    await handler(bootstrap, secondContext);
    await handler(request, firstContext);
    await handler(request, secondContext);
    await expect(handler(request, firstContext)).resolves.toMatchObject({
      ok: true,
      data: { progressRevision: 1 },
    });
    expect(store.records.size).toBe(2);
  });

  it('rejects malformed completed-practice data before creating any record', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    await expect(
      handler(
        {
          action: 'recordPractice',
          schemaVersion: 1,
          expectedRevision: 0,
          sessionId: 'session-invalid',
          mode: 'random',
          answers: [{ questionId: 'Q1', correct: true, durationMs: 1, at: '2026-02-30' }],
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(store.records.size).toBe(0);
  });

  it('rejects oversized session IDs and arbitrary completed-practice answer fields', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    const baseRequest = {
      action: 'recordPractice',
      schemaVersion: 1,
      expectedRevision: 0,
      mode: 'random',
      answers: [{ questionId: 'Q1', correct: true, durationMs: 1, at: '2026-09-02' }],
    };

    await expect(handler({ ...baseRequest, sessionId: 's'.repeat(129) }, context)).resolves.toEqual(
      { ok: false, error: { code: 'INVALID_REQUEST' } },
    );
    await expect(
      handler(
        {
          ...baseRequest,
          sessionId: 'session-extra-field',
          answers: [{ ...baseRequest.answers[0], accountKey: 'forged' }],
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(store.records.size).toBe(0);
  });

  it('clears learning records in resumable batches and leaves the account unavailable while clearing', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    for (let index = 0; index < 51; index += 1) {
      store.records.set(`record_${index}`, { account_key: 'hashed' });
    }
    await expect(
      handler({ action: 'clearLearningData', schemaVersion: 1 }, context),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' },
    });
    expect(store.accounts.get('account_hashed')!.learning_clear_state).toBe('clearing');
    expect(store.records.size).toBe(51);
    await expect(
      handler({ action: 'clearLearningData', schemaVersion: 1 }, context),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' },
    });
    expect(store.records.size).toBe(1);
    await expect(
      handler({ action: 'clearLearningData', schemaVersion: 1 }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { progressRevision: 0, progress: { recentQuestionIds: [] } },
    });
    expect(store.accounts.get('account_hashed')!.learning_clear_state).toBe('idle');
    expect(store.records.size).toBe(0);
  });

  it('clears learning fields while preserving existing progress metadata', async () => {
    const store = createStore();
    const handler = createHandler({ store, hash: () => 'hashed' });
    await handler(bootstrap, context);
    Object.assign(store.progress.get('progress_hashed')!, {
      created_at: 'CREATED_DATE',
      migration_metadata: { source: 'legacy-import', batch: 'batch_1' },
      revision: 7,
      summary: { answered: 4, correct: 3, duration_ms: 800, first_answered_at: '2026-09-01' },
      question_totals: { Q1: { attempts: 4, correct_attempts: 3 } },
      wrong_questions: { Q1: { error_count: 1 } },
      favorites: { Q1: 1 },
      daily_totals: { '2026-09-01': { answered: 4, correct: 3, duration_ms: 800 } },
      recent_question_ids: ['Q1'],
      active_session: { id: 'session_1' },
    });

    await expect(
      handler({ action: 'clearLearningData', schemaVersion: 1 }, context),
    ).resolves.toEqual({ ok: false, error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' } });
    await expect(
      handler({ action: 'clearLearningData', schemaVersion: 1 }, context),
    ).resolves.toMatchObject({ ok: true, data: { progressRevision: 0 } });

    expect(store.progress.get('progress_hashed')).toEqual({
      schema_version: 1,
      revision: 0,
      summary: { answered: 0, correct: 0, duration_ms: 0, first_answered_at: null },
      question_totals: {},
      wrong_questions: {},
      favorites: {},
      daily_totals: {},
      recent_question_ids: [],
      active_session: null,
      created_at: 'CREATED_DATE',
      migration_metadata: { source: 'legacy-import', batch: 'batch_1' },
    });
  });

  it('deletes accounts in a retryable records-progress-account sequence', async () => {
    const store = createStore();
    const deleteFiles = vi.fn((fileIDs: string[]) =>
      Promise.resolve(fileIDs.map((fileID) => ({ fileID, status: 0 }))),
    );
    const handler = createHandler({ store, hash: () => avatarKey, deleteFiles });
    await handler(bootstrap, context);
    store.accounts.get(`account_${avatarKey}`)!.avatar_file_ids = [
      `cloud://cloud1-d2gglad830c91db10/account-avatars/${avatarKey}/nonce0001.jpg`,
      'cloud://cloud1-d2gglad830c91db10/account-avatars/other.jpg',
    ];
    store.records.set('record_1', { account_key: avatarKey });
    await expect(handler({ action: 'deleteAccount', schemaVersion: 1 }, context)).resolves.toEqual({
      ok: true,
      data: { schemaVersion: 1, done: false, stage: 'records' },
    });
    expect(store.accounts.get(`account_${avatarKey}`)!.status).toBe('deleting');
    await expect(handler({ action: 'deleteAccount', schemaVersion: 1 }, context)).resolves.toEqual({
      ok: true,
      data: { schemaVersion: 1, done: false, stage: 'records' },
    });
    await expect(handler({ action: 'deleteAccount', schemaVersion: 1 }, context)).resolves.toEqual({
      ok: true,
      data: { schemaVersion: 1, done: true, stage: 'done' },
    });
    expect(store.accounts.size).toBe(0);
    expect(store.progress.size).toBe(0);
    expect(deleteFiles).toHaveBeenCalledWith([
      `cloud://cloud1-d2gglad830c91db10/account-avatars/${avatarKey}/nonce0001.jpg`,
    ]);
    await expect(handler({ action: 'deleteAccount', schemaVersion: 1 }, context)).resolves.toEqual({
      ok: true,
      data: { schemaVersion: 1, done: true, stage: 'done' },
    });
  });

  it('keeps a deleting account when avatar cleanup fails so deletion can retry', async () => {
    const store = createStore();
    const deleteFiles = vi
      .fn()
      .mockResolvedValueOnce([
        {
          fileID: `cloud://cloud1-d2gglad830c91db10/account-avatars/${avatarKey}/nonce0001.webp`,
          status: 500,
        },
      ])
      .mockResolvedValueOnce([
        {
          fileID: `cloud://cloud1-d2gglad830c91db10/account-avatars/${avatarKey}/nonce0001.webp`,
          status: -503003,
        },
      ]);
    const handler = createHandler({ store, hash: () => avatarKey, deleteFiles });
    await handler(bootstrap, context);
    store.accounts.get(`account_${avatarKey}`)!.avatar_file_ids = [
      `cloud://cloud1-d2gglad830c91db10/account-avatars/${avatarKey}/nonce0001.webp`,
    ];
    await handler({ action: 'deleteAccount', schemaVersion: 1 }, context);

    await expect(handler({ action: 'deleteAccount', schemaVersion: 1 }, context)).resolves.toEqual({
      ok: false,
      error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' },
    });
    expect(store.accounts.get(`account_${avatarKey}`)?.status).toBe('deleting');
    await expect(handler({ action: 'deleteAccount', schemaVersion: 1 }, context)).resolves.toEqual({
      ok: true,
      data: { schemaVersion: 1, done: true, stage: 'done' },
    });
  });

  it('keeps a deleting account when cloud storage omits avatar deletion results', async () => {
    const store = createStore();
    const deleteFiles = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          fileID: `cloud://cloud1-d2gglad830c91db10/account-avatars/${avatarKey}/nonce0001.jpg`,
          status: 0,
        },
      ]);
    const handler = createHandler({ store, hash: () => avatarKey, deleteFiles });
    await handler(bootstrap, context);
    store.accounts.get(`account_${avatarKey}`)!.avatar_file_ids = [
      `cloud://cloud1-d2gglad830c91db10/account-avatars/${avatarKey}/nonce0001.jpg`,
    ];
    await handler({ action: 'deleteAccount', schemaVersion: 1 }, context);

    await expect(handler({ action: 'deleteAccount', schemaVersion: 1 }, context)).resolves.toEqual({
      ok: false,
      error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' },
    });
    expect(store.accounts.get(`account_${avatarKey}`)?.status).toBe('deleting');
    await expect(
      handler({ action: 'deleteAccount', schemaVersion: 1 }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { done: true },
    });
  });

  it('retains more than four avatar objects and deletes them in safe batches', async () => {
    const store = createStore();
    const deleteFiles = vi.fn((ids: string[]) =>
      Promise.resolve(ids.map((fileID) => ({ fileID, status: 0 }))),
    );
    const handler = createHandler({ store, hash: () => avatarKey, deleteFiles });
    await handler(bootstrap, context);
    const files = Array.from(
      { length: 51 },
      (_, index) =>
        `cloud://cloud1-d2gglad830c91db10/account-avatars/${avatarKey}/nonce${index.toString().padStart(4, '0')}.jpg`,
    );
    store.accounts.get(`account_${avatarKey}`)!.avatar_file_ids = files;
    await handler({ action: 'deleteAccount', schemaVersion: 1 }, context);
    await expect(
      handler({ action: 'deleteAccount', schemaVersion: 1 }, context),
    ).resolves.toMatchObject({
      data: { done: false, stage: 'account' },
    });
    expect(deleteFiles).toHaveBeenCalledWith(files.slice(0, 50));
    expect(store.accounts.get(`account_${avatarKey}`)?.avatar_file_ids).toEqual(files.slice(50));
    await expect(
      handler({ action: 'deleteAccount', schemaVersion: 1 }, context),
    ).resolves.toMatchObject({
      data: { done: true },
    });
  });

  it('keeps clearing and deleting markers after a batch failure so retries can continue safely', async () => {
    const clearStore = createStore({ failRemoveRecordsOnce: true });
    const clearHandler = createHandler({ store: clearStore, hash: () => 'hashed' });
    await clearHandler(bootstrap, context);
    clearStore.records.set('record_clear', { account_key: 'hashed' });
    await clearHandler({ action: 'clearLearningData', schemaVersion: 1 }, context);
    await expect(
      clearHandler({ action: 'clearLearningData', schemaVersion: 1 }, context),
    ).resolves.toEqual({ ok: false, error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' } });
    expect(clearStore.accounts.get('account_hashed')!.learning_clear_state).toBe('clearing');
    await expect(
      clearHandler({ action: 'clearLearningData', schemaVersion: 1 }, context),
    ).resolves.toMatchObject({ ok: true });

    const deleteStore = createStore({ failRemoveRecordsOnce: true });
    const deleteHandler = createHandler({ store: deleteStore, hash: () => 'hashed' });
    await deleteHandler(bootstrap, context);
    deleteStore.records.set('record_delete', { account_key: 'hashed' });
    await deleteHandler({ action: 'deleteAccount', schemaVersion: 1 }, context);
    await expect(
      deleteHandler({ action: 'deleteAccount', schemaVersion: 1 }, context),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' },
    });
    expect(deleteStore.accounts.get('account_hashed')!.status).toBe('deleting');
    await deleteHandler({ action: 'deleteAccount', schemaVersion: 1 }, context);
    await expect(
      deleteHandler({ action: 'deleteAccount', schemaVersion: 1 }, context),
    ).resolves.toEqual({
      ok: true,
      data: { schemaVersion: 1, done: true, stage: 'done' },
    });
  });
});

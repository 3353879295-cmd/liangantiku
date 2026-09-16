import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { CloudStore } = require('../cloudfunctions/accountSync/lib/cloud-store.js') as {
  CloudStore: new (
    database: unknown,
    serverDate?: () => unknown,
    diagnosticLogger?: unknown,
  ) => {
    createAccount(id: string, value: Record<string, unknown>): Promise<void>;
    createRecord(id: string, value: Record<string, unknown>): Promise<void>;
    getAccount(id: string): Promise<Record<string, unknown> | null>;
    getProgress(id: string): Promise<Record<string, unknown> | null>;
    getRecord(id: string): Promise<Record<string, unknown> | null>;
    listRecordIdsForAccount(accountKey: string): Promise<string[]>;
    removeRecords(ids: string[]): Promise<void>;
    removeProgress(id: string): Promise<void>;
    removeAccount(id: string): Promise<void>;
    saveAccount(id: string, value: Record<string, unknown>): Promise<void>;
    saveProgress(id: string, value: Record<string, unknown>): Promise<void>;
    transaction<T>(work: (store: unknown) => Promise<T>): Promise<T>;
  };
};

type DiagnosticEntry = { event: string; [key: string]: unknown };

const diagnosticLogger = (entries: DiagnosticEntry[]) => ({
  info: (_prefix: string, entry: DiagnosticEntry) => entries.push(entry),
});

describe('accountSync CloudStore', () => {
  it('uses the user collection, deterministic document ID and server time for creates', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const doc = vi.fn().mockReturnValue({ set });
    const collection = vi.fn().mockReturnValue({ doc });
    const serverDate = vi.fn().mockReturnValue('SERVER_DATE');
    const store = new CloudStore({ collection, serverDate });

    await store.createAccount('account_hash', { status: 'active' });

    expect(collection).toHaveBeenCalledWith('user_accounts');
    expect(doc).toHaveBeenCalledWith('account_hash');
    expect(set).toHaveBeenCalledWith({
      data: { status: 'active', created_at: 'SERVER_DATE', updated_at: 'SERVER_DATE' },
    });
  });

  it('executes work through the database transaction adapter', async () => {
    const runTransaction = vi.fn<
      (work: (transaction: unknown) => Promise<unknown>) => Promise<unknown>
    >(async (work) => ({
      result: await work({ collection: vi.fn() }),
      errMsg: 'runTransaction:ok',
    }));
    const store = new CloudStore({ runTransaction, serverDate: vi.fn() });
    const work = vi.fn().mockResolvedValue('done');

    await expect(store.transaction(work)).resolves.toBe('done');
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('returns null for each absent document without adding unsupported document.get options', async () => {
    const get = vi.fn().mockResolvedValue({ data: null });
    const doc = vi.fn().mockReturnValue({ get });
    const collection = vi.fn().mockReturnValue({ doc });
    const store = new CloudStore({ collection, serverDate: vi.fn() });

    await expect(store.getAccount('account_hash')).resolves.toBeNull();
    await expect(store.getProgress('account_hash')).resolves.toBeNull();
    await expect(store.getRecord('first_record_hash')).resolves.toBeNull();

    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenNthCalledWith(1);
    expect(get).toHaveBeenNthCalledWith(2);
    expect(get).toHaveBeenNthCalledWith(3);
    expect(collection).toHaveBeenNthCalledWith(1, 'user_accounts');
    expect(collection).toHaveBeenNthCalledWith(2, 'user_progress');
    expect(collection).toHaveBeenNthCalledWith(3, 'user_practice_records');
  });

  it('does not write the CloudBase document _id back when saving fetched documents', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { _id: 'account_hash', status: 'active' } })
      .mockResolvedValueOnce({
        data: {
          _id: 'progress_hash',
          revision: 3,
          created_at: 'CREATED_DATE',
          active_session: null,
          favorites: {},
          wrong_questions: {},
        },
      })
      .mockResolvedValueOnce({ data: { _id: 'record_hash', session_id: 'session_1' } });
    const update = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockResolvedValue(undefined);
    const doc = vi.fn().mockReturnValue({ get, update, set });
    const collection = vi.fn().mockReturnValue({ doc });
    const store = new CloudStore({
      collection,
      serverDate: vi.fn().mockReturnValue('SERVER_DATE'),
    });

    const account = await store.getAccount('account_hash');
    const progress = await store.getProgress('progress_hash');
    const record = await store.getRecord('record_hash');
    await store.saveAccount('account_hash', account!);
    await store.saveProgress('progress_hash', progress!);

    expect(account).toEqual({ status: 'active' });
    expect(progress).toEqual({
      revision: 3,
      created_at: 'CREATED_DATE',
      active_session: null,
      favorites: {},
      wrong_questions: {},
    });
    expect(record).toEqual({ session_id: 'session_1' });
    expect(update).toHaveBeenNthCalledWith(1, {
      data: { status: 'active', updated_at: 'SERVER_DATE' },
    });
    expect(set).toHaveBeenCalledWith({
      data: {
        revision: 3,
        created_at: 'CREATED_DATE',
        active_session: null,
        favorites: {},
        wrong_questions: {},
        updated_at: 'SERVER_DATE',
      },
    });
  });

  it('uses the installed CloudBase serializer to replace complete progress snapshots', async () => {
    type RequestParameters = { data: string; merge: boolean; upsert: boolean };
    type DatabaseDocument = { set(data: Record<string, unknown>): Promise<unknown> };
    type Database = { collection(name: string): { doc(id: string): DatabaseDocument } };
    type DatabaseConstructor = {
      new (config: Record<string, never>): Database;
      reqClass: unknown;
    };
    const cloudFunctionRequire = createRequire(
      new URL('../cloudfunctions/accountSync/package.json', import.meta.url),
    );
    const { Db } = cloudFunctionRequire('@cloudbase/database/dist/commonjs') as {
      Db: DatabaseConstructor;
    };
    const calls: { api: string; params: RequestParameters }[] = [];
    const previousRequestClass = Db.reqClass;
    class MockRequest {
      send(api: string, params: RequestParameters) {
        calls.push({ api, params });
        return Promise.resolve({ data: { updated: 1 }, requestId: 'probe-request-id' });
      }
    }
    Db.reqClass = MockRequest;

    try {
      const document = new Db({}).collection('user_progress').doc('progress_hash');
      const snapshots = [
        {
          created_at: 'CREATED_DATE',
          active_session: null,
          favorites: { question_1: 1 },
          wrong_questions: { question_1: { error_count: 1 } },
        },
        {
          created_at: 'CREATED_DATE',
          active_session: { id: 'session_1', answers: {} },
          favorites: {},
          wrong_questions: {},
        },
        {
          created_at: 'CREATED_DATE',
          active_session: null,
          favorites: {},
          wrong_questions: {},
        },
      ];

      for (const snapshot of snapshots) await document.set(snapshot);

      expect(calls.map(({ api }) => api)).toEqual([
        'database.modifyDocument',
        'database.modifyDocument',
        'database.modifyDocument',
      ]);
      const serializedSnapshots = calls.map(
        ({ params }) => JSON.parse(params.data) as Record<string, unknown>,
      );
      expect(serializedSnapshots[0]).toMatchObject({
        created_at: 'CREATED_DATE',
        active_session: null,
        favorites: { question_1: { $numberInt: '1' } },
        wrong_questions: { question_1: { error_count: { $numberInt: '1' } } },
      });
      expect(serializedSnapshots[1]).toEqual(snapshots[1]);
      expect(serializedSnapshots[2]).toEqual(snapshots[2]);
      expect(calls.every(({ params }) => !params.merge && params.upsert)).toBe(true);
    } finally {
      Db.reqClass = previousRequestClass;
    }
  });

  it('propagates database read failures instead of treating them as missing documents', async () => {
    const failure = new Error('database unavailable');
    const get = vi.fn().mockRejectedValue(failure);
    const doc = vi.fn().mockReturnValue({ get });
    const collection = vi.fn().mockReturnValue({ doc });
    const store = new CloudStore({ collection, serverDate: vi.fn() });

    await expect(store.getAccount('account_hash')).rejects.toBe(failure);
  });

  it('stores records with server submitted time and removes only a bounded account-key batch', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({ data: [{ _id: 'record_1' }, { _id: 'record_2' }] });
    const remove = vi.fn().mockResolvedValue(undefined);
    const limit = vi.fn().mockReturnValue({ get });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const doc = vi
      .fn()
      .mockReturnValue({ set, get: vi.fn().mockResolvedValue({ data: null }), remove });
    const collection = vi.fn().mockReturnValue({ doc, where });
    const store = new CloudStore({
      collection,
      serverDate: vi.fn().mockReturnValue('SERVER_DATE'),
    });

    await store.createRecord('record_hash', { account_key: 'key', session_id: 'session' });
    await expect(store.getRecord('record_hash')).resolves.toBeNull();
    await expect(store.listRecordIdsForAccount('key')).resolves.toEqual(['record_1', 'record_2']);
    await store.removeRecords(['record_1', 'record_2']);
    await store.removeProgress('progress_key');
    await store.removeAccount('account_key');

    expect(set).toHaveBeenCalledWith({
      data: { account_key: 'key', session_id: 'session', submitted_at: 'SERVER_DATE' },
    });
    expect(where).toHaveBeenCalledWith({ account_key: 'key' });
    expect(orderBy).toHaveBeenCalledWith('submitted_at', 'asc');
    expect(limit).toHaveBeenCalledWith(50);
    expect(remove).toHaveBeenCalledTimes(4);
  });

  it('records a safe progress-update failure while preserving the original rejection and payload', async () => {
    const failure = Object.assign(new Error('private database detail'), {
      code: 'unsafe detail',
      errCode: 1001,
    });
    const set = vi.fn().mockRejectedValue(failure);
    const entries: DiagnosticEntry[] = [];
    const logger = diagnosticLogger(entries);
    const collection = vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue({ set }) });
    const store = new CloudStore(
      { collection, serverDate: vi.fn().mockReturnValue('SERVER_DATE') },
      undefined,
      logger,
    );

    await expect(store.saveProgress('progress_hash', { revision: 3 })).rejects.toBe(failure);
    expect(set).toHaveBeenCalledWith({ data: { revision: 3, updated_at: 'SERVER_DATE' } });

    expect(entries).toContainEqual(
      expect.objectContaining({ event: 'progress_update.failed', name: 'Error', errCode: 1001 }),
    );
    expect(JSON.stringify(entries)).not.toContain('private database detail');
    expect(JSON.stringify(entries)).not.toContain('unsafe detail');
    expect(JSON.stringify(entries)).not.toContain('progress_hash');
  });

  it('separates a callback failure after a successful update from an update failure', async () => {
    const set = vi.fn().mockResolvedValue({
      updated: 1,
      requestId: '5c45d1da-4252-4a2c-9212-5cf21a2c3c0b',
    });
    const entries: DiagnosticEntry[] = [];
    const logger = diagnosticLogger(entries);
    const database = {
      runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
        const result: unknown = await callback({
          collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue({ set }) }),
        });
        return result;
      },
    };
    const store = new CloudStore(database, vi.fn().mockReturnValue('SERVER_DATE'), logger);
    const failure = new TypeError('snapshot must not be logged');

    await expect(
      store.transaction(async (transactionStore) => {
        await (
          transactionStore as {
            saveProgress(id: string, value: Record<string, unknown>): Promise<void>;
          }
        ).saveProgress('progress_hash', { revision: 3 });
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'progress_update.completed',
        attempt: 1,
        updated: 1,
        sdkRequestId: '5c45d1da-4252-4a2c-9212-5cf21a2c3c0b',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'transaction.callback_failed',
        attempt: 1,
        name: 'TypeError',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'transaction.failed',
        phase: 'callback',
        name: 'TypeError',
      }),
    );
    expect(JSON.stringify(entries)).not.toContain('snapshot must not be logged');
  });

  it('identifies a failure after a completed transaction callback as a commit failure', async () => {
    const failure = Object.assign(new Error('commit message is private'), {
      code: 'TRANSACTION_ABORTED',
    });
    const entries: DiagnosticEntry[] = [];
    const logger = diagnosticLogger(entries);
    const store = new CloudStore(
      {
        runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
          await callback({ collection: vi.fn() });
          throw failure;
        },
      },
      vi.fn(),
      logger,
    );

    await expect(store.transaction(() => Promise.resolve('done'))).rejects.toBe(failure);
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: 'transaction.failed',
        attempts: 1,
        phase: 'commit',
        code: 'TRANSACTION_ABORTED',
      }),
    );
    expect(JSON.stringify(entries)).not.toContain('commit message is private');
  });

  it('tracks transaction retries and concurrent transactions with isolated attempt state', async () => {
    const entries: DiagnosticEntry[] = [];
    const logger = diagnosticLogger(entries);
    const database = {
      runTransaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
        const result: unknown = await callback({ collection: vi.fn() });
        const retriedResult: unknown = await callback({ collection: vi.fn() });
        return { result, retriedResult };
      },
    };
    const store = new CloudStore(database, vi.fn(), logger);

    await Promise.all([
      store.transaction(() => Promise.resolve('one')),
      store.transaction(() => Promise.resolve('two')),
    ]);
    expect(entries.filter((entry) => entry.event === 'transaction.attempt_started')).toHaveLength(
      4,
    );
    expect(
      entries.filter(
        (entry) => entry.event === 'transaction.attempt_started' && entry.attempt === 1,
      ),
    ).toHaveLength(2);
    expect(
      entries.filter(
        (entry) => entry.event === 'transaction.attempt_started' && entry.attempt === 2,
      ),
    ).toHaveLength(2);
    expect(entries.filter((entry) => entry.event === 'transaction.committed')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attempts: 2 }),
        expect.objectContaining({ attempts: 2 }),
      ]),
    );
  });

  it('does not let diagnostic logger failures change the database result', async () => {
    const set = vi
      .fn()
      .mockResolvedValue({ updated: 0, requestId: 'not-a-uuid', secret: 'hidden' });
    const logger = {
      info: () => {
        throw new Error('logger unavailable');
      },
    };
    const collection = vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue({ set }) });
    const store = new CloudStore(
      { collection, serverDate: vi.fn().mockReturnValue('SERVER_DATE') },
      undefined,
      logger,
    );

    await expect(store.saveProgress('progress_hash', { revision: 3 })).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith({ data: { revision: 3, updated_at: 'SERVER_DATE' } });
  });
});

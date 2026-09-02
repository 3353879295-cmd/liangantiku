import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { CloudStore } = require('../cloudfunctions/accountSync/lib/cloud-store.js') as {
  CloudStore: new (database: unknown) => {
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

  it('uses the wx-server-sdk missing-document option and returns null for each absent document', async () => {
    const get = vi.fn().mockResolvedValue({ data: null });
    const doc = vi.fn().mockReturnValue({ get });
    const collection = vi.fn().mockReturnValue({ doc });
    const store = new CloudStore({ collection, serverDate: vi.fn() });

    await expect(store.getAccount('account_hash')).resolves.toBeNull();
    await expect(store.getProgress('account_hash')).resolves.toBeNull();
    await expect(store.getRecord('first_record_hash')).resolves.toBeNull();

    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenNthCalledWith(1, { throwOnNotFound: false });
    expect(get).toHaveBeenNthCalledWith(2, { throwOnNotFound: false });
    expect(get).toHaveBeenNthCalledWith(3, { throwOnNotFound: false });
    expect(collection).toHaveBeenNthCalledWith(1, 'user_accounts');
    expect(collection).toHaveBeenNthCalledWith(2, 'user_progress');
    expect(collection).toHaveBeenNthCalledWith(3, 'user_practice_records');
  });

  it('does not write the CloudBase document _id back when saving fetched documents', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: { _id: 'account_hash', status: 'active' } })
      .mockResolvedValueOnce({ data: { _id: 'progress_hash', revision: 3 } })
      .mockResolvedValueOnce({ data: { _id: 'record_hash', session_id: 'session_1' } });
    const update = vi.fn().mockResolvedValue(undefined);
    const doc = vi.fn().mockReturnValue({ get, update });
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
    expect(progress).toEqual({ revision: 3 });
    expect(record).toEqual({ session_id: 'session_1' });
    expect(update).toHaveBeenNthCalledWith(1, {
      data: { status: 'active', updated_at: 'SERVER_DATE' },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      data: { revision: 3, updated_at: 'SERVER_DATE' },
    });
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
});

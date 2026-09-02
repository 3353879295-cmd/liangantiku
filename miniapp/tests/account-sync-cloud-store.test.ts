import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { CloudStore } = require('../cloudfunctions/accountSync/lib/cloud-store.js') as {
  CloudStore: new (database: unknown) => {
    createAccount(id: string, value: Record<string, unknown>): Promise<void>;
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
});

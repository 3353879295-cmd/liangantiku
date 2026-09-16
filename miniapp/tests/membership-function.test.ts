/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createHandler, addMonthsShanghai, hashKey, settleOrder } =
  require('../cloudfunctions/membership/lib/handler.js') as any;

const createStore = () => {
  const entitlements = new Map();
  const usages = new Map();
  const grants = new Map();
  const orders = new Map();
  const transactionLocks = new Map();
  let chain = Promise.resolve();
  const store: any = {
    entitlements,
    usages,
    grants,
    orders,
    transactionLocks,
    getEntitlement: async (id: string) => entitlements.get(id) ?? null,
    saveEntitlement: async (id: string, v: unknown) => void entitlements.set(id, v),
    getUsage: async (id: string) => usages.get(id) ?? null,
    saveUsage: async (id: string, v: unknown) => void usages.set(id, v),
    getGrant: async (account: string, session: string) =>
      grants.get(`${account}:${session}`) ?? null,
    createGrant: async (id: string, v: unknown) => void grants.set(id, v),
    getOrder: async (id: string) => orders.get(id) ?? null,
    createOrder: async (id: string, v: unknown) => void orders.set(id, v),
    saveOrder: async (id: string, v: unknown) => void orders.set(id, v),
    getOrderByRequest: async () => null,
    getOrderByTransaction: async (transaction: string) => {
      const lock = transactionLocks.get(transaction);
      return lock ? orders.get(lock.order_id) : null;
    },
    saveTransactionLock: async (transaction: string, orderId: string) =>
      void transactionLocks.set(transaction, { order_id: orderId }),
    listDuePendingOrders: async () => [],
  };
  store.transaction = (work: any) => {
    const result = chain.then(() => work(store));
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return store;
};
const context = { APPID: 'wx-test', OPENID: 'open-id' };
describe('membership random-practice authority', () => {
  it('serializes three free starts, makes retries idempotent, and resets on the Shanghai day', async () => {
    const store = createStore();
    let clock = new Date('2026-09-05T15:00:00.000Z');
    const handler = createHandler({ store, hash: () => 'a', now: () => clock });
    const starts = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        handler(
          {
            action: 'startRandomPractice',
            requestId: `s${i}`,
            sessionId: `s${i}`,
            questionIds: [`Q${i}`],
          },
          context,
        ),
      ),
    );
    expect(starts.filter((result: any) => result.ok)).toHaveLength(3);
    expect(starts).toContainEqual({ ok: false, error: { code: 'DAILY_LIMIT_REACHED' } });
    expect(
      await handler(
        { action: 'startRandomPractice', requestId: 's2', sessionId: 's2', questionIds: ['Q2'] },
        context,
      ),
    ).toMatchObject({ ok: true, data: { membership: { freeUsed: 3 } } });
    clock = new Date('2026-09-05T16:00:00.000Z');
    expect(await handler({ action: 'getStatus' }, context)).toMatchObject({
      ok: true,
      data: { freeUsed: 0, freeRemaining: 3, freeDate: '2026-09-06' },
    });
  });
  it('clamps natural-month renewals at month end', () => {
    expect(addMonthsShanghai('2026-08-31T04:00:00.000Z')).toContain('2027-02-28');
  });
  it('does not accept a front-end supplied identity', async () => {
    const handler = createHandler({
      store: createStore(),
      now: () => new Date('2026-09-05T00:00:00Z'),
    });
    await expect(
      handler({ action: 'getStatus', openid: 'forged' }, context),
    ).resolves.toMatchObject({ ok: true });
    await expect(handler({ action: 'getStatus' }, {})).resolves.toEqual({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it('isolates free quotas and rejects a changed payload for an existing session', async () => {
    const handler = createHandler({
      store: createStore(),
      now: () => new Date('2026-09-05T00:00:00Z'),
    });
    const first = { APPID: 'wx', OPENID: 'first' };
    const second = { APPID: 'wx', OPENID: 'second' };
    expect(
      await handler(
        { action: 'startRandomPractice', requestId: 's', sessionId: 's', questionIds: ['Q1'] },
        first,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await handler(
        { action: 'startRandomPractice', requestId: 's', sessionId: 's', questionIds: ['Q2'] },
        first,
      ),
    ).toEqual({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(
      await handler(
        { action: 'startRandomPractice', requestId: 's', sessionId: 's', questionIds: ['Q2'] },
        second,
      ),
    ).toMatchObject({ ok: true, data: { membership: { freeUsed: 1 } } });
  });
  it('requires requestId to be the sessionId so a retry cannot consume a second quota', async () => {
    const handler = createHandler({
      store: createStore(),
      now: () => new Date('2026-09-05T00:00:00Z'),
    });
    await expect(
      handler(
        {
          action: 'startRandomPractice',
          requestId: 'request',
          sessionId: 'session',
          questionIds: ['Q1'],
        },
        context,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });
  it('extends two concurrently settled orders once each', async () => {
    const store = createStore();
    const paidAt = '2026-08-31T04:00:00.000Z';
    const paidContext = { APPID: 'wx', OPENID: 'open' };
    const account = hashKey('wx', 'open');
    for (const orderId of ['order1', 'order2']) {
      store.orders.set(orderId, {
        order_id: orderId,
        account_key: account,
        app_id: 'wx',
        open_id: 'open',
        amount: 2800,
        status: 'PENDING',
      });
    }
    const payment = { verifyProof: () => true };
    const proof = (order: string, transaction: string) => ({
      out_trade_no: order,
      transaction_id: transaction,
      trade_state: 'SUCCESS',
      appid: 'wx',
      payer: { openid: 'open' },
      amount: { total: 2800, currency: 'CNY' },
      success_time: paidAt,
    });
    await Promise.all([
      settleOrder(store, payment, proof('order1', 'tx1'), paidContext, new Date(paidAt)),
      settleOrder(store, payment, proof('order2', 'tx2'), paidContext, new Date(paidAt)),
    ]);
    const expiresAt = store.entitlements.get(account).expires_at as string;
    // Each renewal is six natural months from the then-current expiry; Feb 28 + six months is Aug 28.
    expect(expiresAt).toContain('2027-08-28');
    await settleOrder(store, payment, proof('order2', 'tx2'), paidContext, new Date(paidAt));
    expect(store.entitlements.get(account).expires_at).toBe(expiresAt);
    expect(store.entitlements.get(account).renewal_payments).toHaveLength(2);
  });
  it('renews an expired membership from settlement time when a delayed success notification arrives', async () => {
    const store = createStore();
    const account = hashKey('wx', 'open');
    store.orders.set('late', {
      order_id: 'late',
      account_key: account,
      app_id: 'wx',
      open_id: 'open',
      amount: 2800,
      status: 'PENDING',
    });
    store.entitlements.set(account, {
      account_key: account,
      starts_at: '2025-01-01T00:00:00.000Z',
      expires_at: '2026-01-01T00:00:00.000Z',
    });
    await settleOrder(
      store,
      { verifyProof: () => true },
      {
        out_trade_no: 'late',
        transaction_id: 'tx-late',
        trade_state: 'SUCCESS',
        appid: 'wx',
        payer: { openid: 'open' },
        amount: { total: 2800, currency: 'CNY' },
        success_time: '2025-12-01T00:00:00.000Z',
      },
      { APPID: 'wx', OPENID: 'open' },
      new Date('2026-02-10T00:00:00.000Z'),
    );
    expect(store.entitlements.get(account)).toMatchObject({
      starts_at: '2026-02-10T00:00:00.000Z',
      expires_at: '2026-08-10T00:00:00.000Z',
      renewal_payments: [
        { paid_at: '2025-12-01T00:00:00.000Z', effective_at: '2026-02-10T00:00:00.000Z' },
      ],
    });
  });
  it('does not mutate unrelated usage or practice grants while settling membership', async () => {
    const store = createStore();
    const account = hashKey('wx', 'open');
    store.usages.set(account, { account_key: account, free_date: '2026-09-05', free_used: 3 });
    store.grants.set(`${account}:session`, {
      account_key: account,
      session_id: 'session',
      question_ids: ['Q1'],
    });
    store.orders.set('isolated', {
      order_id: 'isolated',
      account_key: account,
      app_id: 'wx',
      open_id: 'open',
      amount: 2800,
      status: 'PENDING',
    });
    await settleOrder(
      store,
      { verifyProof: () => true },
      {
        out_trade_no: 'isolated',
        transaction_id: 'tx-isolated',
        trade_state: 'SUCCESS',
        appid: 'wx',
        payer: { openid: 'open' },
        amount: { total: 2800, currency: 'CNY' },
        success_time: '2026-09-05T04:00:00.000Z',
      },
      { APPID: 'wx', OPENID: 'open' },
      new Date('2026-09-05T04:00:00.000Z'),
    );
    expect(store.usages.get(account)).toEqual({
      account_key: account,
      free_date: '2026-09-05',
      free_used: 3,
    });
    expect(store.grants.get(`${account}:session`)).toEqual({
      account_key: account,
      session_id: 'session',
      question_ids: ['Q1'],
    });
  });
  it('replays verified payments by payment time when callbacks arrive out of order', async () => {
    const payment = { verifyProof: () => true };
    const paidContext = { APPID: 'wx', OPENID: 'open' };
    const account = hashKey('wx', 'open');
    const proofs: Record<string, Record<string, unknown>> = {
      january: {
        out_trade_no: 'january',
        transaction_id: 'tx-january',
        trade_state: 'SUCCESS',
        appid: 'wx',
        payer: { openid: 'open' },
        amount: { total: 2800, currency: 'CNY' },
        success_time: '2026-01-01T04:00:00.000Z',
      },
      june: {
        out_trade_no: 'june',
        transaction_id: 'tx-june',
        trade_state: 'SUCCESS',
        appid: 'wx',
        payer: { openid: 'open' },
        amount: { total: 2800, currency: 'CNY' },
        success_time: '2026-06-01T04:00:00.000Z',
      },
    };
    for (const sequence of [
      ['january', 'june'],
      ['june', 'january'],
    ]) {
      const store = createStore();
      for (const orderId of Object.keys(proofs)) {
        store.orders.set(orderId, {
          order_id: orderId,
          account_key: account,
          app_id: 'wx',
          open_id: 'open',
          amount: 2800,
          status: 'PENDING',
        });
      }
      for (const orderId of sequence)
        await settleOrder(store, payment, proofs[orderId], paidContext);
      expect(store.entitlements.get(account).expires_at).toBe('2027-01-01T04:00:00.000Z');
    }
  });
  it('keeps natural-month clamping deterministic across all three-payment callback orders', async () => {
    const payment = { verifyProof: () => true };
    const paidContext = { APPID: 'wx', OPENID: 'open' };
    const account = hashKey('wx', 'open');
    const dates: Record<string, string> = {
      august: '2026-08-31T04:00:00.000Z',
      september: '2026-09-30T04:00:00.000Z',
      october: '2026-10-31T04:00:00.000Z',
    };
    const permutations = [
      ['august', 'september', 'october'],
      ['august', 'october', 'september'],
      ['september', 'august', 'october'],
      ['september', 'october', 'august'],
      ['october', 'august', 'september'],
      ['october', 'september', 'august'],
    ];
    for (const sequence of permutations) {
      const store = createStore();
      for (const orderId of Object.keys(dates)) {
        store.orders.set(orderId, {
          order_id: orderId,
          account_key: account,
          app_id: 'wx',
          open_id: 'open',
          amount: 2800,
          status: 'PENDING',
        });
      }
      for (const orderId of sequence)
        await settleOrder(
          store,
          payment,
          {
            out_trade_no: orderId,
            transaction_id: `tx-${orderId}`,
            trade_state: 'SUCCESS',
            appid: 'wx',
            payer: { openid: 'open' },
            amount: { total: 2800, currency: 'CNY' },
            success_time: dates[orderId],
          },
          paidContext,
        );
      expect(store.entitlements.get(account).expires_at).toBe('2028-02-28T04:00:00.000Z');
    }
  });
  it('snapshots an existing entitlement and restarts only after a renewal gap', async () => {
    const store = createStore();
    const payment = { verifyProof: () => true };
    const paidContext = { APPID: 'wx', OPENID: 'open' };
    const account = hashKey('wx', 'open');
    store.entitlements.set(account, {
      starts_at: '2026-02-28T04:00:00.000Z',
      expires_at: '2026-08-31T04:00:00.000Z',
    });
    for (const orderId of ['before-expiry', 'after-gap']) {
      store.orders.set(orderId, {
        order_id: orderId,
        account_key: account,
        app_id: 'wx',
        open_id: 'open',
        amount: 2800,
        status: 'PENDING',
      });
    }
    const proof = (orderId: string, paidAt: string) => ({
      out_trade_no: orderId,
      transaction_id: `tx-${orderId}`,
      trade_state: 'SUCCESS',
      appid: 'wx',
      payer: { openid: 'open' },
      amount: { total: 2800, currency: 'CNY' },
      success_time: paidAt,
    });
    await settleOrder(store, payment, proof('after-gap', '2027-09-01T04:00:00.000Z'), paidContext);
    await settleOrder(
      store,
      payment,
      proof('before-expiry', '2026-08-30T04:00:00.000Z'),
      paidContext,
    );
    expect(store.entitlements.get(account)).toMatchObject({
      starts_at: '2027-09-01T04:00:00.000Z',
      expires_at: '2028-03-01T04:00:00.000Z',
      renewal_base: {
        starts_at: '2026-02-28T04:00:00.000Z',
        expires_at: '2026-08-31T04:00:00.000Z',
      },
    });
  });
});

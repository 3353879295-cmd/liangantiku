/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { CloudStore } = require('../cloudfunctions/membership/lib/cloud-store.js') as any;
const { hasReleasedTestHold, isReconcilable, isUnresolved } =
  require('../cloudfunctions/membership/lib/order-state.js') as any;
const { createHandler, hashKey, reconcilePendingOrders, settleOrder } =
  require('../cloudfunctions/membership/lib/handler.js') as any;

const context = { APPID: 'wx-test', OPENID: 'open-test' };
const marker = {
  version: 1,
  reason: 'confirmed_unpaid_test',
  confirmed_at: '2026-09-15T00:00:00.000Z',
};
const virtualOrder = (
  id: string,
  status = 'PAYMENT_UNKNOWN',
  extra: Record<string, unknown> = {},
) => ({
  order_id: id,
  account_key: hashKey(context.APPID, context.OPENID),
  app_id: context.APPID,
  open_id: context.OPENID,
  amount: 2800,
  currency: 'CNY',
  status,
  payment_provider: 'virtual',
  product_id: 'product',
  next_check_at: '2026-09-15T00:00:00.000Z',
  ...extra,
});
const payment = {
  kind: 'virtual',
  available: true,
  config: { enabled: true, appId: context.APPID, productId: 'product' },
  createPayment: async () => ({
    mode: 'short_series_goods',
    signData: 'signed',
    paySig: 'a'.repeat(64),
    signature: 'b'.repeat(64),
  }),
  verifyProof: () => true,
};
const memoryStore = () => {
  const orders = new Map<string, any>();
  const pointers = new Map<string, string | null>();
  const entitlements = new Map<string, any>();
  const locks = new Map<string, string>();
  const store: any = {
    orders,
    entitlements,
    getOrder: async (id: string) => orders.get(id) ?? null,
    createOrder: async (id: string, value: any) => void orders.set(id, value),
    saveOrder: async (id: string, value: any) => void orders.set(id, value),
    getPendingPurchase: async (key: string) =>
      pointers.has(key) ? { pending_order_id: pointers.get(key) } : null,
    savePendingPurchase: async (key: string, id: string | null) => void pointers.set(key, id),
    getEntitlement: async (key: string) => entitlements.get(key) ?? null,
    saveEntitlement: async (key: string, value: any) => void entitlements.set(key, value),
    getUsage: async () => null,
    getOrderByTransaction: async (id: string) =>
      locks.has(id) ? orders.get(locks.get(id)!) : null,
    saveTransactionLock: async (id: string, orderId: string) => void locks.set(id, orderId),
    listDuePendingOrders: async (key: string) =>
      [...orders.values()].filter(
        (order) => order.account_key === key && isUnresolved(order) && !hasReleasedTestHold(order),
      ),
    listDueReconcileOrders: async (key: string | null) =>
      [...orders.values()].filter(
        (order) => (!key || order.account_key === key) && isReconcilable(order),
      ),
  };
  store.transaction = async (work: any) => work(store);
  return store;
};
const database = (rows: any[]) => ({
  command: {
    in: (values: string[]) => ({ in: values }),
    lte: (value: string) => ({ lte: value }),
    gt: (value: string) => ({ gt: value }),
  },
  collection: () => ({
    doc: () => ({ get: () => ({ data: null }) }),
    where(where: any) {
      const query: any = {
        orderBy: () => query,
        limit: (count: number) => ({
          get: () => ({
            data: rows
              .filter(
                (row) =>
                  where.status.in.includes(row.status) &&
                  (!where.account_key || row.account_key === where.account_key) &&
                  (!where._id || row._id > where._id.gt),
              )
              .sort((a, b) => a._id.localeCompare(b._id))
              .slice(0, count),
          }),
        }),
      };
      return query;
    },
  }),
  runTransaction: async () => undefined,
});

describe('confirmed unpaid test hold release', () => {
  it('requires an exact virtual marker without changing unresolved or reconciliable state', () => {
    const unknown = virtualOrder('unknown');
    expect(hasReleasedTestHold(unknown)).toBe(false);
    expect(isUnresolved(unknown)).toBe(true);
    expect(isReconcilable(unknown)).toBe(true);
    expect(
      hasReleasedTestHold({
        ...unknown,
        purchase_hold_release: { ...marker, confirmed_at: 'bad' },
      }),
    ).toBe(false);
    expect(
      hasReleasedTestHold({
        ...unknown,
        payment_provider: 'wechat',
        purchase_hold_release: marker,
      }),
    ).toBe(false);
    expect(hasReleasedTestHold({ ...unknown, purchase_hold_release: marker })).toBe(true);
  });

  it('pages past a released order for recovery while retaining it for reconciliation', async () => {
    const account = hashKey(context.APPID, context.OPENID);
    const released = Array.from({ length: 20 }, (_, index) => ({
      _id: `a${String(index).padStart(2, '0')}`,
      ...virtualOrder(`released-${index}`, 'PAYMENT_UNKNOWN', { purchase_hold_release: marker }),
    }));
    const pending = { _id: 'b', ...virtualOrder('pending') };
    const store = new CloudStore(database([...released, pending]));
    await expect(store.listDuePendingOrders(account, 1)).resolves.toMatchObject([
      { order_id: 'pending' },
    ]);
    await expect(store.listDueReconcileOrders(account, 1)).resolves.toMatchObject([
      { order_id: 'released-0' },
    ]);
  });

  it.each(['markPaymentStarting', 'markPaymentUnknown'])(
    'rejects %s after a valid bridge authorization is released',
    async (action) => {
      const store = memoryStore();
      const order = virtualOrder('prepared', 'PREPARED');
      store.orders.set(order.order_id, order);
      const handler = createHandler({ store, payment, now: () => new Date(marker.confirmed_at) });
      const authorization = await handler(
        { action: 'resumePayment', orderId: order.order_id, loginCode: 'code' },
        context,
      );
      expect(authorization).toMatchObject({ ok: true, data: { canStartPayment: true } });
      const request = {
        orderId: order.order_id,
        bridgeAttempt: authorization.data.bridgeAttempt,
        payment: authorization.data.payment,
      };
      if (action === 'markPaymentUnknown') {
        await expect(
          handler({ ...request, action: 'markPaymentStarting' }, context),
        ).resolves.toMatchObject({ data: { bridgeLease: true } });
      }
      const released = { ...store.orders.get(order.order_id), purchase_hold_release: marker };
      store.orders.set(order.order_id, released);
      let saves = 0;
      const saveOrder = store.saveOrder;
      store.saveOrder = async (...args: any[]) => {
        saves += 1;
        return saveOrder(...args);
      };
      await expect(handler({ ...request, action }, context)).resolves.toMatchObject({
        data: { order: { status: released.status }, bridgeLease: false, canStartPayment: false },
      });
      expect(saves).toBe(0);
      expect(store.orders.get(order.order_id)).toEqual(released);
    },
  );

  it('does not authorize payment when the prepared hold is released during signing', async () => {
    const store = memoryStore();
    const order = virtualOrder('prepared', 'PREPARED');
    store.orders.set(order.order_id, order);
    let resolvePayment: ((value: Record<string, string>) => void) | undefined;
    let resolveSigningStarted: (() => void) | undefined;
    const signingStarted = new Promise<void>((resolve) => {
      resolveSigningStarted = resolve;
    });
    const signingPayment = {
      ...payment,
      createPayment: () =>
        new Promise<Record<string, string>>((resolve) => {
          resolveSigningStarted?.();
          resolvePayment = resolve;
        }),
    };
    const handler = createHandler({
      store,
      payment: signingPayment,
      now: () => new Date(marker.confirmed_at),
    });
    const response = handler(
      { action: 'resumePayment', orderId: order.order_id, loginCode: 'code' },
      context,
    );
    await signingStarted;
    store.orders.set(order.order_id, { ...order, purchase_hold_release: marker });
    resolvePayment?.({
      mode: 'short_series_goods',
      signData: 'signed',
      paySig: 'a'.repeat(64),
      signature: 'b'.repeat(64),
    });
    await expect(response).resolves.toMatchObject({
      ok: true,
      data: { order: { orderId: order.order_id, status: 'PREPARED' }, canStartPayment: false },
    });
  });

  it('lets a new request replace a released pointer, but never reauthorizes the old request', async () => {
    const store = memoryStore();
    const oldId = `M${crypto
      .createHash('sha256')
      .update(`${hashKey(context.APPID, context.OPENID)}:old`)
      .digest('hex')
      .slice(0, 31)}`;
    const old = virtualOrder(oldId, 'PREPARED', {
      request_id: 'old',
      purchase_hold_release: marker,
    });
    store.orders.set(oldId, old);
    await store.savePendingPurchase(old.account_key, oldId);
    const handler = createHandler({ store, payment, now: () => new Date(marker.confirmed_at) });
    const created = await handler(
      { action: 'createOrder', requestId: 'new', loginCode: 'code', purchase_hold_release: marker },
      context,
    );
    expect(created).toMatchObject({
      ok: true,
      data: { canStartPayment: true, order: { amount: 2800 } },
    });
    expect(created.data.order.orderId).not.toBe(oldId);
    expect(store.orders.get(created.data.order.orderId).purchase_hold_release).toBeUndefined();
    await expect(
      handler({ action: 'createOrder', requestId: 'old', loginCode: 'code' }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { orderId: oldId }, canStartPayment: false },
    });
  });

  it('reports a requested released order only to its original account', async () => {
    const store = memoryStore();
    store.orders.set(
      'released',
      virtualOrder('released', 'PAYMENT_UNKNOWN', { purchase_hold_release: marker }),
    );
    store.orders.set('other', {
      ...virtualOrder('other', 'PAYMENT_UNKNOWN', { purchase_hold_release: marker }),
      account_key: 'other',
      open_id: 'other',
    });
    const handler = createHandler({ store, payment, now: () => new Date(marker.confirmed_at) });
    await expect(
      handler({ action: 'recoverOrders', localOrderId: 'released' }, context),
    ).resolves.toMatchObject({ data: { releasedTestOrderId: 'released' } });
    const other = await handler({ action: 'recoverOrders', localOrderId: 'other' }, context);
    expect(other).toMatchObject({ ok: true });
    expect(other.data).not.toHaveProperty('releasedTestOrderId');
    await expect(
      handler({ action: 'recoverOrders', localOrderId: 'bad id' }, context),
    ).resolves.toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('continues to reconcile and settle a released order exactly once after a late valid payment', async () => {
    const store = memoryStore();
    const order = virtualOrder('late', 'PAYMENT_UNKNOWN', { purchase_hold_release: marker });
    store.orders.set('late', order);
    const queried: string[] = [];
    const timerPayment = {
      ...payment,
      query: async (id: string) => {
        queried.push(id);
        return { out_trade_no: id, trade_state: 'PENDING' };
      },
    };
    await expect(
      reconcilePendingOrders(store, timerPayment, () => new Date(marker.confirmed_at), 1),
    ).resolves.toBe(1);
    expect(queried).toEqual(['late']);
    const proof = {
      out_trade_no: 'late',
      transaction_id: 'tx',
      trade_state: 'SUCCESS',
      appid: context.APPID,
      payer: { openid: context.OPENID },
      amount: { total: 2800, currency: 'CNY' },
      success_time: marker.confirmed_at,
    };
    await settleOrder(store, payment, proof, context, new Date(marker.confirmed_at));
    const expiresAt = store.entitlements.get(order.account_key).expires_at;
    await settleOrder(store, payment, proof, context, new Date(marker.confirmed_at));
    expect(store.orders.get('late')).toMatchObject({ status: 'PAID', transaction_id: 'tx' });
    expect(store.entitlements.get(order.account_key).expires_at).toBe(expiresAt);
    expect(store.entitlements.get(order.account_key).renewal_payments).toHaveLength(1);
  });
});

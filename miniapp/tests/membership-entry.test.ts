import { createRequire } from 'node:module';
import { createCipheriv, createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Handler = (event: Row, context?: Row) => Promise<Row>;
const require = createRequire(import.meta.url);
const { createHandler, hashKey, reconcilePendingOrders, settleOrder } =
  require('../cloudfunctions/membership/lib/handler.js') as {
    createHandler: (options: Row) => Handler;
    hashKey: (app: string, open: string) => string;
    reconcilePendingOrders: (
      store: MemoryStore,
      payment: Payment,
      now?: () => Date,
      limit?: number,
    ) => Promise<number>;
    settleOrder: (
      store: MemoryStore,
      payment: Payment,
      proof: Row,
      context: Row,
      now?: Date,
    ) => Promise<void>;
  };
const { createEntry } = require('../cloudfunctions/membership/lib/entry.js') as {
  createEntry: (options: Row) => Handler;
};
interface Payment {
  available: boolean;
  query: (orderId: string) => Promise<Row>;
  api: (method: string, path: string, payload?: Row) => Promise<Row>;
  verifyProof: (proof: Row, context: Row) => boolean;
  verifyHeaders: (headers: Row, body: string) => boolean;
}
const { WechatPayment } = require('../cloudfunctions/membership/lib/payment.js') as {
  WechatPayment: new (
    config: Row,
    transport?: (method: string, url: string, headers: Row, body: string) => Promise<Row>,
    now?: () => Date,
  ) => Payment;
};

// Serializes transactions and rolls back all collections on failure, like the cloud adapter.
class MemoryStore {
  orders = new Map<string, Row>();
  entitlements = new Map<string, Row>();
  locks = new Map<string, Row>();
  private queue = Promise.resolve();
  transaction<T>(work: (store: MemoryStore) => Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const orders = structuredClone(this.orders);
      const entitlements = structuredClone(this.entitlements);
      const locks = structuredClone(this.locks);
      try {
        return await work(this);
      } catch (error) {
        this.orders = orders;
        this.entitlements = entitlements;
        this.locks = locks;
        throw error;
      }
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
  getOrder(id: string) {
    return Promise.resolve(this.orders.get(id) ?? null);
  }
  saveOrder(id: string, value: Row) {
    this.orders.set(id, value);
    return Promise.resolve();
  }
  createOrder(id: string, value: Row) {
    return this.saveOrder(id, value);
  }
  getEntitlement(id: string) {
    return Promise.resolve(this.entitlements.get(id) ?? null);
  }
  saveEntitlement(id: string, value: Row) {
    this.entitlements.set(id, value);
    return Promise.resolve();
  }
  getUsage() {
    return Promise.resolve(null);
  }
  getOrderByTransaction(id: string) {
    return Promise.resolve(this.locks.get(id) ?? null);
  }
  saveTransactionLock(id: string, orderId: string) {
    this.locks.set(id, { order_id: orderId });
    return Promise.resolve();
  }
  listDuePendingOrders(account: string | null, limit: number, due?: string) {
    return Promise.resolve(
      [...this.orders.values()]
        .filter(
          (order) =>
            order.status === 'PENDING' &&
            (!account || order.account_key === account) &&
            (!due || String(order.next_check_at) <= due),
        )
        .sort((a, b) => String(a.next_check_at).localeCompare(String(b.next_check_at)))
        .slice(0, limit),
    );
  }
}

const clock = new Date('2026-09-05T04:00:00.000Z');
const context = { APPID: 'wx-test', OPENID: 'open-test' };
const account = hashKey(context.APPID, context.OPENID);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = {
  enabled: true,
  appId: context.APPID,
  mchId: 'merchant',
  merchantSerial: 'merchant-serial',
  privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  apiV3Key: 'a'.repeat(32),
  notifyUrl: 'https://example.test/notify',
  platformCertificates: {
    platform: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  },
};
const makeOrder = (id: string): Row => ({
  order_id: id,
  account_key: account,
  app_id: context.APPID,
  open_id: context.OPENID,
  amount: 2800,
  currency: 'CNY',
  status: 'PENDING',
  paid_at: null,
  created_at: '2026-09-05T03:00:00.000Z',
  next_check_at: '2026-09-05T03:00:00.000Z',
});
const makeProof = (id: string): Row => ({
  out_trade_no: id,
  appid: context.APPID,
  mchid: 'merchant',
  payer: { openid: context.OPENID },
  amount: { total: 2800, currency: 'CNY' },
  transaction_id: `wx-${id}`,
  trade_state: 'SUCCESS',
  success_time: '2026-09-05T12:00:00+08:00',
});
const signed = (body: string) => {
  const timestamp = String(clock.getTime() / 1000);
  return {
    'Wechatpay-Timestamp': timestamp,
    'Wechatpay-Nonce': 'nonce',
    'Wechatpay-Serial': 'platform',
    'Wechatpay-Signature': createSign('RSA-SHA256')
      .update(`${timestamp}\nnonce\n${body}\n`)
      .sign(keys.privateKey, 'base64'),
  };
};
const notification = (proof: Row) => {
  const nonce = 'abcdefghijkl';
  const aad = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(proof)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  const body = JSON.stringify(
    {
      event_type: 'TRANSACTION.SUCCESS',
      resource_type: 'encrypt-resource',
      resource: { algorithm: 'AEAD_AES_256_GCM', nonce, associated_data: aad, ciphertext },
    },
    null,
    2,
  );
  return { httpMethod: 'POST', body, headers: signed(body) };
};
const setup = () => {
  const store = new MemoryStore();
  const payment = new WechatPayment(config, undefined, () => clock);
  const handler = createHandler({ store, payment, now: () => clock });
  const entry = createEntry({
    store,
    payment,
    handler,
    getContext: () => context,
    now: () => clock,
  });
  return { store, payment, handler, entry };
};

describe('real signed membership payment and entry boundaries', () => {
  it('decrypts a real signed notification, commits membership, and acknowledges duplicate callbacks once', async () => {
    const { store, entry } = setup();
    store.orders.set('o1', makeOrder('o1'));
    const event = notification(makeProof('o1'));
    expect(await entry(event)).toMatchObject({ statusCode: 200 });
    expect(store.orders.get('o1')).toMatchObject({ status: 'PAID', paid_at: clock.toISOString() });
    const expires = store.entitlements.get(account)?.expires_at;
    expect(expires).toBe('2027-03-05T04:00:00.000Z');
    expect(await entry(event)).toMatchObject({ statusCode: 200 });
    expect(store.entitlements.get(account)?.expires_at).toBe(expires);
  });

  it('replays real signed callbacks by their verified payment times', async () => {
    const { store, entry } = setup();
    store.orders.set('january', makeOrder('january'));
    store.orders.set('june', makeOrder('june'));
    const january = {
      ...makeProof('january'),
      success_time: '2026-01-01T12:00:00+08:00',
    };
    const june = {
      ...makeProof('june'),
      success_time: '2026-06-01T12:00:00+08:00',
    };
    expect(await entry(notification(june))).toMatchObject({ statusCode: 200 });
    expect(await entry(notification(january))).toMatchObject({ statusCode: 200 });
    expect(store.entitlements.get(account)).toMatchObject({
      expires_at: '2027-09-05T04:00:00.000Z',
      renewal_payments: [
        { order_id: 'january', paid_at: '2026-01-01T04:00:00.000Z' },
        { order_id: 'june', paid_at: '2026-06-01T04:00:00.000Z' },
      ],
    });
  });

  it('accepts base64 raw bytes but rejects parsed or reserialized bodies and signed wrong amounts', async () => {
    const { store, entry } = setup();
    store.orders.set('o1', makeOrder('o1'));
    const event = notification(makeProof('o1'));
    expect(await entry({ ...event, body: JSON.parse(event.body) as unknown })).toMatchObject({
      statusCode: 400,
    });
    expect(await entry({ ...event, body: JSON.stringify(JSON.parse(event.body)) })).toMatchObject({
      statusCode: 401,
    });
    expect(
      await entry(notification({ ...makeProof('o1'), amount: { total: 1, currency: 'CNY' } })),
    ).toMatchObject({ statusCode: 500 });
    expect(store.entitlements.size).toBe(0);
    expect(
      await entry({
        ...event,
        body: Buffer.from(event.body).toString('base64'),
        isBase64Encoded: true,
      }),
    ).toMatchObject({ statusCode: 200 });
  });

  it('accepts a trusted timer even when the SDK context retains a caller', async () => {
    const { store, payment, handler } = setup();
    const due = vi.spyOn(store, 'listDuePendingOrders');
    const entry = createEntry({
      store,
      payment,
      handler,
      getContext: () => context,
      isTimerInvocation: () => true,
    });
    await expect(
      entry({ Type: 'Timer', TriggerName: 'membership-reconcile-pending' }),
    ).resolves.toEqual({ ok: true, data: { processed: 0 } });
    expect(due).toHaveBeenCalledOnce();
  });

  it('never dispatches fake timers, the wrong trigger, or an HTTP request to global reconciliation', async () => {
    const { store, payment, handler } = setup();
    const due = vi.spyOn(store, 'listDuePendingOrders');
    const timer = { Type: 'Timer', TriggerName: 'membership-reconcile-pending', OPENID: '' };
    for (const caller of [{}, context]) {
      const entry = createEntry({
        store,
        payment,
        handler,
        getContext: () => caller,
        isTimerInvocation: () => false,
      });
      await entry(timer);
    }
    const trustedEntry = createEntry({
      store,
      payment,
      handler,
      getContext: () => ({}),
      isTimerInvocation: () => true,
    });
    await trustedEntry({ ...timer, TriggerName: 'other-trigger' });
    await trustedEntry({ ...timer, httpMethod: 'POST', body: '{}' });
    expect(due).not.toHaveBeenCalled();
  });

  it('normalizes +08:00 payment times and serializes different orders, query/callback, and transaction locks', async () => {
    const { store, payment } = setup();
    store.entitlements.set(account, {
      starts_at: clock.toISOString(),
      expires_at: '2026-09-05T05:00:00.000Z',
    });
    for (const id of ['o1', 'o2', 'o3']) store.orders.set(id, makeOrder(id));
    await Promise.all([
      settleOrder(store, payment, makeProof('o1'), context),
      settleOrder(store, payment, makeProof('o2'), context),
      settleOrder(store, payment, makeProof('o1'), context),
    ]);
    expect(store.entitlements.get(account)?.expires_at).toBe('2027-09-05T05:00:00.000Z');
    await expect(
      settleOrder(store, payment, { ...makeProof('o3'), transaction_id: 'wx-o1' }, context),
    ).rejects.toThrow();
    expect(store.orders.get('o3')?.status).toBe('PENDING');
  });

  it('does not expose the retired generic JSAPI purchase branch', async () => {
    const store = new MemoryStore();
    const createJsapi = vi.fn();
    const handler = createHandler({
      store,
      payment: { available: true, config, createJsapi },
      now: () => clock,
    });
    const request = { action: 'createOrder', requestId: 'unique-request' };
    expect(await handler(request, context)).toMatchObject({
      ok: false,
      error: { code: 'MEMBERSHIP_UNAVAILABLE' },
    });
    expect(store.orders.size).toBe(0);
    expect(createJsapi).not.toHaveBeenCalled();
  });

  it('rolls back renewal history with the order when the transaction lock write fails', async () => {
    const { store, payment } = setup();
    store.orders.set('o1', makeOrder('o1'));
    const lock = vi.spyOn(store, 'saveTransactionLock').mockRejectedValueOnce(new Error('write'));
    await expect(settleOrder(store, payment, makeProof('o1'), context)).rejects.toThrow('write');
    expect(store.entitlements.size).toBe(0);
    expect(store.orders.get('o1')?.status).toBe('PENDING');
    expect(store.locks.size).toBe(0);
    lock.mockRestore();
    await settleOrder(store, payment, makeProof('o1'), context);
    expect(store.entitlements.get(account)?.renewal_payments).toEqual([
      {
        order_id: 'o1',
        paid_at: clock.toISOString(),
        effective_at: clock.toISOString(),
        settled_at: clock.toISOString(),
      },
    ]);
    expect(store.entitlements.get(account)?.expires_at).toBe('2027-03-05T04:00:00.000Z');
  });

  it('only accepts a verified SUCCESS proof for the queried order and keeps failed payment inactive', async () => {
    const { store, payment, handler } = setup();
    store.orders.set('o1', makeOrder('o1'));
    const query = vi.spyOn(payment, 'query').mockResolvedValue(makeProof('other'));
    expect(await handler({ action: 'getOrder', orderId: 'o1' }, context)).toMatchObject({
      ok: false,
    });
    query.mockResolvedValue({ ...makeProof('o1'), trade_state: 'PAYERROR' });
    expect(await handler({ action: 'getOrder', orderId: 'o1' }, context)).toMatchObject({
      ok: true,
      data: { order: { status: 'PAYMENT_UNKNOWN' }, membership: { isMember: false } },
    });
    expect(store.entitlements.size).toBe(0);
  });

  it('leases due batches fairly and continues after an individual query failure', async () => {
    const { store, payment } = setup();
    for (const id of ['o1', 'o2', 'o3']) store.orders.set(id, makeOrder(id));
    const query = vi
      .spyOn(payment, 'query')
      .mockRejectedValueOnce(new Error('transient'))
      .mockImplementation((id) => Promise.resolve(makeProof(id)));
    expect(await reconcilePendingOrders(store, payment, () => clock, 2)).toBe(2);
    expect(store.orders.get('o1')?.next_check_at).toBe('2026-09-05T04:10:00.000Z');
    expect(store.orders.get('o2')?.status).toBe('PAID');
    expect(await reconcilePendingOrders(store, payment, () => clock, 2)).toBe(1);
    expect(query.mock.calls.map(([id]) => id)).toEqual(['o1', 'o2', 'o3']);
    expect(store.orders.get('o3')?.status).toBe('PAID');
  });

  it('verifies API response bytes before using a successful-looking JSON payload', async () => {
    const body = JSON.stringify({ trade_state_desc: '支付成功', ...makeProof('o1') });
    const transport = vi.fn().mockResolvedValue({ statusCode: 200, headers: signed(body), body });
    const payment = new WechatPayment(config, transport, () => clock);
    expect(await payment.query('o1')).toMatchObject({ trade_state: 'SUCCESS' });
    transport.mockResolvedValue({
      statusCode: 200,
      headers: signed(body),
      body: body.replace('支付成功', '已篡改'),
    });
    await expect(payment.query('o1')).rejects.toThrow();
  });
});

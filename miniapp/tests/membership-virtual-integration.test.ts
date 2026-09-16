import { createRequire } from 'node:module';
import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type OrderData = { order: { orderId: string; status: string }; payment?: Row };
const require = createRequire(import.meta.url);
const context = { APPID: 'wx-test', OPENID: 'open-test' };
const clock = new Date('2026-09-06T00:00:00Z');
const { hashKey, createHandler, settleOrder, settleRefund, reconcilePendingOrders } =
  require('../cloudfunctions/membership/lib/handler.js') as {
    hashKey: (app: string, open: string) => string;
    createHandler: (options: Row) => (event: Row, context: Row) => Promise<Row>;
    settleOrder: (
      store: Store,
      payment: Row,
      proof: Row,
      context: Row,
      timestamp?: Date,
    ) => Promise<void>;
    settleRefund: (store: Store, payment: Row, proof: Row, context: Row) => Promise<void>;
    reconcilePendingOrders: (
      store: Store,
      payment: Row,
      now: () => Date,
      limit?: number,
      accountKey?: string | null,
      diagnostics?: Row | null,
    ) => Promise<number>;
  };
const { createEntry } = require('../cloudfunctions/membership/lib/entry.js') as {
  createEntry: (options: Row) => (event: Row) => Promise<Row>;
};
const { createDiagnostics } = require('../cloudfunctions/membership/lib/diagnostics.js') as {
  createDiagnostics: (options: Row) => Row;
};
const account = hashKey(context.APPID, context.OPENID);

class Store {
  orders = new Map<string, Row>();
  entitlements = new Map<string, Row>();
  locks = new Map<string, Row>();
  pendingPurchases = new Map<string, Row>();
  private queue = Promise.resolve();
  transaction<T>(work: (store: Store) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const saved = structuredClone([
        this.orders,
        this.entitlements,
        this.locks,
        this.pendingPurchases,
      ]);
      try {
        return await work(this);
      } catch (error) {
        [this.orders, this.entitlements, this.locks, this.pendingPurchases] = saved as [
          Map<string, Row>,
          Map<string, Row>,
          Map<string, Row>,
          Map<string, Row>,
        ];
        throw error;
      }
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  getOrder(id: string) {
    return Promise.resolve(this.orders.get(id) ?? null);
  }
  saveOrder(id: string, row: Row) {
    this.orders.set(id, row);
    return Promise.resolve();
  }
  createOrder(id: string, row: Row) {
    return this.saveOrder(id, row);
  }
  getPendingPurchase(accountKey: string) {
    return Promise.resolve(this.pendingPurchases.get(accountKey) ?? null);
  }
  savePendingPurchase(accountKey: string, orderId: string | null) {
    this.pendingPurchases.set(accountKey, { pending_order_id: orderId });
    return Promise.resolve();
  }
  getEntitlement(id: string) {
    return Promise.resolve(this.entitlements.get(id) ?? null);
  }
  saveEntitlement(id: string, row: Row) {
    this.entitlements.set(id, row);
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
  listDueReconcileOrders(accountKey: string | null, limit: number, due?: string) {
    return Promise.resolve(
      [...this.orders.values()]
        .filter(
          (row) =>
            ['PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING', 'PAID'].includes(
              String(row.status),
            ) &&
            (!accountKey || row.account_key === accountKey) &&
            (!due || String(row.next_check_at) <= due),
        )
        .slice(0, limit),
    );
  }
  listDuePendingOrders(accountKey: string | null, limit: number) {
    return Promise.resolve(
      [...this.orders.values()]
        .filter(
          (row) =>
            ['PREPARED', 'PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING'].includes(
              String(row.status),
            ) &&
            (!accountKey || row.account_key === accountKey),
        )
        .slice(0, limit),
    );
  }
}

const order = (id = 'Morder0001'): Row => ({
  order_id: id,
  app_id: context.APPID,
  open_id: context.OPENID,
  account_key: account,
  payment_provider: 'virtual',
  product_id: 'membership-6m',
  amount: 2800,
  currency: 'CNY',
  status: 'PENDING',
  next_check_at: clock.toISOString(),
});
const proof = (id = 'Morder0001', state = 'SUCCESS', paid = '2026-09-06T00:00:00Z'): Row => ({
  out_trade_no: id,
  appid: context.APPID,
  payer: { openid: context.OPENID },
  amount: { total: 2800, currency: 'CNY' },
  transaction_id: `wx-${id}`,
  success_time: paid,
  trade_state: state,
  platform_status: 2,
  platform_env: 1,
  platform_order_type: 0,
});
const payment = () => ({
  kind: 'virtual',
  available: true,
  canReconcile: true,
  config: { appId: context.APPID, productId: 'membership-6m' },
  verifyProof: vi.fn().mockReturnValue(true),
  createPayment: vi.fn().mockResolvedValue({
    mode: 'short_series_goods',
    signData: '{"stable":"payment"}',
    paySig: 'a'.repeat(64),
    signature: 'b'.repeat(64),
  }),
  query: vi.fn().mockResolvedValue(proof()),
  provideGoods: vi.fn().mockResolvedValue(undefined),
});

describe('virtual membership integration', () => {
  it('authenticates an encrypted full-refund callback before recovering membership without guessing a refund query ID', async () => {
    const store = new Store();
    store.orders.set('Morder0001', order());
    await settleOrder(store, payment(), proof(), context);
    const { VirtualPayment } = require('../cloudfunctions/membership/lib/virtual-payment.js') as {
      VirtualPayment: new (config: Row, transport: () => never) => Row;
    };
    const aesKey = Buffer.alloc(32, 7);
    const config = {
      enabled: false,
      appId: context.APPID,
      appSecret: 'synthetic',
      offerId: 'synthetic',
      appKey: 'synthetic',
      productId: 'membership-6m',
      messageToken: 'synthetic-token',
      messageAesKey: aesKey.toString('base64').slice(0, -1),
    };
    const pay = new VirtualPayment(config, () => {
      throw new Error('unexpected network request');
    });
    const body = JSON.stringify({
      MsgType: 'event',
      Event: 'xpay_refund_notify',
      OpenId: context.OPENID,
      MchOrderId: 'Morder0001',
      WxOrderId: 'wx-Morder0001',
      WxRefundId: 'refund-one',
      MchRefundId: 'merchant-refund-one',
      RetCode: 0,
      RefundFee: 2800,
    });
    const length = Buffer.alloc(4);
    length.writeUInt32BE(Buffer.byteLength(body));
    const payload = Buffer.concat([
      Buffer.alloc(16, 3),
      length,
      Buffer.from(body),
      Buffer.from(context.APPID),
    ]);
    const padding = 32 - (payload.length % 32);
    const cipher = createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.concat([payload, Buffer.alloc(padding, padding)])),
      cipher.final(),
    ]).toString('base64');
    const timestamp = '1788652800';
    const nonce = 'refund-nonce';
    const signature = createHash('sha1')
      .update([config.messageToken, timestamp, nonce, encrypted].sort().join(''))
      .digest('hex');
    const event = {
      httpMethod: 'POST',
      body: JSON.stringify({ Encrypt: encrypted }),
      queryStringParameters: { timestamp, nonce, encrypt_type: 'aes', msg_signature: signature },
    };
    const entry = createEntry({ store, payment: pay, getContext: () => context, handler: vi.fn() });
    expect(
      (
        await entry({
          ...event,
          queryStringParameters: { ...event.queryStringParameters, msg_signature: 'forged' },
        })
      ).statusCode,
    ).toBe(401);
    expect(store.orders.get('Morder0001')?.status).toBe('PAID');
    expect((await entry(event)).statusCode).toBe(200);
    expect((await entry(event)).statusCode).toBe(200);
    expect(store.orders.get('Morder0001')).toMatchObject({
      status: 'REFUNDED',
      refund_transaction_id: 'refund-one',
    });
    expect(store.entitlements.get(account)?.expires_at).toBeNull();
    expect(store.locks.size).toBe(1);
  });
  it('snapshots the server product and passes the login code without persisting it', async () => {
    const store = new Store();
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    expect(await handler({ action: 'createOrder', requestId: 'r1' }, context)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(store.orders.size).toBe(0);
    const result = await handler(
      { action: 'createOrder', requestId: 'r1', loginCode: 'ephemeral' },
      context,
    );
    expect(result.ok).toBe(true);
    expect([...store.orders.values()][0]).toMatchObject({
      product_id: 'membership-6m',
      payment_provider: 'virtual',
    });
    expect(JSON.stringify([...store.orders.values()])).not.toContain('ephemeral');
    expect(pay.createPayment).toHaveBeenCalledWith(expect.anything(), context, 'ephemeral');
  });

  it('serializes different concurrent request ids to one prepared virtual order', async () => {
    const store = new Store();
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    const [first, second] = await Promise.all([
      handler({ action: 'createOrder', requestId: 'r-one', loginCode: 'one' }, context),
      handler({ action: 'createOrder', requestId: 'r-two', loginCode: 'two' }, context),
    ]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    const firstData = first.data as OrderData;
    const secondData = second.data as OrderData;
    expect(firstData.order.orderId).toBe(secondData.order.orderId);
    expect([...store.orders.values()]).toHaveLength(1);
    // PREPARED is intentionally resumable until the client records that it is entering
    // the native bridge; either response can be safely used by the client-side mutex.
    expect(pay.createPayment).toHaveBeenCalledTimes(2);
    expect(store.pendingPurchases.get(account)).toEqual({
      pending_order_id: firstData.order.orderId,
    });
  });

  it('allows a PREPARED order to be safely resumed with its original merchant order number', async () => {
    const store = new Store();
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    const first = await handler(
      { action: 'createOrder', requestId: 'same', loginCode: 'one' },
      context,
    );
    const retried = await handler(
      { action: 'createOrder', requestId: 'same', loginCode: 'two' },
      context,
    );
    const firstData = first.data as OrderData;
    const retriedData = retried.data as OrderData;
    expect(retriedData.order).toEqual(firstData.order);
    expect(firstData).toHaveProperty('canStartPayment', true);
    expect(retriedData).toHaveProperty('canStartPayment', true);
    expect(retriedData).toHaveProperty('payment');
    expect(pay.createPayment).toHaveBeenCalledTimes(2);
  });

  it('does not query a PREPARED order during get/recover, but queries after bridge-start evidence', async () => {
    const store = new Store();
    const prepared = { ...(order('Mprepared') as Row & { order_id: string }), status: 'PREPARED' };
    store.orders.set(prepared.order_id, prepared);
    store.pendingPurchases.set(account, { pending_order_id: prepared.order_id });
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    await expect(
      handler({ action: 'getOrder', orderId: prepared.order_id }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { status: 'PREPARED' } },
    });
    await expect(handler({ action: 'recoverOrders' }, context)).resolves.toMatchObject({
      ok: true,
      data: { pendingOrder: { status: 'PREPARED' } },
    });
    expect(pay.query).not.toHaveBeenCalled();
    store.orders.set(prepared.order_id, { ...prepared, status: 'PAYMENT_STARTING' });
    pay.query.mockResolvedValueOnce(proof(prepared.order_id, 'NOTPAY'));
    await handler({ action: 'getOrder', orderId: prepared.order_id }, context);
    expect(pay.query).toHaveBeenCalledWith(prepared.order_id, expect.anything());
    expect(store.orders.get(prepared.order_id)?.status).toBe('PENDING');
  });

  it('grants exactly one bridge lease for a shared prepared order', async () => {
    const store = new Store();
    const prepared = { ...(order('Mlease') as Row & { order_id: string }), status: 'PREPARED' };
    store.orders.set(prepared.order_id, prepared);
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    const signed = await handler(
      { action: 'resumePayment', orderId: prepared.order_id, loginCode: 'fresh-login' },
      context,
    );
    const bridge = (signed as { data: { bridgeAttempt: string; payment: Row } }).data;
    const [left, right] = await Promise.all([
      handler({ action: 'markPaymentStarting', orderId: prepared.order_id, ...bridge }, context),
      handler({ action: 'markPaymentStarting', orderId: prepared.order_id, ...bridge }, context),
    ]);
    expect(
      [left, right].filter(
        (result) => (result as { data?: { bridgeLease?: boolean } }).data?.bridgeLease === true,
      ),
    ).toHaveLength(1);
    expect(store.orders.get(prepared.order_id)?.status).toBe('PAYMENT_STARTING');
    await expect(
      handler({ action: 'markPaymentStarting', orderId: prepared.order_id }, context),
    ).resolves.toMatchObject({
      data: { bridgeLease: false },
    });
  });

  it('keeps query status 0 as PAYMENT_UNKNOWN without NOTPAY authorization evidence', async () => {
    const store = new Store();
    const item = {
      ...(order('Minitialized') as Row & { order_id: string }),
      status: 'PAYMENT_UNKNOWN',
    };
    store.orders.set(item.order_id, item);
    const pay = payment();
    pay.query.mockResolvedValue({
      ...proof(item.order_id, 'INITIALIZED'),
      platform_status: 0,
    });
    const handler = createHandler({ store, payment: pay, now: () => clock });
    await expect(
      handler({ action: 'getOrder', orderId: item.order_id }, context),
    ).resolves.toMatchObject({
      data: { order: { status: 'PAYMENT_UNKNOWN' } },
    });
    expect(store.orders.get(item.order_id)).toMatchObject({
      status: 'PAYMENT_UNKNOWN',
      platform_status: 0,
    });
    expect(store.orders.get(item.order_id)).not.toHaveProperty('platform_notpay_confirmed_at');
  });

  it('never reissues a platform-created PENDING order', async () => {
    const store = new Store();
    const pending = { ...(order('Mresume') as Row & { order_id: string }), status: 'PENDING' };
    store.orders.set(pending.order_id, pending);
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    const resumed = await handler(
      { action: 'resumePayment', orderId: pending.order_id, loginCode: 'new-login-code' },
      context,
    );
    expect(resumed).toMatchObject({
      ok: true,
      data: { order: { orderId: pending.order_id, status: 'PENDING' }, canStartPayment: false },
    });
    expect(pay.createPayment).not.toHaveBeenCalled();
    expect(pay.query).not.toHaveBeenCalled();
  });

  it('rejects wrong, expired, replayed, and stale-state prepared bridge attempts', async () => {
    const store = new Store();
    const pending = { ...(order('Mattempt') as Row & { order_id: string }), status: 'PREPARED' };
    store.orders.set(pending.order_id, pending);
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    const resumed = (await handler(
      { action: 'resumePayment', orderId: pending.order_id, loginCode: 'new-login-code' },
      context,
    )) as { data: { bridgeAttempt: string } };
    const attempt = resumed.data.bridgeAttempt;
    await expect(
      handler(
        { action: 'markPaymentStarting', orderId: pending.order_id, bridgeAttempt: 'b'.repeat(43) },
        context,
      ),
    ).resolves.toMatchObject({ data: { bridgeLease: false } });
    store.orders.set(pending.order_id, {
      ...store.orders.get(pending.order_id),
      bridge_attempt_expires_at: new Date(clock.valueOf() - 1).toISOString(),
    });
    await expect(
      handler(
        { action: 'markPaymentStarting', orderId: pending.order_id, bridgeAttempt: attempt },
        context,
      ),
    ).resolves.toMatchObject({ data: { bridgeLease: false } });

    const renewed = (await handler(
      { action: 'resumePayment', orderId: pending.order_id, loginCode: 'new-login-code' },
      context,
    )) as { data: { bridgeAttempt: string } };
    store.orders.set(pending.order_id, { ...store.orders.get(pending.order_id), status: 'PAID' });
    await expect(
      handler(
        {
          action: 'markPaymentStarting',
          orderId: pending.order_id,
          bridgeAttempt: renewed.data.bridgeAttempt,
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { bridgeLease: false } });
  });

  it('binds a prepared attempt to its exact payment and consumes it once', async () => {
    const store = new Store();
    const pending = {
      ...(order('Mpayment-bind') as Row & { order_id: string }),
      status: 'PREPARED',
    };
    store.orders.set(pending.order_id, pending);
    const pay = payment();
    const oldPayment = {
      mode: 'short_series_goods',
      signData: '{"payment":"old"}',
      paySig: 'c'.repeat(64),
      signature: 'd'.repeat(64),
    };
    const newPayment = {
      mode: 'short_series_goods',
      signData: '{"payment":"new"}',
      paySig: 'e'.repeat(64),
      signature: 'f'.repeat(64),
    };
    pay.createPayment.mockResolvedValueOnce(oldPayment).mockResolvedValueOnce(newPayment);
    const handler = createHandler({ store, payment: pay, now: () => clock });
    await handler(
      { action: 'resumePayment', orderId: pending.order_id, loginCode: 'first-code' },
      context,
    );
    const current = (await handler(
      { action: 'resumePayment', orderId: pending.order_id, loginCode: 'second-code' },
      context,
    )) as { data: { bridgeAttempt: string } };
    const bridgeAttempt = current.data.bridgeAttempt;
    for (const suppliedPayment of [
      oldPayment,
      { ...newPayment, signature: '0'.repeat(64) },
      undefined,
    ]) {
      await expect(
        handler(
          {
            action: 'markPaymentStarting',
            orderId: pending.order_id,
            bridgeAttempt,
            payment: suppliedPayment,
          },
          context,
        ),
      ).resolves.toMatchObject({ data: { bridgeLease: false } });
    }
    await expect(
      handler(
        {
          action: 'markPaymentStarting',
          orderId: pending.order_id,
          bridgeAttempt,
          payment: newPayment,
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { bridgeLease: true } });
    await expect(
      handler(
        {
          action: 'markPaymentStarting',
          orderId: pending.order_id,
          bridgeAttempt,
          payment: newPayment,
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { bridgeLease: false } });
  });

  it('does not query or issue a resumed payment after paid, terminal, or unknown states', async () => {
    for (const [id, status] of [
      ['Mpaidresume', 'PAID'],
      ['Mclosedresume', 'CLOSED'],
      ['Munknownresume', 'PAYMENT_UNKNOWN'],
    ] as const) {
      const store = new Store();
      store.orders.set(id, { ...order(id), status });
      const pay = payment();
      const handler = createHandler({ store, payment: pay, now: () => clock });
      const result = await handler(
        { action: 'resumePayment', orderId: id, loginCode: 'new-login-code' },
        context,
      );
      const resultData = result.data as Record<string, unknown> | undefined;
      expect(resultData?.payment).toBeUndefined();
      expect(pay.createPayment).not.toHaveBeenCalled();
      expect(pay.query).not.toHaveBeenCalled();
    }
  });

  it('does not let stale unknown reports downgrade prepared or pending orders, and keeps unknown idempotent', async () => {
    const store = new Store();
    const handler = createHandler({ store, payment: payment(), now: () => clock });
    for (const status of ['PREPARED', 'PENDING'] as const) {
      const item = { ...(order(`Mstale${status}`) as Row & { order_id: string }), status };
      store.orders.set(item.order_id, item);
      await expect(
        handler({ action: 'markPaymentUnknown', orderId: item.order_id }, context),
      ).resolves.toMatchObject({
        data: { order: { status }, bridgeLease: false },
      });
      expect(store.orders.get(item.order_id)?.status).toBe(status);
    }
    const unknown = {
      ...(order('Munknown') as Row & { order_id: string }),
      status: 'PAYMENT_UNKNOWN',
    };
    store.orders.set(unknown.order_id, unknown);
    await expect(
      handler({ action: 'markPaymentUnknown', orderId: unknown.order_id }, context),
    ).resolves.toMatchObject({
      data: { order: { status: 'PAYMENT_UNKNOWN' }, bridgeLease: false },
    });
    expect(store.orders.get(unknown.order_id)?.status).toBe('PAYMENT_UNKNOWN');
  });

  it('binds a legacy pending order before creating another request and exposes it safely to recovery', async () => {
    const store = new Store();
    store.orders.set('Mlegacy', order('Mlegacy'));
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    const created = await handler(
      { action: 'createOrder', requestId: 'fresh', loginCode: 'one' },
      context,
    );
    const createdData = created.data as OrderData;
    expect(created).toMatchObject({
      ok: true,
      data: { order: { orderId: 'Mlegacy', status: 'PENDING' } },
    });
    expect(createdData).not.toHaveProperty('payment');
    expect(pay.createPayment).not.toHaveBeenCalled();
    const recovered = await handler({ action: 'recoverOrders' }, context);
    const recoveredData = recovered.data as { pendingOrder: Row };
    expect(recoveredData.pendingOrder).toEqual({
      orderId: 'Mlegacy',
      status: 'PENDING',
      amount: 2800,
      paidAt: null,
    });
    expect(JSON.stringify(recoveredData.pendingOrder)).not.toContain('open-test');
    expect(JSON.stringify(recoveredData.pendingOrder)).not.toContain('next_check_at');
  });

  it('keeps two legacy pending orders intact and never creates around the account-level blocker', async () => {
    const store = new Store();
    const first = order('Mlegacyfirst') as Row & { order_id: string };
    const second = order('Mlegacysecond') as Row & { order_id: string };
    store.orders.set(first.order_id, first);
    store.orders.set(second.order_id, second);
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    await expect(
      handler({ action: 'createOrder', requestId: 'new-one', loginCode: 'one' }, context),
    ).resolves.toMatchObject({
      data: { order: { orderId: first.order_id, status: 'PENDING' } },
    });
    expect(store.orders.get(second.order_id)).toEqual(second);
    expect([...store.orders.keys()]).toHaveLength(2);
    // A legacy terminal row without platform evidence remains an account blocker.
    store.orders.set(first.order_id, { ...first, status: 'CLOSED' });
    store.pendingPurchases.set(account, { pending_order_id: first.order_id });
    await expect(
      handler({ action: 'createOrder', requestId: 'new-two', loginCode: 'two' }, context),
    ).resolves.toMatchObject({
      data: { order: { orderId: first.order_id, status: 'PAYMENT_UNKNOWN' } },
    });
    expect(store.pendingPurchases.get(account)).toEqual({ pending_order_id: first.order_id });
    expect([...store.orders.keys()]).toHaveLength(2);
  });

  it('settles concurrent query and notification evidence once for one transaction', async () => {
    const store = new Store();
    const row = order('Mconcurrent') as Row & { order_id: string };
    store.orders.set(row.order_id, row);
    const pay = payment();
    const evidence = proof(row.order_id, 'SUCCESS', '2026-09-06T00:00:00Z');
    pay.query.mockResolvedValue(evidence);
    const handler = createHandler({ store, payment: pay, now: () => clock });
    await Promise.all([
      settleOrder(store, pay, evidence, context, clock),
      handler({ action: 'getOrder', orderId: row.order_id }, context),
    ]);
    const entitlement = store.entitlements.get(account) as Row & { renewal_payments?: Row[] };
    expect(entitlement?.renewal_payments).toHaveLength(1);
    expect(entitlement?.renewal_payments?.[0]).toMatchObject({ order_id: row.order_id });
    await Promise.all([
      settleOrder(store, pay, evidence, context, clock),
      handler({ action: 'getOrder', orderId: row.order_id }, context),
    ]);
    expect(store.entitlements.get(account)?.renewal_payments).toHaveLength(1);
  });

  it('records a bounded per-order reconcile failure and continues with the next order', async () => {
    const store = new Store();
    const first = order('Mdiagfirst') as Row & { order_id: string };
    const second = order('Mdiagsecond') as Row & { order_id: string };
    store.orders.set(first.order_id, first);
    store.orders.set(second.order_id, second);
    const records: Row[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: Row) => records.push(row) },
    });
    const pay = payment();
    const error = Object.assign(
      new Error('openid-private signature-private raw-response-private'),
      {
        diagnostic: {
          code: 'ORDER_HTTP_STATUS',
          httpStatus: 412,
          platformCode: 12345,
          response: 'raw-response-private',
        },
      },
    );
    pay.query.mockRejectedValueOnce(error).mockResolvedValueOnce(proof(second.order_id, 'NOTPAY'));
    await expect(
      reconcilePendingOrders(store, pay, () => clock, 2, null, diagnostics),
    ).resolves.toBe(2);
    expect(pay.query).toHaveBeenCalledTimes(2);
    expect(store.orders.get(second.order_id)?.status).toBe('PENDING');
    const failure = records.find((record) => record.action === 'reconcilePendingOrders');
    expect(failure).toMatchObject({
      outcome: 'failed',
      stage: 'reconcile',
      errorCode: 'ORDER_HTTP_STATUS[errcode=12345]',
      httpStatus: 412,
      platformCode: 12345,
    });
    expect(failure).not.toHaveProperty('errorDetails');
    const serialized = JSON.stringify(records);
    for (const secret of [
      first.order_id,
      'openid-private',
      'signature-private',
      'raw-response-private',
    ])
      expect(serialized).not.toContain(secret);
  });

  it('logs each authoritative reconcile result only after its order handling succeeds', async () => {
    const store = new Store();
    const first = order('Mresultfirst') as Row & { order_id: string };
    const second = order('Mresultsecond') as Row & { order_id: string };
    store.orders.set(first.order_id, first);
    store.orders.set(second.order_id, second);
    const records: Row[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: Row) => records.push(row) },
    });
    const pay = payment();
    pay.query.mockResolvedValueOnce(proof(first.order_id, 'NOTPAY')).mockRejectedValueOnce(
      Object.assign(new Error('openid-private'), {
        diagnostic: { code: 'ORDER_PLATFORM_ERROR[errcode=268490002]', platformCode: 268490002 },
      }),
    );
    await expect(
      reconcilePendingOrders(store, pay, () => clock, 2, null, diagnostics),
    ).resolves.toBe(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: 'completed', tradeState: 'NOTPAY', platformStatus: 2 }),
        expect.objectContaining({
          outcome: 'failed',
          errorCode: 'ORDER_PLATFORM_ERROR[errcode=268490002]',
        }),
      ]),
    );
    expect(store.orders.get(first.order_id)?.status).toBe('PENDING');
    expect(store.orders.get(second.order_id)?.status).toBe('PENDING');
    expect(store.entitlements.size).toBe(0);
    expect(JSON.stringify(records)).not.toContain('private');
  });

  it.each(['missing', 'wrong-account'])(
    'does not replace a %s pending pointer without server confirmation',
    async (kind) => {
      const store = new Store();
      if (kind === 'wrong-account') {
        store.orders.set('Mforeign', { ...order('Mforeign'), account_key: 'another-account' });
        store.pendingPurchases.set(account, { pending_order_id: 'Mforeign' });
      } else {
        store.pendingPurchases.set(account, { pending_order_id: 'Mmissing' });
      }
      const pay = payment();
      const handler = createHandler({ store, payment: pay, now: () => clock });
      await expect(
        handler({ action: 'createOrder', requestId: 'fresh', loginCode: 'one' }, context),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'MEMBERSHIP_UNAVAILABLE' },
      });
      expect(pay.createPayment).not.toHaveBeenCalled();
      expect(store.orders.size).toBe(kind === 'wrong-account' ? 1 : 0);
    },
  );

  it('keeps an unverified legacy closed candidate as the account blocker', async () => {
    const store = new Store();
    store.orders.set('Mclosed-legacy', { ...order('Mclosed-legacy'), status: 'CLOSED' });
    store.orders.set('Mpending-legacy', order('Mpending-legacy'));
    vi.spyOn(store, 'listDuePendingOrders').mockResolvedValue([
      { ...order('Mclosed-legacy'), status: 'PENDING' },
      order('Mpending-legacy'),
    ]);
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    const result = await handler(
      { action: 'createOrder', requestId: 'fresh', loginCode: 'one' },
      context,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { order: { orderId: 'Mclosed-legacy', status: 'PAYMENT_UNKNOWN' } },
    });
    expect(pay.createPayment).not.toHaveBeenCalled();
    expect(store.pendingPurchases.get(account)).toEqual({ pending_order_id: 'Mclosed-legacy' });
  });

  it('keeps a legacy candidate when it changes from CLOSED to PENDING between the list snapshot and pointer transaction', async () => {
    const store = new Store();
    const legacy: Row & { order_id: string } = {
      ...order('Mclosed-race'),
      order_id: 'Mclosed-race',
      status: 'CLOSED',
    };
    store.orders.set(legacy.order_id, legacy);
    vi.spyOn(store, 'listDuePendingOrders').mockImplementation(() => {
      store.orders.set(legacy.order_id, { ...legacy, status: 'PENDING' });
      return Promise.resolve([legacy]);
    });
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });

    await expect(
      handler(
        { action: 'createOrder', requestId: 'race-replacement', loginCode: 'fresh' },
        context,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { orderId: legacy.order_id, status: 'PENDING' }, canStartPayment: false },
    });
    expect(store.pendingPurchases.get(account)).toEqual({ pending_order_id: legacy.order_id });
    expect(pay.createPayment).not.toHaveBeenCalled();
    expect(store.orders).toHaveLength(1);
  });

  it('returns an unverified terminal from a full legacy candidate page without creating around it', async () => {
    const store = new Store();
    for (let index = 0; index < 100; index += 1) {
      const id = `Mclosed${index}`;
      store.orders.set(id, { ...order(id), status: 'CLOSED' });
    }
    vi.spyOn(store, 'listDuePendingOrders').mockResolvedValue(
      [...store.orders.values()].map((row) => ({ ...row, status: 'PENDING' })),
    );
    const pay = payment();
    const handler = createHandler({ store, payment: pay, now: () => clock });
    await expect(
      handler({ action: 'createOrder', requestId: 'fresh', loginCode: 'one' }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { status: 'PAYMENT_UNKNOWN' }, canStartPayment: false },
    });
    expect(pay.createPayment).not.toHaveBeenCalled();
  });

  it.each(['CLOSED', 'FAILED'])(
    'keeps an unverified pointed %s order blocked',
    async (terminalStatus) => {
      const store = new Store();
      const old = { ...order('Mclosed'), status: terminalStatus };
      store.orders.set('Mclosed', old);
      store.pendingPurchases.set(account, { pending_order_id: 'Mclosed' });
      const pay = payment();
      const handler = createHandler({ store, payment: pay, now: () => clock });
      const result = await handler(
        { action: 'createOrder', requestId: 'new-request', loginCode: 'one' },
        context,
      );
      expect(result).toMatchObject({
        ok: true,
        data: { order: { orderId: 'Mclosed', status: 'PAYMENT_UNKNOWN' }, canStartPayment: false },
      });
      expect(pay.createPayment).not.toHaveBeenCalled();
    },
  );

  it('releases a platform-closed pending purchase for a new order without letting an old lookup clear it', async () => {
    const store = new Store();
    store.orders.set('Mclosed', order('Mclosed'));
    store.pendingPurchases.set(account, { pending_order_id: 'Mclosed' });
    const pay = payment();
    pay.query.mockResolvedValueOnce(proof('Mclosed', 'CLOSED'));
    const handler = createHandler({ store, payment: pay, now: () => clock });

    await expect(
      handler({ action: 'getOrder', orderId: 'Mclosed' }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { orderId: 'Mclosed', status: 'CLOSED' } },
    });
    expect(store.pendingPurchases.get(account)).toEqual({ pending_order_id: null });

    const created = await handler(
      { action: 'createOrder', requestId: 'after-closed', loginCode: 'fresh' },
      context,
    );
    const createdData = created.data as OrderData;
    expect(createdData.order.orderId).not.toBe('Mclosed');
    expect(store.pendingPurchases.get(account)).toEqual({
      pending_order_id: createdData.order.orderId,
    });

    await expect(
      handler({ action: 'getOrder', orderId: 'Mclosed' }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { status: 'CLOSED' } },
    });
    expect(store.pendingPurchases.get(account)).toEqual({
      pending_order_id: createdData.order.orderId,
    });
  });

  it('keeps NOTPAY pending and refuses to create or sign a replacement order', async () => {
    const store = new Store();
    store.orders.set('Mnotpay', order('Mnotpay'));
    store.pendingPurchases.set(account, { pending_order_id: 'Mnotpay' });
    const pay = payment();
    pay.query.mockResolvedValueOnce(proof('Mnotpay', 'NOTPAY'));
    const handler = createHandler({ store, payment: pay, now: () => clock });

    await expect(
      handler({ action: 'getOrder', orderId: 'Mnotpay' }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { status: 'PENDING' } },
    });
    await expect(
      handler(
        { action: 'createOrder', requestId: 'replacement', loginCode: 'replacement' },
        context,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { orderId: 'Mnotpay', status: 'PENDING' } },
    });
    expect(pay.createPayment).not.toHaveBeenCalled();
    expect([...store.orders.values()]).toHaveLength(1);
  });

  it.each([
    [
      'unrecognized platform errcode',
      'ORDER_PLATFORM_ERROR[errcode=12345]',
      { platformCode: 12345 },
    ],
    [
      'explicitly absent platform order',
      'ORDER_PLATFORM_ERROR[errcode=268490002]',
      { platformCode: 268490002, platformDetail: 'ORDER_NOT_FOUND_EXPLICIT' },
    ],
    [
      'non-2xx explicitly absent platform order',
      'ORDER_HTTP_STATUS',
      {
        httpStatus: 412,
        platformCode: 268490002,
        platformDetail: 'ORDER_NOT_FOUND_EXPLICIT',
      },
    ],
    ['ten-digit platform errcode', 'ORDER_PLATFORM_ERROR', {}],
    ['network failure', 'ORDER_HTTP_ERROR', { httpOperation: 'query' }],
    ['malformed response shape', 'ORDER_QUERY_SHAPE', {}],
  ])(
    'retains the blocker and never creates a replacement after %s',
    async (_label, diagnosticCode, details) => {
      const store = new Store();
      const blocked = order('Mblocked') as Row & { order_id: string };
      store.orders.set(blocked.order_id, blocked);
      store.pendingPurchases.set(account, { pending_order_id: blocked.order_id });
      const pay = payment();
      pay.query.mockRejectedValue(
        Object.assign(new Error('bounded query failure'), {
          diagnostic: { code: diagnosticCode, ...details },
        }),
      );
      const handler = createHandler({ store, payment: pay, now: () => clock });

      await expect(
        handler({ action: 'getOrder', orderId: blocked.order_id }, context),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'MEMBERSHIP_UNAVAILABLE' },
      });
      const retry = handler(
        {
          action: 'createOrder',
          requestId: diagnosticCode.startsWith('ORDER_PLATFORM_ERROR[')
            ? 'replacement-platform-error'
            : `replacement-${diagnosticCode}`,
          loginCode: 'one',
        },
        context,
      );
      await expect(retry).resolves.toMatchObject({
        ok: true,
        data: { order: { orderId: blocked.order_id, status: 'PENDING' } },
      });
      expect(store.orders.get(blocked.order_id)).toEqual(blocked);
      expect(store.pendingPurchases.get(account)).toEqual({
        pending_order_id: blocked.order_id,
      });
      expect([...store.orders.values()]).toHaveLength(1);
      expect(pay.createPayment).not.toHaveBeenCalled();
    },
  );

  it('retries failed goods acknowledgement after committing membership, even with new purchases off', async () => {
    const store = new Store();
    store.orders.set('Morder0001', order());
    const pay = payment();
    pay.available = false;
    const secret = 'secret errmsg token-private openid-private order-private';
    pay.provideGoods.mockRejectedValueOnce(
      Object.assign(new Error(secret), {
        diagnostic: { code: 'ORDER_PLATFORM_ERROR', platformCode: 123456 },
      }),
    );
    const warn = vi.spyOn(require('node:console'), 'warn').mockImplementation(() => undefined);
    try {
      expect(await reconcilePendingOrders(store, pay, () => clock)).toBe(1);
      expect(store.orders.get('Morder0001')?.status).toBe('PAID');
      expect(store.entitlements.get(account)?.renewal_payments).toHaveLength(1);
      expect(pay.provideGoods).not.toHaveBeenCalled();
      expect(await reconcilePendingOrders(store, pay, () => new Date('2026-09-06T00:01:00Z'))).toBe(
        1,
      );
      expect(store.orders.get('Morder0001')).toMatchObject({
        status: 'PAID',
        next_check_at: '2026-09-06T00:11:00.000Z',
      });
      expect(store.orders.get('Morder0001')).not.toHaveProperty('provided_at');
      expect(store.entitlements.get(account)?.renewal_payments).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith('membership.delivery.failed', {
        code: 'MEMBERSHIP_UNAVAILABLE',
        diagnostic: { code: 'ORDER_PLATFORM_ERROR', platformCode: 123456 },
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
      expect(await reconcilePendingOrders(store, pay, () => new Date('2026-09-06T00:11:00Z'))).toBe(
        1,
      );
      expect(pay.provideGoods).toHaveBeenCalledTimes(2);
      expect(store.entitlements.get(account)?.renewal_payments).toHaveLength(1);
      expect(store.orders.get('Morder0001')?.provided_at).toBe('2026-09-06T00:11:00.000Z');
    } finally {
      warn.mockRestore();
    }
  });

  it('waits for a delivery callback grace window, then provides goods once and never repeats it', async () => {
    const store = new Store();
    store.orders.set('Morder0001', order());
    const pay = payment();
    let current = new Date('2026-09-06T00:00:00Z');
    const handler = createHandler({ store, payment: pay, now: () => current });

    await settleOrder(store, pay, proof(), context, current);
    current = new Date('2026-09-06T00:00:30Z');
    await expect(
      handler({ action: 'getOrder', orderId: 'Morder0001' }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { membership: { isMember: true } },
    });
    expect(pay.provideGoods).not.toHaveBeenCalled();
    expect(store.entitlements.get(account)?.renewal_payments).toHaveLength(1);

    current = new Date('2026-09-06T00:01:00Z');
    await handler({ action: 'getOrder', orderId: 'Morder0001' }, context);
    expect(pay.provideGoods).toHaveBeenCalledTimes(1);
    expect(store.orders.get('Morder0001')?.provided_at).toBe(current.toISOString());

    current = new Date('2026-09-06T00:12:00Z');
    await handler({ action: 'getOrder', orderId: 'Morder0001' }, context);
    expect(pay.provideGoods).toHaveBeenCalledTimes(1);
    expect(store.entitlements.get(account)?.renewal_payments).toHaveLength(1);
  });

  it('records a later platform delivery acknowledgement for an already paid order without providing goods', async () => {
    const store = new Store();
    store.orders.set('Morder0001', order());
    const pay = payment();
    let current = new Date('2026-09-06T00:00:00Z');
    await settleOrder(store, pay, proof(), context, current);
    expect(store.orders.get('Morder0001')?.platform_status).toBe(2);
    pay.query.mockResolvedValue({ ...proof(), platform_status: 4 });
    const handler = createHandler({ store, payment: pay, now: () => current });

    current = new Date('2026-09-06T00:02:00Z');
    await handler({ action: 'getOrder', orderId: 'Morder0001' }, context);
    expect(store.orders.get('Morder0001')).toMatchObject({
      platform_status: 4,
      provided_at: current.toISOString(),
    });
    expect(pay.provideGoods).not.toHaveBeenCalled();

    current = new Date('2026-09-06T01:00:00Z');
    await handler({ action: 'getOrder', orderId: 'Morder0001' }, context);
    expect(pay.provideGoods).not.toHaveBeenCalled();
  });

  it('treats a processed delivery callback as a grace window, not a permanent acknowledgement', async () => {
    const createSettledDelivery = async (platformStatus: number) => {
      const store = new Store();
      store.orders.set('Morder0001', order());
      const pay = payment();
      const settledAt = new Date('2026-09-06T00:00:00Z');
      await settleOrder(store, pay, proof(), context, settledAt);
      await store.transaction(async (tx) => {
        const latest = await tx.getOrder('Morder0001');
        await tx.saveOrder('Morder0001', {
          ...latest,
          delivery_notice_processed_at: settledAt.toISOString(),
        });
      });
      pay.query.mockResolvedValue({ ...proof(), platform_status: platformStatus });
      return { store, pay, now: new Date('2026-09-06T00:01:01Z') };
    };

    const platformAcknowledged = await createSettledDelivery(4);
    await createHandler({
      store: platformAcknowledged.store,
      payment: platformAcknowledged.pay,
      now: () => platformAcknowledged.now,
    })({ action: 'getOrder', orderId: 'Morder0001' }, context);
    expect(platformAcknowledged.pay.provideGoods).not.toHaveBeenCalled();

    const callbackAckLost = await createSettledDelivery(2);
    await createHandler({
      store: callbackAckLost.store,
      payment: callbackAckLost.pay,
      now: () => callbackAckLost.now,
    })({ action: 'getOrder', orderId: 'Morder0001' }, context);
    expect(callbackAckLost.pay.provideGoods).toHaveBeenCalledTimes(1);
  });

  it('replays surviving renewals after a full refund and never restores a refunded order', async () => {
    const store = new Store();
    const pay = payment();
    for (const id of ['Morder0001', 'Morder0002']) store.orders.set(id, order(id));
    await settleOrder(store, pay, proof(), context);
    await settleOrder(store, pay, proof('Morder0002', 'SUCCESS', '2026-10-06T00:00:00Z'), context);
    await settleRefund(store, pay, proof('Morder0001', 'REFUNDED'), context);
    expect(store.entitlements.get(account)?.expires_at).toBe('2027-04-06T00:00:00.000Z');
    await settleRefund(store, pay, proof('Morder0001', 'REFUNDED'), context);
    await settleOrder(store, pay, proof(), context);
    expect(store.orders.get('Morder0001')?.status).toBe('REFUNDED');
    expect(store.entitlements.get(account)?.expires_at).toBe('2027-04-06T00:00:00.000Z');
    await settleRefund(
      store,
      pay,
      proof('Morder0002', 'REFUNDED', '2026-10-06T00:00:00Z'),
      context,
    );
    expect(store.entitlements.get(account)?.expires_at).toBeNull();
    expect(store.locks.size).toBe(2);
  });

  it('records a refund arriving before settlement without granting membership', async () => {
    const store = new Store();
    store.orders.set('Morder0001', order());
    const pay = payment();
    await settleRefund(store, pay, proof('Morder0001', 'REFUNDED'), context);
    await settleOrder(store, pay, proof(), context);
    expect(store.entitlements.size).toBe(0);
    expect(store.orders.get('Morder0001')?.status).toBe('REFUNDED');
  });

  it('rolls back refund history and order status when the transaction lock write fails', async () => {
    const store = new Store();
    store.orders.set('Morder0001', order());
    const pay = payment();
    await settleOrder(store, pay, proof(), context);
    const before = structuredClone(store.entitlements.get(account));
    vi.spyOn(store, 'saveTransactionLock').mockRejectedValueOnce(new Error('database write'));
    await expect(
      settleRefund(store, pay, proof('Morder0001', 'REFUNDED'), context),
    ).rejects.toThrow();
    expect(store.orders.get('Morder0001')?.status).toBe('PAID');
    expect(store.entitlements.get(account)).toEqual(before);
  });

  it.each([
    ['wx-Morder0001', clock.getTime() / 1000, 200],
    ['other-platform-order', clock.getTime() / 1000, 400],
    ['wx-Morder0001', clock.getTime() / 1000 + 1, 400],
  ])('binds WeChat delivery to platform order %s and paid time %s', async (id, paid, status) => {
    const store = new Store();
    store.orders.set('Morder0001', order());
    const pay = {
      ...payment(),
      validateDelivery: vi.fn().mockReturnValue(true),
      readNotification: vi.fn().mockReturnValue({
        kind: 'notification',
        format: 'xml',
        message: {
          MsgType: 'event',
          Event: 'xpay_goods_deliver_notify',
          OutTradeNo: 'Morder0001',
          OpenId: context.OPENID,
          WeChatPayInfo: { MchOrderNo: id, PaidTime: paid },
        },
      }),
    };
    const entry = createEntry({ store, payment: pay, getContext: () => context, handler: vi.fn() });
    expect((await entry({ httpMethod: 'POST' })).statusCode).toBe(status);
    if (status === 200) {
      const entitlement = structuredClone(store.entitlements.get(account));
      expect(store.orders.get('Morder0001')?.status).toBe('PAID');
      expect(store.orders.get('Morder0001')?.delivery_notice_processed_at).toEqual(
        expect.any(String),
      );
      expect(pay.provideGoods).not.toHaveBeenCalled();
      expect(store.locks.size).toBe(1);
      expect((await entry({ httpMethod: 'POST' })).statusCode).toBe(200);
      expect(store.entitlements.get(account)).toEqual(entitlement);
      expect(store.locks.size).toBe(1);
    } else {
      expect(store.orders.get('Morder0001')?.status).toBe('PENDING');
      expect(store.entitlements.size).toBe(0);
      expect(store.locks.size).toBe(0);
    }
  });

  it('requires authoritative query before acknowledging an Apple delivery with no WeChatPayInfo', async () => {
    const store = new Store();
    store.orders.set('Morder0001', order());
    const pay = {
      ...payment(),
      validateDelivery: vi.fn().mockReturnValue(true),
      readNotification: vi.fn().mockReturnValue({
        kind: 'notification',
        format: 'xml',
        message: {
          MsgType: 'event',
          Event: 'xpay_goods_deliver_notify',
          OutTradeNo: 'Morder0001',
          OpenId: context.OPENID,
        },
      }),
    };
    const entry = createEntry({ store, payment: pay, getContext: () => context, handler: vi.fn() });
    pay.query.mockRejectedValueOnce(new Error('query offline'));
    expect((await entry({ httpMethod: 'POST' })).statusCode).toBe(500);
    expect(store.entitlements.size).toBe(0);
    expect(await entry({ httpMethod: 'POST' })).toMatchObject({
      statusCode: 200,
      body: expect.stringContaining('<ErrCode>0</ErrCode>'),
    });
    expect(store.orders.get('Morder0001')?.status).toBe('PAID');
    expect(pay.provideGoods).not.toHaveBeenCalled();
  });
});

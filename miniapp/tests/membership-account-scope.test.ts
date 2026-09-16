import { describe, expect, it, vi } from 'vitest';
import { MembershipClient } from '../miniprogram/repositories/membership-client';
import { MembershipService } from '../miniprogram/packages/auxiliary/services/membership-service';
import type { StorageAdapter } from '../miniprogram/types/domain';

type CloudRequest = {
  action: string;
  orderId?: string;
  expectedPaymentAccountScope?: string;
};
type SessionService = MembershipService & { invalidateSession(): void };
const scopeA = 'a'.repeat(64);
const scopeB = 'b'.repeat(64);
const status = {
  isMember: false,
  startsAt: null,
  expiresAt: null,
  freeUsed: 0,
  freeRemaining: 3,
  freeLimit: 3,
  freeDate: '2026-09-12',
  serverTime: '2026-09-12T00:00:00.000Z',
  paymentAvailable: true,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const order = (id: string, stage: string) => ({
  orderId: id,
  status: stage,
  amount: 2800,
  paidAt: stage === 'PAID' ? '2026-09-12T00:00:00.000Z' : null,
});
const payment = (orderId: string) => ({
  mode: 'short_series_goods',
  signData: JSON.stringify({
    env: 0,
    currencyType: 'CNY',
    buyQuantity: 1,
    goodsPrice: 2800,
    outTradeNo: orderId,
    attach: orderId,
    offerId: '1450639573',
    productId: 'warehouse_member_6m',
  }),
  paySig: 'c'.repeat(64),
  signature: 'd'.repeat(64),
});
const response = (data: unknown) => ({ result: { ok: true, data } });
const memory = (): StorageAdapter & { values: Map<string, unknown> } => {
  const values = new Map<string, unknown>([['grain-practice:auth-preference', 'account']]);
  return {
    values,
    get: <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: <T>(key: string, value: T) => values.set(key, value),
    remove: (key: string) => values.delete(key),
  };
};
const transactionKey = (scope: string) =>
  `membership.payment-transaction.v2.${encodeURIComponent(scope)}.default`;
const createService = (
  transport: (request: CloudRequest) => unknown,
  db = memory(),
  bridge = vi.fn().mockResolvedValue(undefined),
) => {
  const callFunction = vi.fn((options: { data: CloudRequest }) => transport(options.data));
  const client = new MembershipClient(callFunction as never, () =>
    Promise.resolve('test-login-code'),
  );
  // Deliberately omit scopeProvider: account scope must come from getPaymentContext.
  const service = new MembershipService(client, db, bridge, () => undefined) as SessionService;
  return { service, db, bridge, callFunction };
};
const assertScoped = (request: CloudRequest, scope: string) => {
  if (request.action !== 'getPaymentContext')
    expect(request.expectedPaymentAccountScope).toBe(scope);
};

describe('membership account session scope', () => {
  it('drops a late A create after B becomes active without starting a bridge or touching B storage', async () => {
    let current = scopeA;
    const create = deferred<unknown>();
    const { service, db, bridge, callFunction } = createService((request) => {
      if (request.action === 'getPaymentContext') return response({ accountScope: current });
      assertScoped(request, scopeA);
      if (request.action === 'createOrder') return create.promise;
      return response({ order: order('unexpected', 'PENDING'), membership: status });
    });
    db.set(transactionKey(scopeB), {
      version: 2,
      accountScope: scopeB,
      sessionScope: 'default',
      requestId: 'b-request',
      orderId: 'account-b-order',
      stage: 'PREPARED',
    });

    const purchase = service.purchase('p-late-create');
    void purchase.catch(() => undefined);
    await vi.waitFor(() =>
      expect(callFunction).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'createOrder' }) }),
      ),
    );
    current = scopeB;
    create.resolve(
      response({
        order: order('account-a-order', 'PREPARED'),
        canStartPayment: true,
        bridgeAttempt: 'a'.repeat(43),
        payment: payment('account-a-order'),
      }),
    );
    await expect(purchase).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(bridge).not.toHaveBeenCalled();
    expect(callFunction.mock.calls.map(([call]) => call.data.action)).not.toContain(
      'markPaymentStarting',
    );
    expect(db.get(transactionKey(scopeB))).toMatchObject({
      orderId: 'account-b-order',
      stage: 'PREPARED',
    });
    expect(db.values.get('grain-practice:auth-preference')).toBe('account');
  });

  it.each([false, true])(
    'does not let a late A identity handshake overwrite B (page hidden: %s)',
    async (hidden) => {
      const firstContext = deferred<unknown>();
      let contexts = 0;
      const { service, callFunction } = createService((request) => {
        if (request.action === 'getPaymentContext') {
          contexts += 1;
          return contexts === 1 ? firstContext.promise : response({ accountScope: scopeB });
        }
        assertScoped(request, scopeB);
        return response({ membership: { ...status, freeRemaining: 2 } });
      });
      const oldRecovery = service.recoverOrders('p-old-recovery');
      void oldRecovery.catch(() => undefined);
      await vi.waitFor(() => expect(contexts).toBe(1));
      if (hidden) service.invalidateSession();
      await expect(service.recoverOrders('p-b-recovery')).resolves.toMatchObject({
        freeRemaining: 2,
      });
      firstContext.resolve(response({ accountScope: scopeA }));
      await expect(oldRecovery).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
      const recovered = callFunction.mock.calls.filter(
        ([call]) => call.data.action === 'recoverOrders',
      );
      expect(recovered).toHaveLength(1);
      const recovery = recovered[0];
      if (!recovery) throw new Error('missing B recovery');
      expect(recovery[0].data.expectedPaymentAccountScope).toBe(scopeB);
    },
  );

  it('uses one native bridge for concurrent purchases in one real account scope', async () => {
    const { service, bridge, callFunction } = createService((request) => {
      if (request.action === 'getPaymentContext') return response({ accountScope: scopeA });
      assertScoped(request, scopeA);
      if (request.action === 'createOrder')
        return response({
          order: order('account-a-order', 'PREPARED'),
          canStartPayment: true,
          bridgeAttempt: 'a'.repeat(43),
          payment: payment('account-a-order'),
        });
      if (request.action === 'markPaymentStarting')
        return response({
          order: order('account-a-order', 'PAYMENT_STARTING'),
          bridgeLease: true,
          canStartPayment: true,
        });
      if (request.action === 'markPaymentUnknown')
        return response({ order: order('account-a-order', 'PAYMENT_UNKNOWN') });
      return response({ order: order('account-a-order', 'PENDING'), membership: status });
    });
    await Promise.all([service.purchase('p-one'), service.purchase('p-two')]);
    expect(bridge).toHaveBeenCalledOnce();
    expect(
      callFunction.mock.calls.filter(([call]) => call.data.action === 'createOrder'),
    ).toHaveLength(1);
  });

  it('invalidates an in-flight authorization before the native bridge can open', async () => {
    const start = deferred<unknown>();
    const { service, bridge, callFunction } = createService((request) => {
      if (request.action === 'getPaymentContext') return response({ accountScope: scopeA });
      assertScoped(request, scopeA);
      if (request.action === 'createOrder')
        return response({
          order: order('account-a-order', 'PREPARED'),
          canStartPayment: true,
          bridgeAttempt: 'a'.repeat(43),
          payment: payment('account-a-order'),
        });
      if (request.action === 'markPaymentStarting') return start.promise;
      return response({ order: order('account-a-order', 'PENDING'), membership: status });
    });
    const purchase = service.purchase('p-before-bridge');
    void purchase.catch(() => undefined);
    await vi.waitFor(() =>
      expect(callFunction.mock.calls.map(([call]) => call.data.action)).toContain(
        'markPaymentStarting',
      ),
    );
    service.invalidateSession();
    start.resolve(
      response({
        order: order('account-a-order', 'PAYMENT_STARTING'),
        bridgeLease: true,
        canStartPayment: true,
      }),
    );
    await expect(purchase).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(bridge).not.toHaveBeenCalled();
  });

  it('keeps bridge-return acknowledgement best-effort for captured A while invalidation blocks local writes', async () => {
    const returnFromBridge = deferred<void>();
    const { service, db, callFunction } = createService(
      (request) => {
        if (request.action === 'getPaymentContext') return response({ accountScope: scopeA });
        assertScoped(request, scopeA);
        if (request.action === 'createOrder')
          return response({
            order: order('account-a-order', 'PREPARED'),
            canStartPayment: true,
            bridgeAttempt: 'a'.repeat(43),
            payment: payment('account-a-order'),
          });
        if (request.action === 'markPaymentStarting')
          return response({
            order: order('account-a-order', 'PAYMENT_STARTING'),
            bridgeLease: true,
            canStartPayment: true,
          });
        if (request.action === 'markPaymentUnknown')
          return response({ order: order('account-a-order', 'PAYMENT_UNKNOWN') });
        return response({ order: order('account-a-order', 'PENDING'), membership: status });
      },
      undefined,
      vi.fn(() => returnFromBridge.promise),
    );
    const purchase = service.purchase('p-return');
    void purchase.catch(() => undefined);
    await vi.waitFor(() =>
      expect(callFunction.mock.calls.map(([call]) => call.data.action)).toContain(
        'markPaymentStarting',
      ),
    );
    service.invalidateSession();
    returnFromBridge.resolve();
    await expect(purchase).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(callFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'markPaymentUnknown',
          orderId: 'account-a-order',
          expectedPaymentAccountScope: scopeA,
        }),
      }),
    );
    expect(db.get(transactionKey(scopeA))).toMatchObject({ stage: 'PAYMENT_STARTING' });
    expect(db.values.get('grain-practice:auth-preference')).toBe('account');
  });

  it('restores only the new instance transaction for its account and keeps PREPARED resumable', async () => {
    const db = memory();
    db.set(transactionKey(scopeA), {
      version: 2,
      accountScope: scopeA,
      sessionScope: 'default',
      requestId: 'a-request',
      orderId: 'a-prepared',
      stage: 'PREPARED',
    });
    db.set(transactionKey(scopeB), {
      version: 2,
      accountScope: scopeB,
      sessionScope: 'default',
      requestId: 'b-request',
      orderId: 'b-prepared',
      stage: 'PREPARED',
    });
    const { service, callFunction } = createService((request) => {
      if (request.action === 'getPaymentContext') return response({ accountScope: scopeA });
      assertScoped(request, scopeA);
      if (request.action === 'recoverOrders')
        return response({ membership: status, pendingOrder: order('a-prepared', 'PREPARED') });
      return response({ order: order('a-prepared', 'PENDING'), membership: status });
    }, db);
    await service.recoverOrders('p-recover-a');
    expect(service.getPendingOrderId()).toBe('a-prepared');
    expect(service.getTransactionStage()).toBe('PREPARED');
    expect(db.get(transactionKey(scopeB))).toMatchObject({
      orderId: 'b-prepared',
      stage: 'PREPARED',
    });
    expect(callFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'recoverOrders',
          expectedPaymentAccountScope: scopeA,
        }),
      }),
    );
  });
});

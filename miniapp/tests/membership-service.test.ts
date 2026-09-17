import { describe, expect, it, vi } from 'vitest';
import { MembershipService } from '../miniprogram/packages/auxiliary/services/membership-service';
import type { MembershipStatus } from '../miniprogram/types/membership';
const free: MembershipStatus = {
  isMember: false,
  startsAt: null,
  expiresAt: null,
  freeUsed: 0,
  freeRemaining: 3,
  freeLimit: 3,
  freeDate: '2026-09-05',
  serverTime: '2026-09-05T00:00:00Z',
  paymentAvailable: true,
};
const order = (
  status:
    | 'PREPARED'
    | 'PAYMENT_STARTING'
    | 'PAYMENT_UNKNOWN'
    | 'PENDING'
    | 'PAID'
    | 'CLOSED'
    | 'FAILED'
    | 'REFUNDED' = 'PREPARED',
  id = 'o1',
) => ({ orderId: id, status, amount: 2800, paidAt: status === 'PAID' ? 'now' : null });
const payment = {
  mode: 'short_series_goods' as const,
  signData: '{}',
  paySig: 's',
  signature: 'u',
};
const testScope = () => ({ accountScope: 'test-account', sessionScope: 'test-session' });
const storage = () => {
  const map = new Map<string, unknown>();
  return {
    get: <T>(key: string) => (map.get(key) as T | undefined) ?? null,
    set: <T>(key: string, value: T) => map.set(key, value),
    remove: (key: string) => map.delete(key),
  };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
};
const gateway = (final: 'PENDING' | 'PAID' = 'PAID') => ({
  call: vi.fn((r: { action: string; orderId?: string }) =>
    r.action === 'createOrder'
      ? { order: order('PREPARED'), canStartPayment: true, payment, bridgeAttempt: 'a'.repeat(43) }
      : r.action === 'markPaymentStarting'
        ? { order: order('PAYMENT_STARTING'), bridgeLease: true, canStartPayment: true }
        : r.action === 'markPaymentUnknown'
          ? { order: order('PAYMENT_UNKNOWN') }
          : {
              order: order(final),
              membership:
                final === 'PAID'
                  ? { ...free, isMember: true, startsAt: 'now', expiresAt: 'later' }
                  : free,
            },
  ),
});

describe('MembershipService payment transaction', () => {
  it('uses server PREPARED authorization once and marks bridge phases in order', async () => {
    const client = gateway();
    const pay = vi.fn().mockResolvedValue(undefined);
    await expect(
      new MembershipService(
        client as never,
        storage(),
        pay,
        undefined,
        undefined,
        testScope,
      ).purchase(),
    ).resolves.toMatchObject({ confirmed: true });
    expect(pay).toHaveBeenCalledOnce();
    expect(pay).toHaveBeenCalledWith(payment, expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i));
    expect(client.call.mock.calls.map(([r]) => r.action)).toEqual([
      'createOrder',
      'markPaymentStarting',
      'markPaymentUnknown',
      'getOrder',
    ]);
  });
  it('continues a PREPARED restart with the original request id without a preliminary getOrder', async () => {
    const db = storage(),
      scope = () => ({ accountScope: 'a', sessionScope: 's' });
    db.set('membership.payment-transaction.v2.a.s', {
      version: 2,
      ...scope(),
      requestId: 'r1',
      orderId: 'o1',
      stage: 'PREPARED',
    });
    const client = gateway('PENDING');
    await new MembershipService(
      client as never,
      db,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      undefined,
      scope,
    ).purchase();
    expect(client.call).toHaveBeenNthCalledWith(
      1,
      { action: 'resumePayment', orderId: 'o1' },
      expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
      'a',
    );
  });
  it('does not re-open a cashier for PAYMENT_UNKNOWN or platform PENDING', async () => {
    const db = storage(),
      scope = () => ({ accountScope: 'a', sessionScope: 's' });
    db.set('membership.payment-transaction.v2.a.s', {
      version: 2,
      ...scope(),
      requestId: 'r1',
      orderId: 'o1',
      stage: 'PAYMENT_UNKNOWN',
    });
    const client = gateway('PENDING'),
      pay = vi.fn();
    await new MembershipService(client as never, db, pay, undefined, undefined, scope).purchase();
    expect(client.call).toHaveBeenCalledWith(
      { action: 'getOrder', orderId: 'o1' },
      expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
      'a',
    );
    expect(pay).not.toHaveBeenCalled();
  });
  it('does not reopen payment until the server releases the pending purchase', async () => {
    const db = storage(),
      scope = () => ({ accountScope: 'a', sessionScope: 's' });
    db.set('membership.payment-transaction.v2.a.s', {
      version: 2,
      ...scope(),
      requestId: 'r1',
      orderId: 'o1',
      stage: 'PENDING',
    });
    const client = {
      call: vi.fn((request: { action: string }) => {
        if (request.action === 'resumePayment')
          return {
            order: order('PENDING'),
            canStartPayment: true,
            payment,
            bridgeAttempt: 'a'.repeat(43),
          };
        if (request.action === 'markPaymentStarting')
          return { order: order('PAYMENT_STARTING'), bridgeLease: true };
        if (request.action === 'markPaymentUnknown') return { order: order('PAYMENT_UNKNOWN') };
        return { order: order('PENDING'), membership: free };
      }),
    };
    const pay = vi.fn().mockResolvedValue(undefined);
    await expect(
      new MembershipService(client as never, db, pay, undefined, undefined, scope).purchase(),
    ).resolves.toMatchObject({ order: { status: 'PENDING' } });
    expect(client.call.mock.calls.map(([request]) => request.action)).toEqual([
      'getOrder',
      'cancelPayment',
    ]);
    expect(pay).not.toHaveBeenCalled();
  });
  it.each(['PAID', 'CLOSED', 'FAILED', 'REFUNDED'] as const)(
    'reads membership rather than failing when resume returns %s',
    async (terminal) => {
      const db = storage(),
        scope = () => ({ accountScope: 'a', sessionScope: 's' });
      db.set('membership.payment-transaction.v2.a.s', {
        version: 2,
        ...scope(),
        requestId: 'r1',
        orderId: 'o1',
        stage: 'PENDING',
      });
      const membership =
        terminal === 'PAID'
          ? { ...free, isMember: true, startsAt: 'now', expiresAt: 'later' }
          : free;
      const client = {
        call: vi.fn((request: { action: string }) =>
          request.action === 'resumePayment'
            ? { order: order(terminal) }
            : { order: order(terminal), membership },
        ),
      };
      await expect(
        new MembershipService(client as never, db, vi.fn(), undefined, undefined, scope).purchase(),
      ).resolves.toMatchObject({ order: { status: terminal } });
      expect(client.call).toHaveBeenCalledWith(
        { action: 'getOrder', orderId: 'o1' },
        expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
        'a',
      );
    },
  );
  it('keeps another account transaction isolated from a late old response', async () => {
    const db = storage(),
      old = () => ({ accountScope: 'old', sessionScope: 's' }),
      next = () => ({ accountScope: 'next', sessionScope: 's' });
    db.set('membership.payment-transaction.v2.old.s', {
      version: 2,
      ...old(),
      requestId: 'old-r',
      orderId: 'old-o',
      stage: 'PAYMENT_UNKNOWN',
    });
    const client = gateway('PENDING');
    await new MembershipService(
      client as never,
      db,
      vi.fn(),
      undefined,
      undefined,
      next,
    ).purchase();
    expect(client.call).not.toHaveBeenCalledWith(
      { action: 'getOrder', orderId: 'old-o' },
      expect.any(String),
    );
  });
  it('keeps legacy pending as a recovery clue while refresh remains read-only', async () => {
    const db = storage();
    db.set('membership.pending-order.v1', { orderId: 'legacy', requestId: 'r' });
    const client = {
      call: vi.fn().mockResolvedValue({ order: order('PENDING', 'legacy'), membership: free }),
    };
    await new MembershipService(
      client as never,
      db,
      vi.fn(),
      undefined,
      undefined,
      testScope,
    ).recoverOrders();
    expect(client.call).toHaveBeenCalledWith(
      { action: 'recoverOrders' },
      undefined,
      'test-account',
    );
  });
  it('uses the CAS bridge lease so two instances never open two cashiers', async () => {
    let leases = 0;
    const client = {
      call: vi.fn((r: { action: string }) =>
        r.action === 'createOrder'
          ? {
              order: order('PREPARED'),
              canStartPayment: true,
              payment,
              bridgeAttempt: 'a'.repeat(43),
            }
          : r.action === 'markPaymentStarting'
            ? {
                order: order('PAYMENT_STARTING'),
                bridgeLease: ++leases === 1,
                canStartPayment: leases === 1,
              }
            : r.action === 'markPaymentUnknown'
              ? { order: order('PAYMENT_UNKNOWN') }
              : { order: order('PENDING'), membership: free },
      ),
    };
    const db = storage(),
      pay = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      new MembershipService(client as never, db, pay, undefined, undefined, testScope).purchase(),
      new MembershipService(client as never, db, pay, undefined, undefined, testScope).purchase(),
    ]);
    expect(pay).toHaveBeenCalledOnce();
  });
  it('drops a late create response after an account generation changes', async () => {
    let resolveCreate!: (value: unknown) => void;
    let current = 'old';
    const scope = () => ({ accountScope: current, sessionScope: 's' });
    const client = {
      call: vi.fn((r: { action: string }) =>
        r.action === 'createOrder'
          ? new Promise((resolve) => {
              resolveCreate = resolve;
            })
          : { order: order('PAYMENT_STARTING'), bridgeLease: true, canStartPayment: true },
      ),
    };
    const db = storage(),
      pay = vi.fn();
    const service = new MembershipService(client as never, db, pay, undefined, undefined, scope);
    const old = service.purchase();
    await vi.waitFor(() => expect(resolveCreate).toBeTypeOf('function'));
    current = 'new';
    resolveCreate({
      order: order('PREPARED'),
      canStartPayment: true,
      payment,
      bridgeAttempt: 'a'.repeat(43),
    });
    await expect(old).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(client.call).not.toHaveBeenCalledWith(
      { action: 'markPaymentStarting', orderId: 'o1' },
      expect.any(String),
    );
    expect(pay).not.toHaveBeenCalled();
    expect(db.get('membership.payment-transaction.v2.new.s')).toBeNull();
  });
  it('does not let a scope change during the native bridge mutate or query the new scope', async () => {
    let current = 'old';
    const scope = () => ({ accountScope: current, sessionScope: 's' });
    const bridge = deferred<void>();
    const client = gateway('PAID');
    const db = storage();
    const service = new MembershipService(
      client as never,
      db,
      vi.fn(() => bridge.promise),
      undefined,
      undefined,
      scope,
    );
    const purchase = service.purchase();
    await vi.waitFor(() =>
      expect(client.call).toHaveBeenCalledWith(
        {
          action: 'markPaymentStarting',
          orderId: 'o1',
          bridgeAttempt: 'a'.repeat(43),
          payment,
        },
        expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
        'old',
      ),
    );
    current = 'new';
    bridge.resolve();
    await expect(purchase).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(client.call).not.toHaveBeenCalledWith(
      { action: 'markPaymentUnknown', orderId: 'o1' },
      expect.any(String),
    );
    expect(client.call).not.toHaveBeenCalledWith(
      { action: 'getOrder', orderId: 'o1' },
      expect.any(String),
    );
    expect(db.get('membership.payment-transaction.v2.old.s')).toMatchObject({
      stage: 'PAYMENT_STARTING',
    });
    expect(db.get('membership.payment-transaction.v2.new.s')).toBeNull();
    expect(service.getLastPurchaseResult()).toBeNull();
  });
  it('drops a late authoritative query after a scope change', async () => {
    let current = 'old';
    const scope = () => ({ accountScope: current, sessionScope: 's' });
    const query = deferred<unknown>();
    const db = storage();
    db.set('membership.payment-transaction.v2.old.s', {
      version: 2,
      accountScope: 'old',
      sessionScope: 's',
      requestId: 'r1',
      orderId: 'o1',
      stage: 'PAYMENT_UNKNOWN',
    });
    const service = new MembershipService(
      { call: vi.fn(() => query.promise) } as never,
      db,
      vi.fn(),
      undefined,
      undefined,
      scope,
    );
    const result = service.queryOrder('o1');
    current = 'new';
    query.resolve({
      order: order('PAID'),
      membership: { ...free, isMember: true, startsAt: 'now', expiresAt: 'later' },
    });
    await expect(result).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(service.getLastPurchaseResult()).toBeNull();
    expect(db.get('membership.payment-transaction.v2.old.s')).toMatchObject({
      stage: 'PAYMENT_UNKNOWN',
    });
  });
  it('keeps purchase single-flight scoped when the account changes mid-create', async () => {
    let current = 'old';
    const scope = () => ({ accountScope: current, sessionScope: 's' });
    const firstCreate = deferred<unknown>();
    let createCount = 0;
    const client = {
      call: vi.fn((request: { action: string }) => {
        if (request.action === 'createOrder') {
          createCount += 1;
          if (createCount === 1) return firstCreate.promise;
          return { order: order('PENDING', 'new-order') };
        }
        return { order: order('PENDING', 'new-order'), membership: free };
      }),
    };
    const service = new MembershipService(
      client as never,
      storage(),
      vi.fn(),
      undefined,
      undefined,
      scope,
    );
    const oldPurchase = service.purchase();
    await vi.waitFor(() => expect(createCount).toBe(1));
    current = 'new';
    const newPurchase = service.purchase();
    expect(newPurchase).not.toBe(oldPurchase);
    await expect(newPurchase).resolves.toMatchObject({ order: { orderId: 'new-order' } });
    firstCreate.resolve({
      order: order('PREPARED'),
      canStartPayment: true,
      payment,
      bridgeAttempt: 'a'.repeat(43),
    });
    await expect(oldPurchase).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(createCount).toBe(2);
  });
  it('keeps cancellation durable until the server releases the purchase', async () => {
    const cancelPayment = deferred<unknown>();
    const db = storage();
    const client = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'createOrder'
          ? {
              order: order('PREPARED'),
              canStartPayment: true,
              payment,
              bridgeAttempt: 'a'.repeat(43),
            }
          : request.action === 'markPaymentStarting'
            ? { order: order('PAYMENT_STARTING'), bridgeLease: true, canStartPayment: true }
            : request.action === 'cancelPayment'
              ? cancelPayment.promise
              : { order: order('PENDING'), membership: free },
      ),
    };
    const service = new MembershipService(
      client as never,
      db,
      vi.fn().mockRejectedValue({ errCode: -2, errMsg: 'requestVirtualPayment:fail cancel' }),
      undefined,
      undefined,
      testScope,
    );
    const purchase = service.purchase();
    await vi.waitFor(() =>
      expect(client.call).toHaveBeenCalledWith(
        { action: 'cancelPayment', orderId: 'o1' },
        expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
        'test-account',
      ),
    );
    expect(service.getTransactionStage()).toBe('PAYMENT_UNKNOWN');
    cancelPayment.resolve({
      order: { ...order('PAYMENT_UNKNOWN'), purchaseCancelled: true },
      membership: free,
    });
    await expect(purchase).resolves.toMatchObject({ paymentState: 'cancelled' });
    expect(service.getPendingOrderId()).toBeNull();
  });
  it('keeps PREPARED durable when the process loses mark-starting before the bridge call', async () => {
    const db = storage();
    const client = {
      call: vi.fn((request: { action: string }) => {
        if (request.action === 'createOrder')
          return {
            order: order('PREPARED'),
            canStartPayment: true,
            payment,
            bridgeAttempt: 'a'.repeat(43),
          };
        if (request.action === 'markPaymentStarting')
          return Promise.reject(new Error('process terminated before response'));
        return { order: order('PENDING'), membership: free };
      }),
    };
    const pay = vi.fn();
    await expect(
      new MembershipService(client as never, db, pay, undefined, undefined, testScope).purchase(),
    ).rejects.toThrow('process terminated before response');
    expect(pay).not.toHaveBeenCalled();
    expect(db.get('membership.payment-transaction.v2.test-account.test-session')).toMatchObject({
      requestId: expect.any(String),
      orderId: 'o1',
      stage: 'PREPARED',
    });

    const restartedClient = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'createOrder'
          ? { order: order('PAYMENT_STARTING') }
          : { order: order('PENDING'), membership: free },
      ),
    };
    await expect(
      new MembershipService(
        restartedClient as never,
        db,
        pay,
        undefined,
        undefined,
        testScope,
      ).purchase(),
    ).resolves.toMatchObject({ order: { status: 'PENDING' } });
    expect(restartedClient.call).toHaveBeenNthCalledWith(
      1,
      { action: 'resumePayment', orderId: 'o1' },
      expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
      'test-account',
    );
    expect(restartedClient.call).toHaveBeenNthCalledWith(
      2,
      { action: 'getOrder', orderId: 'o1' },
      expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
      'test-account',
    );
    expect(pay).not.toHaveBeenCalled();
  });
  it('recovers a lost bridge callback by querying the old order without creating a new one', async () => {
    const db = storage();
    const offlineClient = {
      call: vi.fn((request: { action: string }) => {
        if (request.action === 'createOrder')
          return {
            order: order('PREPARED'),
            canStartPayment: true,
            payment,
            bridgeAttempt: 'a'.repeat(43),
          };
        if (request.action === 'markPaymentStarting')
          return { order: order('PAYMENT_STARTING'), bridgeLease: true, canStartPayment: true };
        return Promise.reject(new Error('network unavailable'));
      }),
    };
    const pay = vi.fn().mockRejectedValue(new Error('requestVirtualPayment:timeout'));
    await expect(
      new MembershipService(
        offlineClient as never,
        db,
        pay,
        undefined,
        undefined,
        testScope,
      ).purchase(),
    ).rejects.toThrow();
    expect(pay).toHaveBeenCalledOnce();
    expect(db.get('membership.payment-transaction.v2.test-account.test-session')).toMatchObject({
      orderId: 'o1',
      stage: 'PAYMENT_UNKNOWN',
    });

    const onlineClient = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'recoverOrders'
          ? { ...free, isMember: true, startsAt: 'now', expiresAt: 'later' }
          : {
              order: order('PAID'),
              membership: { ...free, isMember: true, startsAt: 'now', expiresAt: 'later' },
            },
      ),
    };
    await expect(
      new MembershipService(
        onlineClient as never,
        db,
        pay,
        undefined,
        undefined,
        testScope,
      ).recoverOrders(),
    ).resolves.toMatchObject({ isMember: true });
    expect(onlineClient.call.mock.calls.map(([request]) => request.action)).toEqual([
      'recoverOrders',
      'getOrder',
    ]);
    expect(onlineClient.call).toHaveBeenNthCalledWith(
      2,
      { action: 'getOrder', orderId: 'o1' },
      undefined,
      'test-account',
    );
    expect(onlineClient.call).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'createOrder' }),
      expect.anything(),
      expect.anything(),
    );
    expect(pay).toHaveBeenCalledOnce();
  });
  it('does not apply a late mark-unknown response after the account changes', async () => {
    let current = 'old';
    const scope = () => ({ accountScope: current, sessionScope: 's' });
    const markUnknown = deferred<unknown>();
    const db = storage();
    const client = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'createOrder'
          ? {
              order: order('PREPARED'),
              canStartPayment: true,
              payment,
              bridgeAttempt: 'a'.repeat(43),
            }
          : request.action === 'markPaymentStarting'
            ? { order: order('PAYMENT_STARTING'), bridgeLease: true, canStartPayment: true }
            : request.action === 'markPaymentUnknown'
              ? markUnknown.promise
              : { order: order('PAID'), membership: free },
      ),
    };
    const service = new MembershipService(
      client as never,
      db,
      vi.fn().mockResolvedValue(undefined),
      undefined,
      undefined,
      scope,
    );
    const purchase = service.purchase();
    await vi.waitFor(() =>
      expect(client.call).toHaveBeenCalledWith(
        { action: 'markPaymentUnknown', orderId: 'o1' },
        expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
        'old',
      ),
    );
    expect(db.get('membership.payment-transaction.v2.old.s')).toMatchObject({
      stage: 'PAYMENT_UNKNOWN',
    });
    current = 'new';
    markUnknown.resolve({ order: order('PENDING') });
    await expect(purchase).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(client.call).not.toHaveBeenCalledWith(
      { action: 'getOrder', orderId: 'o1' },
      expect.any(String),
    );
    expect(db.get('membership.payment-transaction.v2.old.s')).toMatchObject({
      stage: 'PAYMENT_UNKNOWN',
    });
    expect(db.get('membership.payment-transaction.v2.new.s')).toBeNull();
  });
  it('never opens the bridge when local PREPARED is already attempted on the server', async () => {
    const db = storage();
    const scope = () => ({ accountScope: 'a', sessionScope: 's' });
    db.set('membership.payment-transaction.v2.a.s', {
      version: 2,
      ...scope(),
      requestId: 'r1',
      orderId: 'o1',
      stage: 'PREPARED',
    });
    const client = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'createOrder'
          ? { order: order('PAYMENT_STARTING') }
          : { order: order('PENDING'), membership: free },
      ),
    };
    const pay = vi.fn();
    await new MembershipService(client as never, db, pay, undefined, undefined, scope).purchase();
    expect(pay).not.toHaveBeenCalled();
    expect(client.call).toHaveBeenCalledWith(
      { action: 'getOrder', orderId: 'o1' },
      expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
      'a',
    );
  });
});

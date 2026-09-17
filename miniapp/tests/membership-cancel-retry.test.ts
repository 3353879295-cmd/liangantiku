import { describe, expect, it, vi } from 'vitest';
import { MembershipService } from '../miniprogram/packages/auxiliary/services/membership-service';
import { MembershipClient } from '../miniprogram/repositories/membership-client';
import type { MembershipOrderStatus } from '../miniprogram/types/membership';

const free = {
  isMember: false,
  startsAt: null,
  expiresAt: null,
  freeUsed: 0,
  freeRemaining: 3,
  freeLimit: 3,
  freeDate: '2026-09-16',
  serverTime: '2026-09-16T00:00:00.000Z',
  paymentAvailable: true,
};
const scope = () => ({ accountScope: 'account', sessionScope: 'session' });
const key = 'membership.payment-transaction.v2.account.session';
const payment = { mode: 'short_series_goods', signData: '{}', paySig: 's', signature: 'u' };
const cancellation = { errCode: -2, errMsg: 'requestVirtualPayment:fail cancel' };
const order = (id: string, status: MembershipOrderStatus, purchaseCancelled = false) => ({
  orderId: id,
  status,
  amount: 2800,
  paidAt: status === 'PAID' ? free.serverTime : null,
  ...(purchaseCancelled ? { purchaseCancelled } : {}),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const setup = () => {
  const values = new Map<string, unknown>();
  const db = {
    get: <T>(key: string) => (values.get(key) as T) ?? null,
    set: <T>(key: string, value: T) => values.set(key, value),
    remove: (key: string) => values.delete(key),
  };
  let nextId = 0;
  const call = vi.fn(
    (request: { action: string; orderId?: string; requestId?: string }): Promise<unknown> => {
      const id = request.orderId ?? `order-${++nextId}`;
      if (request.action === 'createOrder')
        return Promise.resolve({
          order: order(id, 'PREPARED'),
          payment,
          canStartPayment: true,
          bridgeAttempt: 'a'.repeat(43),
        });
      if (request.action === 'markPaymentStarting')
        return Promise.resolve({
          order: order(id, 'PAYMENT_STARTING'),
          bridgeLease: true,
          canStartPayment: true,
        });
      return Promise.resolve({
        order: order(id, 'PENDING', request.action === 'cancelPayment'),
        membership: free,
      });
    },
  );
  const pay = vi.fn().mockRejectedValue(cancellation);
  const service = new MembershipService({ call } as never, db, pay, undefined, undefined, scope);
  const save = (stage: MembershipOrderStatus, cancelRequested = false) =>
    db.set(key, {
      version: 2,
      ...scope(),
      requestId: 'old-request',
      orderId: 'old-order',
      stage,
      ...(cancelRequested ? { cancelRequested } : {}),
    });
  return { db, call, pay, service, save };
};

describe('cancelled membership purchase retry', () => {
  it('cancels without waiting for a platform close and opens a fresh order on the next tap', async () => {
    const { call, pay, service, db } = setup();
    const first = await service.purchase();
    expect(first).toMatchObject({ confirmed: false, paymentState: 'cancelled' });
    expect(db.get(key)).toBeNull();
    expect(service.getPendingOrderId()).toBeNull();
    expect(call.mock.calls.map(([r]) => r.action)).toEqual([
      'createOrder',
      'markPaymentStarting',
      'cancelPayment',
    ]);
    const second = await service.purchase();
    expect(second.order.orderId).not.toBe(first.order.orderId);
    expect(pay).toHaveBeenCalledTimes(2);
    const creates = call.mock.calls.filter(([r]) => r.action === 'createOrder');
    expect(creates[0]?.[0].requestId).not.toBe(creates[1]?.[0].requestId);
  });

  it.each(['PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING'] as const)(
    'checks a recovered %s order and retries with a new order in the same tap',
    async (stage) => {
      const { service, save, call, pay } = setup();
      save(stage);
      await service.purchase();
      expect(call.mock.calls.map(([r]) => r.action)).toEqual([
        'getOrder',
        'cancelPayment',
        'createOrder',
        'markPaymentStarting',
        'cancelPayment',
      ]);
      expect(pay).toHaveBeenCalledOnce();
    },
  );

  it('keeps a failed query retryable without opening another cashier', async () => {
    const { service, save, call, pay, db } = setup();
    save('PAYMENT_UNKNOWN');
    call.mockRejectedValueOnce(new Error('offline'));
    await expect(service.purchase()).rejects.toThrow('offline');
    expect(pay).not.toHaveBeenCalled();
    expect(db.get(key)).toMatchObject({ orderId: 'old-order' });
    await service.purchase();
    expect(pay).toHaveBeenCalledOnce();
  });

  it('uses an already paid result instead of charging again', async () => {
    const { service, save, call, pay } = setup();
    save('PAYMENT_UNKNOWN');
    call.mockResolvedValueOnce({
      order: order('old-order', 'PAID'),
      membership: { ...free, isMember: true },
    });
    await expect(service.purchase()).resolves.toMatchObject({ confirmed: true });
    expect(call).toHaveBeenCalledOnce();
    expect(pay).not.toHaveBeenCalled();
  });

  it('shows payment success when the server has settled before the cancel report', async () => {
    const { service, call, db } = setup();
    const normalCall = call.getMockImplementation()!;
    call.mockImplementation((r) =>
      r.action === 'cancelPayment'
        ? Promise.resolve({
            order: order(r.orderId!, 'PAID'),
            membership: { ...free, isMember: true },
          })
        : normalCall(r),
    );
    await expect(service.purchase()).resolves.toMatchObject({
      confirmed: true,
      paymentState: 'succeeded',
    });
    expect(db.get(key)).toBeNull();
  });

  it('retains cancellation through a failed report and recovers it without opening payment', async () => {
    const { service, call, db, pay } = setup();
    const normalCall = call.getMockImplementation()!;
    call.mockImplementation((r) =>
      r.action === 'cancelPayment' ? Promise.reject(new Error('offline')) : normalCall(r),
    );
    await expect(service.purchase()).rejects.toThrow('offline');
    expect(db.get(key)).toMatchObject({ cancelRequested: true, stage: 'PAYMENT_UNKNOWN' });
    call.mockImplementation(normalCall);
    call.mockClear();
    const restored = new MembershipService({ call } as never, db, pay, undefined, undefined, scope);
    await restored.recoverOrders();
    expect(call.mock.calls.map(([r]) => r.action)).toEqual(['cancelPayment']);
    expect(restored.getPendingOrderId()).toBeNull();
    expect(pay).toHaveBeenCalledOnce();
  });

  it('reports a cancel callback after the cashier hides the page and recovers on reentry', async () => {
    const { service, call, db, pay } = setup();
    const native = deferred<void>();
    pay.mockReturnValueOnce(native.promise);
    const pending = service.purchase();
    const rejection = expect(pending).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    await vi.waitFor(() => expect(pay).toHaveBeenCalledOnce());
    service.invalidateSession();
    native.reject(cancellation);
    await rejection;
    expect(call.mock.calls.some(([r]) => r.action === 'cancelPayment')).toBe(true);
    expect(db.get(key)).toMatchObject({ cancelRequested: true });
    await service.recoverOrders();
    expect(service.getPendingOrderId()).toBeNull();
    await service.purchase();
    expect(pay).toHaveBeenCalledTimes(2);
  });

  it('clears a server-cancelled cache on relaunch without querying or paying', async () => {
    const { service, save, call, db, pay } = setup();
    save('PAYMENT_UNKNOWN');
    call.mockResolvedValueOnce({ membership: free, cancelledOrderId: 'old-order' });
    await service.recoverOrders();
    expect(db.get(key)).toBeNull();
    expect(service.getPaymentState()).toBe('cancelled');
    expect(call).toHaveBeenCalledOnce();
    expect(pay).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer purchase with a late cancellation callback', async () => {
    const { service, save, db, pay } = setup();
    const native = deferred<void>();
    pay.mockReturnValueOnce(native.promise);
    const pending = service.purchase();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    await vi.waitFor(() => expect(pay).toHaveBeenCalledOnce());
    service.invalidateSession();
    save('PREPARED');
    const replacement = db.get(key);
    native.reject(cancellation);
    await rejected;
    expect(db.get(key)).toEqual(replacement);
  });
});

describe('cancelled purchase response validation', () => {
  it('binds cancellation to the requested account and order', async () => {
    const transport = vi.fn().mockResolvedValue({
      result: { ok: true, data: { order: order('old-order', 'PENDING', true), membership: free } },
    });
    const client = new MembershipClient(transport);
    await expect(
      client.call({ action: 'cancelPayment', orderId: 'old-order' }, undefined, 'a'.repeat(64)),
    ).resolves.toMatchObject({ order: { purchaseCancelled: true } });
    expect(transport).toHaveBeenCalledWith({
      name: 'membership',
      data: {
        action: 'cancelPayment',
        orderId: 'old-order',
        expectedPaymentAccountScope: 'a'.repeat(64),
      },
    });
    await expect(
      client.call({ action: 'cancelPayment', orderId: 'another-order' }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
  });

  it.each(['another-order', 123, 'bad', ''])(
    'rejects a cancellation recovery hint not bound to the local order: %s',
    async (cancelledOrderId) => {
      const client = new MembershipClient(
        vi.fn().mockResolvedValue({
          result: { ok: true, data: { membership: free, cancelledOrderId } },
        }),
      );
      await expect(
        client.call({ action: 'recoverOrders', localOrderId: 'old-order' }),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    },
  );
});

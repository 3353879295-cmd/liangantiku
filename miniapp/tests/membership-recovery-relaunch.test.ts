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
  freeDate: '2026-09-15',
  serverTime: '2026-09-15T00:00:00.000Z',
  paymentAvailable: true,
};
const order = (
  status: 'PREPARED' | 'PAID' | 'CLOSED' | 'PAYMENT_UNKNOWN',
  orderId = 'old-order',
) => ({
  orderId,
  status,
  amount: 2800,
  paidAt: status === 'PAID' ? '2026-09-15T00:00:00.000Z' : null,
});
const key = (accountScope: string, sessionScope = 'session') =>
  `membership.payment-transaction.v2.${accountScope}.${sessionScope}`;
const storage = () => {
  const values = new Map<string, unknown>();
  return {
    get: <T>(name: string) => (values.get(name) as T | undefined) ?? null,
    set: <T>(name: string, value: T) => values.set(name, value),
    remove: (name: string) => values.delete(name),
  };
};
const saveOldTransaction = (db: ReturnType<typeof storage>, accountScope = 'account') => {
  db.set(key(accountScope), {
    version: 2,
    accountScope,
    sessionScope: 'session',
    requestId: 'old-request',
    orderId: 'old-order',
    stage: 'PAYMENT_UNKNOWN',
  });
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('membership recovery after relaunch', () => {
  it('clears a notified paid transaction and permits a fresh purchase', async () => {
    const db = storage();
    saveOldTransaction(db);
    const client = {
      call: vi.fn((request: { action: string; orderId?: string }) => {
        if (request.action === 'recoverOrders') return { ...free, isMember: true };
        if (request.action === 'getOrder' && request.orderId === 'old-order')
          return {
            order: order('PAID'),
            membership: { ...free, isMember: true, startsAt: 'now', expiresAt: 'later' },
          };
        if (request.action === 'createOrder') return { order: order('CLOSED', 'new-order') };
        return { order: order('CLOSED', request.orderId), membership: free };
      }),
    };
    const service = new MembershipService(
      client as never,
      db,
      vi.fn(),
      undefined,
      undefined,
      () => ({ accountScope: 'account', sessionScope: 'session' }),
    );

    await expect(service.recoverOrders()).resolves.toMatchObject({ isMember: true });
    expect(db.get(key('account'))).toBeNull();
    await expect(service.purchase()).resolves.toMatchObject({ order: { orderId: 'new-order' } });
    expect(client.call.mock.calls.map(([request]) => request.action)).toEqual([
      'recoverOrders',
      'getOrder',
      'createOrder',
      'getOrder',
    ]);
  });

  it('clears a notified closed transaction', async () => {
    const db = storage();
    saveOldTransaction(db);
    const client = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'recoverOrders' ? free : { order: order('CLOSED'), membership: free },
      ),
    };
    const service = new MembershipService(
      client as never,
      db,
      vi.fn(),
      undefined,
      undefined,
      () => ({ accountScope: 'account', sessionScope: 'session' }),
    );

    await expect(service.recoverOrders()).resolves.toEqual(free);
    expect(db.get(key('account'))).toBeNull();
  });

  it('retains the transaction and exposes a verification failure', async () => {
    const db = storage();
    saveOldTransaction(db);
    const failure = new Error('offline');
    const client = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'recoverOrders' ? free : Promise.reject(failure),
      ),
    };
    const service = new MembershipService(
      client as never,
      db,
      vi.fn(),
      undefined,
      undefined,
      () => ({ accountScope: 'account', sessionScope: 'session' }),
    );

    await expect(service.recoverOrders()).rejects.toBe(failure);
    expect(db.get(key('account'))).toMatchObject({
      orderId: 'old-order',
      stage: 'PAYMENT_UNKNOWN',
    });
  });

  it('retains the transaction when the authoritative order remains unknown', async () => {
    const db = storage();
    saveOldTransaction(db);
    const client = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'recoverOrders'
          ? free
          : { order: order('PAYMENT_UNKNOWN'), membership: free },
      ),
    };
    const service = new MembershipService(
      client as never,
      db,
      vi.fn(),
      undefined,
      undefined,
      () => ({ accountScope: 'account', sessionScope: 'session' }),
    );

    await expect(service.recoverOrders()).resolves.toEqual(free);
    expect(db.get(key('account'))).toMatchObject({
      orderId: 'old-order',
      stage: 'PAYMENT_UNKNOWN',
    });
  });

  it('does not write a completed old-session recovery into the new account', async () => {
    let accountScope = 'old';
    const db = storage();
    saveOldTransaction(db, 'old');
    const query = deferred<unknown>();
    const client = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'recoverOrders' ? free : query.promise,
      ),
    };
    const service = new MembershipService(
      client as never,
      db,
      vi.fn(),
      undefined,
      undefined,
      () => ({ accountScope, sessionScope: 'session' }),
    );
    const recovery = service.recoverOrders();
    await vi.waitFor(() => expect(client.call).toHaveBeenCalledTimes(2));
    accountScope = 'new';
    query.resolve({
      order: order('PAID'),
      membership: { ...free, isMember: true, startsAt: 'now', expiresAt: 'later' },
    });

    await expect(recovery).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(db.get(key('old'))).toMatchObject({ orderId: 'old-order', stage: 'PAYMENT_UNKNOWN' });
    expect(db.get(key('new'))).toBeNull();
  });
});

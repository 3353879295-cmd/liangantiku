import { describe, expect, it, vi } from 'vitest';
import { MembershipClient } from '../miniprogram/repositories/membership-client';
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
const success = (data: unknown) => ({ result: { ok: true, data } });
const pendingOrder = (orderId: string) => ({
  orderId,
  status: 'PENDING' as const,
  amount: 2800,
  paidAt: null,
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
const saveTx = (
  db: ReturnType<typeof storage>,
  orderId = 'test-order-1',
  accountScope = 'account',
) =>
  db.set(key(accountScope), {
    version: 2,
    accountScope,
    sessionScope: 'session',
    requestId: 'retired-request',
    orderId,
    stage: 'PAYMENT_UNKNOWN',
  });
const service = (
  client: { call: ReturnType<typeof vi.fn> },
  db = storage(),
  scope = () => ({ accountScope: 'account', sessionScope: 'session' }),
) => new MembershipService(client as never, db, vi.fn(), undefined, undefined, scope);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('test-order hold release gateway validation', () => {
  it('keeps the legacy membership-only recovery response flattened', async () => {
    const client = new MembershipClient(vi.fn().mockResolvedValue(success({ membership: free })));
    await expect(client.call({ action: 'recoverOrders' })).resolves.toEqual(free);
  });

  it('accepts a validated release with or without a replacement pending order', async () => {
    const localOrderId = 'test-order-1';
    const transport = vi
      .fn()
      .mockResolvedValueOnce(success({ membership: free, releasedTestOrderId: localOrderId }))
      .mockResolvedValueOnce(
        success({
          membership: free,
          pendingOrder: pendingOrder('server-order-2'),
          releasedTestOrderId: localOrderId,
        }),
      );
    const client = new MembershipClient(transport);
    await expect(client.call({ action: 'recoverOrders', localOrderId })).resolves.toEqual({
      membership: free,
      releasedTestOrderId: localOrderId,
    });
    await expect(client.call({ action: 'recoverOrders', localOrderId })).resolves.toEqual({
      membership: free,
      pendingOrder: pendingOrder('server-order-2'),
      releasedTestOrderId: localOrderId,
    });
  });

  it.each([
    ['without a local request', undefined, 'test-order-1'],
    ['with a mismatched release', 'test-order-1', 'other-order-2'],
    ['with a malformed release', 'test-order-1', 'bad'],
  ])('rejects a release %s', async (_label, localOrderId, releasedTestOrderId) => {
    const client = new MembershipClient(
      vi.fn().mockResolvedValue(success({ membership: free, releasedTestOrderId })),
    );
    await expect(
      client.call({ action: 'recoverOrders', ...(localOrderId ? { localOrderId } : {}) }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
  });
});

describe('test-order hold release recovery', () => {
  it('releases the local test transaction and permits a fresh request id purchase', async () => {
    const db = storage();
    saveTx(db);
    const client = {
      call: vi.fn((request: { action: string; localOrderId?: string; requestId?: string }) => {
        if (request.action === 'recoverOrders')
          return { membership: free, releasedTestOrderId: request.localOrderId };
        if (request.action === 'createOrder')
          return { order: pendingOrder('fresh-order-2'), membership: free };
        return { order: pendingOrder('fresh-order-2'), membership: free };
      }),
    };
    const member = service(client, db);
    await expect(member.recoverOrders()).resolves.toEqual(free);
    expect(db.get(key('account'))).toBeNull();
    await member.purchase();
    expect(client.call).toHaveBeenNthCalledWith(
      1,
      { action: 'recoverOrders', localOrderId: 'test-order-1' },
      undefined,
      'account',
    );
    expect(client.call).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'createOrder',
        requestId: expect.not.stringContaining('retired-request'),
      }),
      expect.any(String),
      'account',
    );
  });

  it('replaces a released test transaction with the server pending order', async () => {
    const db = storage();
    saveTx(db);
    const client = {
      call: vi.fn(() => ({
        membership: free,
        releasedTestOrderId: 'test-order-1',
        pendingOrder: pendingOrder('server-order-2'),
      })),
    };
    const member = service(client, db);
    await expect(member.recoverOrders()).resolves.toEqual(free);
    expect(db.get(key('account'))).toMatchObject({
      orderId: 'server-order-2',
      requestId: 'recovered-server-order-2',
    });
  });

  it('does not clear a mismatched or failed release, and still queries ordinary unknown orders', async () => {
    for (const response of [
      { membership: free, releasedTestOrderId: 'other-order-2' },
      new Error('offline'),
      free,
    ]) {
      const db = storage();
      saveTx(db);
      const client = {
        call: vi.fn((request: { action: string }) => {
          if (request.action === 'recoverOrders') {
            if (response instanceof Error) return Promise.reject(response);
            return response;
          }
          return { order: pendingOrder('test-order-1'), membership: free };
        }),
      };
      const member = service(client, db);
      if (response instanceof Error) await expect(member.recoverOrders()).rejects.toBe(response);
      else await member.recoverOrders();
      expect(db.get(key('account'))).toMatchObject({ orderId: 'test-order-1' });
      if (response === free)
        expect(client.call).toHaveBeenLastCalledWith(
          { action: 'getOrder', orderId: 'test-order-1' },
          undefined,
          'account',
        );
    }
  });

  it('does not clear another account or session when recovery finishes after an identity change', async () => {
    let accountScope = 'account';
    let sessionScope = 'session';
    const db = storage();
    saveTx(db);
    saveTx(db, 'other-test-2', 'other');
    const release = deferred<unknown>();
    const client = {
      call: vi.fn((request: { action: string }) =>
        request.action === 'recoverOrders'
          ? release.promise
          : { order: pendingOrder('new-order-3'), membership: free },
      ),
    };
    const member = service(client, db, () => ({ accountScope, sessionScope }));
    const recovery = member.recoverOrders();
    await vi.waitFor(() => expect(client.call).toHaveBeenCalledTimes(1));
    db.set(key('account'), {
      version: 2,
      accountScope: 'account',
      sessionScope: 'session',
      requestId: 'new-request',
      orderId: 'new-order-3',
      stage: 'PREPARED',
    });
    accountScope = 'other';
    sessionScope = 'other-session';
    release.resolve({ membership: free, releasedTestOrderId: 'test-order-1' });
    await expect(recovery).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(db.get(key('account'))).toMatchObject({ orderId: 'new-order-3' });
    expect(db.get(key('other'))).toMatchObject({ orderId: 'other-test-2' });
  });

  it.each([
    ['a different order', 'new-order-3', 'new-request', 'PREPARED'],
    ['the same order with a newer request and stage', 'test-order-1', 'new-request', 'PENDING'],
  ] as const)(
    'keeps a newer same-scope transaction while a release response includes a pending order: %s',
    async (_label, orderId, requestId, stage) => {
      const db = storage();
      saveTx(db);
      const release = deferred<unknown>();
      const client = {
        call: vi.fn((request: { action: string; orderId?: string }) => {
          if (request.action === 'recoverOrders') return release.promise;
          return {
            order: { ...pendingOrder(request.orderId ?? 'new-order-3'), status: stage },
            membership: free,
          };
        }),
      };
      const member = service(client, db);
      const recovery = member.recoverOrders();
      await vi.waitFor(() => expect(client.call).toHaveBeenCalledTimes(1));
      db.set(key('account'), {
        version: 2,
        accountScope: 'account',
        sessionScope: 'session',
        requestId,
        orderId,
        stage,
      });
      release.resolve({
        membership: free,
        releasedTestOrderId: 'test-order-1',
        pendingOrder: pendingOrder('server-order-2'),
      });
      await expect(recovery).resolves.toEqual(free);
      expect(db.get(key('account'))).toMatchObject({ orderId, requestId, stage });
      expect(client.call).toHaveBeenLastCalledWith(
        { action: 'getOrder', orderId },
        undefined,
        'account',
      );
    },
  );
});

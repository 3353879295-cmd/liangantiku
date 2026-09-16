import { afterEach, describe, expect, it, vi } from 'vitest';
import { MembershipClient, MembershipError } from '../miniprogram/repositories/membership-client';
import { MembershipService } from '../miniprogram/services/membership-service';

const status = {
  isMember: false,
  startsAt: null,
  expiresAt: null,
  freeUsed: 1,
  freeRemaining: 2,
  freeLimit: 3,
  freeDate: '2026-09-05',
  serverTime: '2026-09-05T01:00:00.000Z',
  paymentAvailable: true,
};
const success = (data: unknown) => ({ result: { ok: true, data } });

describe('membership request diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('distinguishes the client deadline without retrying or logging authorization data', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    vi.stubGlobal('wx', { getLogManager: () => ({ warn }) });
    const transport = vi.fn(() => new Promise<{ result: unknown }>(() => undefined));
    const client = new MembershipClient(transport, undefined, 50);
    const result = expect(
      client.call({
        action: 'startRandomPractice',
        requestId: 'secret-session',
        sessionId: 'secret-session',
        questionIds: ['private-question'],
      }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(transport).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'membership_request',
      expect.objectContaining({
        phase: 'transport',
        outcome: 'timeout',
        elapsedMs: 50,
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-session|private-question/);
  });

  it('keeps a cloud trace for rejected responses and ignores diagnostic logger failures', async () => {
    const warn = vi.fn();
    vi.stubGlobal('wx', { getLogManager: () => ({ warn }) });
    const response = {
      requestID: '70acec9e-793f-43f5-9987-925a280e75d7',
      result: {
        ok: false,
        error: { code: 'DAILY_LIMIT_REACHED', message: 'private-message' },
      },
    };
    const client = new MembershipClient(vi.fn().mockResolvedValue(response));
    await expect(client.call({ action: 'getStatus' })).rejects.toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
    });
    expect(warn).toHaveBeenCalledWith(
      'membership_request',
      expect.objectContaining({
        phase: 'response',
        outcome: 'failed',
        requestID: response.requestID,
        code: 'DAILY_LIMIT_REACHED',
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-message');
    warn.mockImplementation(() => {
      throw new Error('logger unavailable');
    });
    await expect(client.call({ action: 'getStatus' })).rejects.toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
    });
  });

  it('preserves only a numeric SDK error code from a transport rejection', async () => {
    const warn = vi.fn();
    vi.stubGlobal('wx', { getLogManager: () => ({ warn }) });
    const client = new MembershipClient(
      vi.fn().mockRejectedValue({
        errCode: -504003,
        errMsg: 'private-network-details',
        requestID: 'private-invalid-trace',
      }),
    );
    await expect(client.call({ action: 'getStatus' })).rejects.toMatchObject({
      code: 'MEMBERSHIP_UNAVAILABLE',
    });
    expect(warn).toHaveBeenCalledWith(
      'membership_request',
      expect.objectContaining({
        phase: 'transport',
        outcome: 'failed',
        sdkCode: -504003,
        requestID: undefined,
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  });
});

describe('payment authorization boundary', () => {
  const order = { orderId: 'prepared', status: 'PREPARED', amount: 2800, paidAt: null };
  const payment = {
    mode: 'short_series_goods',
    signData: JSON.stringify({
      env: 0,
      currencyType: 'CNY',
      buyQuantity: 1,
      goodsPrice: 2800,
      outTradeNo: 'prepared',
      attach: 'prepared',
      offerId: '1450639573',
      productId: 'warehouse_member_6m',
    }),
    paySig: 'a'.repeat(64),
    signature: 'b'.repeat(64),
  };
  it.each([
    { order, canStartPayment: false, payment },
    { order, canStartPayment: true },
    { order, canStartPayment: true, payment: { ...payment, signData: '{}' } },
  ])('rejects an unauthorized or malformed payment payload', async (data) => {
    const client = new MembershipClient(
      vi.fn().mockResolvedValue(success(data)),
      vi.fn().mockResolvedValue('code'),
    );
    await expect(client.call({ action: 'createOrder', requestId: 'r' })).rejects.toMatchObject({
      code: 'MEMBERSHIP_UNAVAILABLE',
    });
  });
});

describe('MembershipClient', () => {
  it('uses the membership function with no client identity and unwraps membership status', async () => {
    const transport = vi.fn().mockResolvedValue(success(status));
    const client = new MembershipClient(transport);
    await expect(client.call({ action: 'getStatus' })).resolves.toEqual(status);
    expect(transport).toHaveBeenCalledWith({ name: 'membership', data: { action: 'getStatus' } });
  });

  it('rejects malformed cloud data and network failures closed', async () => {
    await expect(
      new MembershipClient(vi.fn().mockResolvedValue(success({}))).call({ action: 'getStatus' }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    await expect(
      new MembershipClient(vi.fn().mockRejectedValue(new Error('offline'))).call({
        action: 'getStatus',
      }),
    ).rejects.toEqual(new MembershipError('MEMBERSHIP_UNAVAILABLE'));
  });

  it('continues to normalize a server platform diagnostic as membership unavailable', async () => {
    const client = new MembershipClient(
      vi.fn().mockResolvedValue({
        result: {
          ok: false,
          error: {
            code: 'MEMBERSHIP_UNAVAILABLE',
            diagnostic: { code: 'ORDER_PLATFORM_ERROR', platformCode: -412 },
          },
        },
      }),
    );
    await expect(client.call({ action: 'getStatus' })).rejects.toEqual(
      new MembershipError('MEMBERSHIP_UNAVAILABLE'),
    );
  });

  it('keeps a payment order and its membership confirmation distinct', async () => {
    const client = new MembershipClient(
      vi.fn().mockResolvedValue(
        success({
          order: { orderId: 'o1', status: 'PAID', amount: 2800, paidAt: '2026-09-05T01:00:00Z' },
          membership: {
            ...status,
            isMember: true,
            startsAt: '2026-09-05T00:00:00Z',
            expiresAt: '2027-03-05T00:00:00Z',
          },
        }),
      ),
    );
    await expect(client.call({ action: 'getOrder', orderId: 'o1' })).resolves.toMatchObject({
      order: { orderId: 'o1' },
      membership: { isMember: true },
    });
  });

  it('recovers a server pending order using only validated public fields', async () => {
    const pendingOrder = { orderId: 'o1', status: 'PENDING', amount: 2800, paidAt: null };
    const client = new MembershipClient(
      vi.fn().mockResolvedValue(success({ membership: status, pendingOrder })),
    );
    await expect(client.call({ action: 'recoverOrders' })).resolves.toEqual({
      membership: status,
      pendingOrder,
    });
    const invalid = new MembershipClient(
      vi
        .fn()
        .mockResolvedValue(
          success({ membership: status, pendingOrder: { ...pendingOrder, status: 'PAID' } }),
        ),
    );
    await expect(invalid.call({ action: 'recoverOrders' })).rejects.toMatchObject({
      code: 'MEMBERSHIP_UNAVAILABLE',
    });
  });

  it('requires allowed on a permission result and fixed server-controlled quota and fee values', async () => {
    const client = new MembershipClient(
      vi
        .fn()
        .mockResolvedValueOnce(success({ membership: status }))
        .mockResolvedValueOnce(
          success({ order: { orderId: 'o1', status: 'PENDING', amount: 1, paidAt: null } }),
        ),
    );
    await expect(
      client.call({ action: 'checkPermission', feature: 'randomPractice' }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    await expect(
      client.call({ action: 'createOrder', requestId: 'request-1' }),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
  });

  it('gets a fresh login code only for order creation and sends it only to membership', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(success(status))
      .mockResolvedValueOnce(
        success({ order: { orderId: 'order-01', status: 'PENDING', amount: 2800, paidAt: null } }),
      );
    const login = vi.fn().mockResolvedValue('login-code');
    const client = new MembershipClient(transport, login);

    await client.call({ action: 'getStatus' });
    await client.call({ action: 'createOrder', requestId: 'request-1' });

    expect(login).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenLastCalledWith({
      name: 'membership',
      data: { action: 'createOrder', requestId: 'request-1', loginCode: 'login-code' },
    });
  });

  it('times out a login without allowing its late result to create an order', async () => {
    vi.useFakeTimers();
    let resolveLogin!: (code: string) => void;
    const login = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    const transport = vi.fn().mockResolvedValue(success({}));
    const client = new MembershipClient(transport, login, 12);

    const pending = client.call({ action: 'createOrder', requestId: 'request-1' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(12);
    await rejected;
    resolveLogin('late-code');
    await Promise.resolve();

    expect(transport).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('releases a timed-out cloud request and consumes a late rejection', async () => {
    vi.useFakeTimers();
    let rejectTransport!: (error: Error) => void;
    const transport = vi.fn(
      () =>
        new Promise<{ result: unknown }>((_, reject) => {
          rejectTransport = reject;
        }),
    );
    const client = new MembershipClient(transport, undefined, 12);

    const pending = client.call({ action: 'getStatus' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(12);
    await rejected;
    rejectTransport(new Error('late offline'));
    await Promise.resolve();

    expect(transport).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('only coalesces simultaneous status reads and starts a fresh request after completion', async () => {
    let resolveStatus!: (value: { result: unknown }) => void;
    const transport = vi.fn(
      () =>
        new Promise<{ result: unknown }>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const service = new MembershipService(new MembershipClient(transport));

    const first = service.getStatus();
    const second = service.getStatus();
    expect(first).toBe(second);
    expect(transport).toHaveBeenCalledTimes(1);
    resolveStatus(success(status));
    await expect(first).resolves.toEqual(status);

    const third = service.getStatus();
    expect(transport).toHaveBeenCalledTimes(2);
    resolveStatus(success(status));
    await expect(third).resolves.toEqual(status);
  });

  it('preserves first-attempt authorization only with valid pending payment data', async () => {
    const data = {
      order: { orderId: 'fresh-order', status: 'PREPARED', amount: 2800, paidAt: null },
      canStartPayment: true,
      bridgeAttempt: 'a'.repeat(43),
      payment: {
        mode: 'short_series_goods',
        signData: JSON.stringify({
          env: 0,
          currencyType: 'CNY',
          buyQuantity: 1,
          goodsPrice: 2800,
          outTradeNo: 'fresh-order',
          attach: 'fresh-order',
          offerId: '1450639573',
          productId: 'warehouse_member_6m',
        }),
        paySig: 'a'.repeat(64),
        signature: 'b'.repeat(64),
      },
    };
    const client = new MembershipClient(
      vi
        .fn()
        .mockResolvedValueOnce(success(data))
        .mockResolvedValueOnce(success({ ...data, payment: undefined })),
      vi.fn().mockResolvedValue('code'),
    );
    await expect(client.call({ action: 'createOrder', requestId: 'r1' })).resolves.toMatchObject({
      canStartPayment: true,
    });
    await expect(client.call({ action: 'createOrder', requestId: 'r1' })).rejects.toMatchObject({
      code: 'MEMBERSHIP_UNAVAILABLE',
    });
    for (const orderId of ['short', '_leading_1', 'x'.repeat(33), 'has space']) {
      const invalid = new MembershipClient(
        vi.fn().mockResolvedValue(
          success({
            ...data,
            order: { ...data.order, orderId },
            payment: {
              ...data.payment,
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
            },
          }),
        ),
        () => Promise.resolve('test-login-code'),
      );
      await expect(invalid.call({ action: 'createOrder', requestId: 'r1' })).rejects.toMatchObject({
        code: 'MEMBERSHIP_UNAVAILABLE',
      });
    }
  });

  it('rejects a virtual-payment response whose signed order details do not match the order', async () => {
    const client = new MembershipClient(
      vi.fn().mockResolvedValue(
        success({
          order: { orderId: 'order-01', status: 'PENDING', amount: 2800, paidAt: null },
          payment: {
            mode: 'short_series_goods',
            signData: JSON.stringify({
              env: 0,
              currencyType: 'CNY',
              buyQuantity: 1,
              goodsPrice: 2800,
              outTradeNo: 'other-order',
              attach: 'order-01',
              offerId: '1450639573',
              productId: 'warehouse_member_6m',
            }),
            paySig: 'a'.repeat(64),
            signature: 'b'.repeat(64),
          },
        }),
      ),
      vi.fn().mockResolvedValue('code'),
    );
    await expect(
      client.call({ action: 'createOrder', requestId: 'request-1' }),
    ).rejects.toMatchObject({
      code: 'MEMBERSHIP_UNAVAILABLE',
    });
  });

  it('injects a fresh login code and accepts a server-authorized PREPARED resume only', async () => {
    const signed = {
      mode: 'short_series_goods',
      signData: JSON.stringify({
        env: 0,
        currencyType: 'CNY',
        buyQuantity: 1,
        goodsPrice: 2800,
        outTradeNo: 'order-01',
        attach: 'order-01',
        offerId: '1450639573',
        productId: 'warehouse_member_6m',
      }),
      paySig: 'a'.repeat(64),
      signature: 'b'.repeat(64),
    };
    const transport = vi.fn().mockResolvedValue(
      success({
        order: { orderId: 'order-01', status: 'PREPARED', amount: 2800, paidAt: null },
        canStartPayment: true,
        bridgeAttempt: 'a'.repeat(43),
        payment: signed,
      }),
    );
    const client = new MembershipClient(transport, vi.fn().mockResolvedValue('fresh-code'));
    await expect(
      client.call({ action: 'resumePayment', orderId: 'order-01' }),
    ).resolves.toMatchObject({
      canStartPayment: true,
      order: { status: 'PREPARED' },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { action: 'resumePayment', orderId: 'order-01', loginCode: 'fresh-code' },
      }),
    );
  });

  it('reads a validated payment account scope and forwards it only on payment actions', async () => {
    const accountScope = 'a'.repeat(64);
    const transport = vi
      .fn()
      .mockResolvedValueOnce(success({ accountScope }))
      .mockResolvedValueOnce(success({ membership: status }));
    const client = new MembershipClient(transport, vi.fn());
    await expect(client.getPaymentAccountScope()).resolves.toBe(accountScope);
    await client.call({ action: 'recoverOrders' }, 'p-test-1', accountScope);
    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: { action: 'getPaymentContext' } }),
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          action: 'recoverOrders',
          diagnosticTraceId: 'p-test-1',
          expectedPaymentAccountScope: accountScope,
        },
      }),
    );
  });

  it('rejects a malformed expected account scope without falling back to an unbound request', async () => {
    const transport = vi.fn().mockResolvedValue(success({ membership: status }));
    const client = new MembershipClient(transport);
    await expect(
      client.call({ action: 'recoverOrders' }, 'p-scope-test', 'invalid'),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_UNAVAILABLE' });
    expect(transport).not.toHaveBeenCalled();
  });
});

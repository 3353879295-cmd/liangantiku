/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createHandler } = require('../cloudfunctions/membership/lib/handler.js') as any;
const { createDiagnostics, ORDER_REVISION, REVISION, publicFailure } =
  require('../cloudfunctions/membership/lib/diagnostics.js') as any;
const context = { APPID: 'appid-private', OPENID: 'openid-private' };

const store = (transaction?: any) => {
  const grants = new Map();
  const api: any = {
    getGrant: async (account: string, session: string) =>
      grants.get(`${account}:${session}`) ?? null,
    getEntitlement: async () => null,
    getUsage: async () => null,
    saveUsage: async () => undefined,
    createGrant: async (id: string, value: any) => grants.set(id, value),
  };
  api.transaction = transaction || (async (work: any) => work(api));
  return api;
};
const event = {
  action: 'startRandomPractice',
  requestId: 'session-private',
  sessionId: 'session-private',
  questionIds: ['question-private'],
};

describe('membership random-practice diagnostics', () => {
  it('carries only a valid order diagnostic trace through start and finish', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_name: string, row: any) => records.push(row) },
    });
    const observation = diagnostics.start('createOrder', {
      requestId: 'request-private',
      diagnosticTraceId: 'p-click-20260912',
    });
    diagnostics.complete(observation, 'authorization');
    expect(records).toEqual([
      expect.objectContaining({
        action: 'createOrder',
        outcome: 'started',
        traceId: 'p-click-20260912',
      }),
      expect.objectContaining({
        action: 'createOrder',
        outcome: 'completed',
        traceId: 'p-click-20260912',
      }),
    ]);
  });

  it('drops invalid or sensitive order diagnostic traces', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_name: string, row: any) => records.push(row) },
    });
    for (const diagnosticTraceId of ['openid-private', 'p-ABCD', 'p-a', 'p-x<script>']) {
      const observation = diagnostics.start('getOrder', {
        orderId: 'order-private',
        diagnosticTraceId,
      });
      diagnostics.complete(observation, 'status-read');
    }
    expect(records).toHaveLength(8);
    expect(records.every((row) => !Object.hasOwn(row, 'traceId'))).toBe(true);
    expect(JSON.stringify(records)).not.toContain('openid-private');
  });

  it('records an idempotent authorization without raw identifiers or question data', async () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_name: string, row: any) => records.push(row) },
    });
    const handler = createHandler({ store: store(), diagnostics, hash: () => 'account-private' });
    expect(await handler(event, context)).toMatchObject({ ok: true });
    expect(await handler(event, context)).toMatchObject({ ok: true });
    expect(records).toHaveLength(4);
    expect(records.filter((row) => row.outcome === 'completed')).toHaveLength(2);
    expect(records.every((row) => row.revision === REVISION && row.stage)).toBe(true);
    const serialized = JSON.stringify(records);
    for (const secret of [
      'appid-private',
      'openid-private',
      'session-private',
      'question-private',
      'account-private',
    ])
      expect(serialized).not.toContain(secret);
  });

  it('captures a rejected transaction before the public error is normalized', async () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_name: string, row: any) => records.push(row) },
    });
    const rejectedStore = store(async () => {
      const error = Object.assign(new Error('secret database failure'), { errCode: -501 });
      return Promise.reject(error);
    });
    const handler = createHandler({
      store: rejectedStore,
      diagnostics,
      hash: () => 'account-private',
    });
    await expect(handler(event, context)).resolves.toEqual({
      ok: false,
      error: { code: 'MEMBERSHIP_UNAVAILABLE' },
    });
    expect(records.at(-1)).toMatchObject({
      outcome: 'failed',
      stage: 'transaction',
      errorCode: 'SDK_-501',
    });
    expect(JSON.stringify(records)).not.toContain('secret database failure');
  });

  it('does not let a logger failure change grant creation or validation results', async () => {
    const diagnostics = createDiagnostics({
      logger: {
        info: () => {
          throw new Error('logger unavailable');
        },
      },
    });
    const handler = createHandler({ store: store(), diagnostics, hash: () => 'account-private' });
    expect(await handler(event, context)).toMatchObject({ ok: true });
    expect(
      await handler(
        {
          action: 'validateRandomPractice',
          sessionId: event.sessionId,
          questionIds: event.questionIds,
        },
        context,
      ),
    ).toMatchObject({ ok: true });
  });

  it('records controlled getOrder reconciliation failures without payment secrets', async () => {
    const records: any[] = [];
    const order = {
      order_id: 'order-private',
      account_key: 'account-private',
      app_id: context.APPID,
      open_id: context.OPENID,
      amount: 2800,
      status: 'PENDING',
      payment_provider: 'virtual',
      product_id: 'membership-private',
    };
    const diagnostics = createDiagnostics({
      logger: { info: (_name: string, row: any) => records.push(row) },
    });
    const handler = createHandler({
      store: {
        getOrder: async () => order,
        getEntitlement: async () => null,
        getUsage: async () => null,
      },
      payment: {
        kind: 'virtual',
        canReconcile: true,
        query: async () => {
          const error: any = new Error('token-private');
          error.diagnostic = {
            code: 'ORDER_HTTP_STATUS',
            httpStatus: 412,
            httpOperation: 'token',
          };
          throw error;
        },
      },
      diagnostics,
      hash: () => 'account-private',
    });
    await expect(
      handler({ action: 'getOrder', orderId: order.order_id }, context),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'MEMBERSHIP_UNAVAILABLE' },
    });
    expect(records.at(-1)).toMatchObject({
      revision: ORDER_REVISION,
      action: 'getOrder',
      outcome: 'failed',
      stage: 'reconcile',
      errorCode: 'ORDER_HTTP_STATUS',
      errorDetails: { httpStatus: 412, httpOperation: 'token' },
    });
    expect(JSON.stringify(records)).not.toContain('token-private');
    expect(JSON.stringify(records)).not.toContain('order-private');
  });

  it('publishes only a bounded platform code for an order platform failure', async () => {
    const order = {
      order_id: 'order-private',
      account_key: 'account-private',
      app_id: context.APPID,
      open_id: context.OPENID,
      amount: 2800,
      status: 'PENDING',
    };
    const handler = createHandler({
      store: {
        getOrder: async () => order,
        getEntitlement: async () => null,
        getUsage: async () => null,
      },
      payment: {
        canReconcile: true,
        query: async () => {
          const error: any = new Error('platform-private');
          error.diagnostic = { code: 'ORDER_PLATFORM_ERROR', platformCode: -412 };
          throw error;
        },
      },
      hash: () => 'account-private',
    });
    await expect(
      handler({ action: 'getOrder', orderId: order.order_id }, context),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'MEMBERSHIP_UNAVAILABLE',
        diagnostic: { code: 'ORDER_PLATFORM_ERROR', platformCode: -412 },
      },
    });
  });

  it('does not publish non-integer or out-of-range platform codes', async () => {
    const order = {
      order_id: 'order-private',
      account_key: 'account-private',
      app_id: context.APPID,
      open_id: context.OPENID,
      amount: 2800,
      status: 'PENDING',
    };
    for (const platformCode of [-1000000000, 1000000000, 1.5]) {
      const handler = createHandler({
        store: {
          getOrder: async () => order,
          getEntitlement: async () => null,
          getUsage: async () => null,
        },
        payment: {
          canReconcile: true,
          query: async () => {
            const error: any = new Error('platform-private');
            error.diagnostic = { code: 'ORDER_PLATFORM_ERROR', platformCode };
            throw error;
          },
        },
        hash: () => 'account-private',
      });
      await expect(
        handler({ action: 'getOrder', orderId: order.order_id }, context),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'MEMBERSHIP_UNAVAILABLE' },
      });
    }
  });

  it('does not publish non-platform order diagnostics', async () => {
    const order = {
      order_id: 'order-private',
      account_key: 'account-private',
      app_id: context.APPID,
      open_id: context.OPENID,
      amount: 2800,
      status: 'PENDING',
    };
    const handler = createHandler({
      store: {
        getOrder: async () => order,
        getEntitlement: async () => null,
        getUsage: async () => null,
      },
      payment: {
        canReconcile: true,
        query: async () => {
          const error: any = new Error('shape-private');
          error.diagnostic = { code: 'ORDER_QUERY_SHAPE', platformCode: -412 };
          throw error;
        },
      },
      hash: () => 'account-private',
    });
    await expect(
      handler({ action: 'getOrder', orderId: order.order_id }, context),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'MEMBERSHIP_UNAVAILABLE' },
    });
  });

  it('does not let an order diagnostics logger change a completed read', async () => {
    const order = {
      order_id: 'order-private',
      account_key: 'account-private',
      amount: 2800,
      status: 'CLOSED',
    };
    const handler = createHandler({
      store: {
        getOrder: async () => order,
        getEntitlement: async () => null,
        getUsage: async () => null,
      },
      diagnostics: createDiagnostics({
        logger: {
          info: () => {
            throw new Error('logger unavailable');
          },
        },
      }),
      hash: () => 'account-private',
    });
    await expect(
      handler({ action: 'getOrder', orderId: order.order_id }, context),
    ).resolves.toMatchObject({
      ok: true,
      data: { order: { status: 'PAYMENT_UNKNOWN' } },
    });
  });

  it('ignores throwing error metadata getters while preserving a normalized getOrder failure', async () => {
    const records: any[] = [];
    const order = {
      order_id: 'order-private',
      account_key: 'account-private',
      app_id: context.APPID,
      open_id: context.OPENID,
      amount: 2800,
      status: 'PENDING',
      payment_provider: 'virtual',
      product_id: 'membership-private',
    };
    const poison = new Error('payment-private');
    for (const key of ['diagnostic', 'code', 'errCode'])
      Object.defineProperty(poison, key, {
        get: () => {
          throw new Error(`${key}-private`);
        },
      });
    const handler = createHandler({
      store: {
        getOrder: async () => order,
        getEntitlement: async () => null,
        getUsage: async () => null,
      },
      payment: {
        kind: 'virtual',
        canReconcile: true,
        query: async () => Promise.reject(poison),
      },
      diagnostics: createDiagnostics({
        logger: { info: (_name: string, row: any) => records.push(row) },
      }),
      hash: () => 'account-private',
    });
    await expect(
      handler({ action: 'getOrder', orderId: order.order_id }, context),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'MEMBERSHIP_UNAVAILABLE' },
    });
    expect(records.at(-1)).toMatchObject({
      revision: ORDER_REVISION,
      stage: 'reconcile',
      errorCode: 'UNCLASSIFIED',
    });
    expect(JSON.stringify(records)).not.toContain('private');
  });

  it('does not let malicious public diagnostic getters alter or extend the failure response', async () => {
    const order = {
      order_id: 'order-private',
      account_key: 'account-private',
      app_id: context.APPID,
      open_id: context.OPENID,
      amount: 2800,
      status: 'PENDING',
    };
    const poison = new Error('payment-private');
    Object.defineProperty(poison, 'diagnostic', {
      get: () => {
        throw new Error('diagnostic-private');
      },
    });
    const handler = createHandler({
      store: {
        getOrder: async () => order,
        getEntitlement: async () => null,
        getUsage: async () => null,
      },
      payment: { canReconcile: true, query: async () => Promise.reject(poison) },
      hash: () => 'account-private',
    });
    await expect(
      handler({ action: 'getOrder', orderId: order.order_id }, context),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'MEMBERSHIP_UNAVAILABLE' },
    });
  });

  it('does not let nested public diagnostic getters alter or leak from the failure response', async () => {
    const order = {
      order_id: 'order-private',
      account_key: 'account-private',
      app_id: context.APPID,
      open_id: context.OPENID,
      amount: 2800,
      status: 'PENDING',
    };
    for (const key of ['code', 'platformCode']) {
      const poison = new Error('payment-private');
      const diagnostic: any = {};
      Object.defineProperty(diagnostic, key, {
        get: () => {
          throw new Error(`${key}-private`);
        },
      });
      (poison as Error & { diagnostic?: unknown }).diagnostic = diagnostic;
      const handler = createHandler({
        store: {
          getOrder: async () => order,
          getEntitlement: async () => null,
          getUsage: async () => null,
        },
        payment: { canReconcile: true, query: async () => Promise.reject(poison) },
        hash: () => 'account-private',
      });
      await expect(
        handler({ action: 'getOrder', orderId: order.order_id }, context),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'MEMBERSHIP_UNAVAILABLE' },
      });
    }
  });

  it('exposes only bounded HTTP platform diagnostics without response text', () => {
    const failure = publicFailure({
      diagnostic: {
        code: 'ORDER_HTTP_STATUS',
        httpStatus: 412,
        platformCode: 12345,
        response: 'openid=private&signature=private',
      },
    });
    expect(failure).toEqual({
      ok: false,
      error: {
        code: 'MEMBERSHIP_UNAVAILABLE',
        diagnostic: { code: 'ORDER_HTTP_STATUS', httpStatus: 412, platformCode: 12345 },
      },
    });
    expect(JSON.stringify(failure)).not.toContain('private');
  });

  it('reads a public HTTP status getter once before exposing its bounded value', () => {
    let reads = 0;
    const failure = publicFailure({
      diagnostic: {
        code: 'ORDER_HTTP_STATUS',
        platformCode: 12345,
        get httpStatus() {
          reads += 1;
          return reads === 1 ? 412 : 'openid-private signature-private';
        },
      },
    });
    expect(reads).toBe(1);
    expect(failure).toEqual({
      ok: false,
      error: {
        code: 'MEMBERSHIP_UNAVAILABLE',
        diagnostic: { code: 'ORDER_HTTP_STATUS', httpStatus: 412, platformCode: 12345 },
      },
    });
    expect(JSON.stringify(failure)).not.toContain('private');
  });

  it('does not expose an out-of-range public HTTP status', () => {
    const failure = publicFailure({
      diagnostic: {
        code: 'ORDER_HTTP_STATUS',
        httpStatus: 1000000000,
        platformCode: 12345,
      },
    });
    expect(failure).toEqual({
      ok: false,
      error: {
        code: 'MEMBERSHIP_UNAVAILABLE',
        diagnostic: { code: 'ORDER_HTTP_STATUS', platformCode: 12345 },
      },
    });
  });

  it.each([412, -412, 268490001, 268490010])(
    'recovers a strict encoded platform error (%i) for clients',
    (platformCode) => {
      const failure = publicFailure({
        diagnostic: { code: `ORDER_PLATFORM_ERROR[errcode=${platformCode}]` },
      });
      expect(failure).toEqual({
        ok: false,
        error: {
          code: 'MEMBERSHIP_UNAVAILABLE',
          diagnostic: { code: 'ORDER_PLATFORM_ERROR', platformCode },
        },
      });
    },
  );

  it.each([
    'ORDER_PLATFORM_ERROR[errcode=1000000000]',
    'ORDER_PLATFORM_ERROR[errcode=1.5]',
    'ORDER_PLATFORM_ERROR[errcode=412private]',
    'ORDER_PLATFORM_ERROR[errcode=+412]',
    'ORDER_PLATFORM_ERROR[errcode=0412]',
    'ORDER_PLATFORM_ERROR[errcode=-0]',
  ])('rejects unsafe or injected encoded platform diagnostics: %s', (code) => {
    const failure = publicFailure({
      diagnostic: { code, platformCode: 412, response: 'openid-private signature-private' },
    });
    expect(failure).toEqual({ ok: false, error: { code: 'MEMBERSHIP_UNAVAILABLE' } });
    expect(JSON.stringify(failure)).not.toContain('private');
  });

  it('rejects a boxed encoded diagnostic code', () => {
    const failure = publicFailure({
      diagnostic: {
        code: new String('ORDER_PLATFORM_ERROR[errcode=412]'),
        platformCode: 412,
      },
    });
    expect(failure).toEqual({ ok: false, error: { code: 'MEMBERSHIP_UNAVAILABLE' } });
  });

  it('flattens only safe reconcile error details for CloudBase log views', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: any) => records.push(row) },
    });
    const error: any = new Error(
      'raw-error-message openid-private raw-platform-response signature-private',
    );
    error.diagnostic = {
      code: 'ORDER_PLATFORM_ERROR',
      platformCode: 412,
      httpStatus: 503,
      state: 6,
      httpOperation: 'query',
      response: 'openid-private raw-platform-response',
      signature: 'signature-private',
      loginCode: 'loginCode-private',
    };
    diagnostics.reconcileFail('order-private', error);
    expect(records).toEqual([
      expect.objectContaining({
        action: 'reconcilePendingOrders',
        errorCode: 'ORDER_PLATFORM_ERROR[errcode=412]',
        platformCode: 412,
        httpStatus: 503,
        state: 6,
        httpOperation: 'query',
      }),
    ]);
    expect(records[0]).not.toHaveProperty('errorDetails');
    expect(Object.keys(records[0])).toEqual(
      expect.arrayContaining(['platformCode', 'httpStatus', 'state', 'httpOperation', 'errorCode']),
    );
    expect(Object.keys(records[0]).indexOf('platformCode')).toBeLessThan(
      Object.keys(records[0]).indexOf('errorCode'),
    );
    const serialized = JSON.stringify(records);
    for (const secret of [
      'order-private',
      'openid-private',
      'raw-error-message',
      'raw-platform-response',
      'signature-private',
      'loginCode-private',
    ])
      expect(serialized).not.toContain(secret);
  });

  it('encodes bounded positive and negative platform codes only in reconcile errorCode', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: any) => records.push(row) },
    });
    for (const platformCode of [412, -412, 268490001, 268490010])
      diagnostics.reconcileFail('order-private', {
        diagnostic: { code: 'ORDER_PLATFORM_ERROR', platformCode },
      });
    expect(records.map((record) => record.errorCode)).toEqual([
      'ORDER_PLATFORM_ERROR[errcode=412]',
      'ORDER_PLATFORM_ERROR[errcode=-412]',
      'ORDER_PLATFORM_ERROR[errcode=268490001]',
      'ORDER_PLATFORM_ERROR[errcode=268490010]',
    ]);
  });

  it('does not double-encode a strict platform error already emitted by the payment adapter', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: any) => records.push(row) },
    });
    diagnostics.reconcileFail('order-private', {
      diagnostic: { code: 'ORDER_PLATFORM_ERROR[errcode=412]', platformCode: 412 },
    });
    expect(records).toEqual([
      expect.objectContaining({
        errorCode: 'ORDER_PLATFORM_ERROR[errcode=412]',
        platformCode: 412,
      }),
    ]);
    expect(JSON.stringify(records[0])).not.toContain('errcode=412][errcode=');
  });

  it('projects only the fixed platform detail to reconcile logs and never exposes it to clients', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: any) => records.push(row) },
    });
    const error: any = new Error('openid-private order-private signature-private');
    error.diagnostic = {
      code: 'ORDER_PLATFORM_ERROR[errcode=268490002]',
      platformCode: 268490002,
      platformDetail: 'ORDER_NOT_FOUND_EXPLICIT',
      errmsg: 'order_id=order-private does not exist',
    };
    diagnostics.reconcileFail('order-private', error);
    expect(records).toEqual([
      expect.objectContaining({
        errorCode: 'ORDER_PLATFORM_ERROR[errcode=268490002]',
        platformCode: 268490002,
        platformDetail: 'ORDER_NOT_FOUND_EXPLICIT',
      }),
    ]);
    expect(publicFailure(error)).toEqual({
      ok: false,
      error: {
        code: 'MEMBERSHIP_UNAVAILABLE',
        diagnostic: { code: 'ORDER_PLATFORM_ERROR', platformCode: 268490002 },
      },
    });
    expect(JSON.stringify(records)).not.toContain('private');
  });

  it('projects a strict platform rid only to reconcile logs', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: any) => records.push(row) },
    });
    const error: any = new Error('openid-private');
    error.diagnostic = {
      code: 'ORDER_PLATFORM_ERROR[errcode=268490001]',
      platformCode: 268490001,
      platformRid: 'A1B2C3D4-0A0B0C0D-11223344',
      errmsg: 'order-private openid-private signature-private',
    };
    diagnostics.reconcileFail('order-private', error);
    expect(records[0]).toMatchObject({ platformRid: 'a1b2c3d4-0a0b0c0d-11223344' });
    expect(publicFailure(error)).not.toMatchObject({
      error: { diagnostic: { platformRid: expect.anything() } },
    });
    expect(JSON.stringify(records)).not.toContain('private');
  });

  it('keeps reconcile errorCode at its base value without a bounded platform code', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: any) => records.push(row) },
    });
    diagnostics.reconcileFail('order-private', { diagnostic: { code: 'ORDER_PLATFORM_ERROR' } });
    expect(records).toEqual([expect.objectContaining({ errorCode: 'ORDER_PLATFORM_ERROR' })]);
    expect(records[0]).not.toHaveProperty('platformCode');
  });

  it('keeps hostile or non-numeric reconcile metadata unclassified and non-disruptive', () => {
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: any) => records.push(row) },
    });
    const error: any = new Error('private');
    const diagnostic: any = { code: 'not-safe', platformCode: '412', response: 'private' };
    Object.defineProperty(diagnostic, 'httpStatus', {
      get: () => {
        throw new Error('private getter');
      },
    });
    error.diagnostic = diagnostic;
    expect(() => diagnostics.reconcileFail('order-private', error)).not.toThrow();
    expect(records).toEqual([expect.objectContaining({ errorCode: 'UNCLASSIFIED' })]);
    expect(records[0]).not.toHaveProperty('platformCode');
    expect(records[0]).not.toHaveProperty('httpStatus');
    expect(records[0]).not.toHaveProperty('errorDetails');
    expect(JSON.stringify(records)).not.toContain('private');
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';

const crypto = require('node:crypto');
const { VirtualPayment, hmac } =
  require('../cloudfunctions/membership/lib/virtual-payment.js') as any;
const { createDiagnostics } = require('../cloudfunctions/membership/lib/diagnostics.js') as any;

const config = {
  enabled: true,
  appId: 'wx1234567890abcdef',
  appSecret: 'secret',
  offerId: 'offer',
  appKey: 'app-key',
  productId: 'membership-six-months',
  messageToken: 'message-token',
  messageAesKey: Buffer.alloc(32, 7).toString('base64').slice(0, -1),
};
const order = {
  order_id: 'order_123',
  app_id: config.appId,
  open_id: 'openid',
  amount: 2800,
  currency: 'CNY',
  payment_provider: 'virtual',
  product_id: config.productId,
};
const context = { APPID: config.appId, OPENID: 'openid' };
const encrypt = (body: string) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(Buffer.byteLength(body));
  const payload = Buffer.concat([
    Buffer.alloc(16, 2),
    length,
    Buffer.from(body),
    Buffer.from(config.appId),
  ]);
  const padding = 32 - (payload.length % 32 || 32);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(`${config.messageAesKey}=`, 'base64'),
    Buffer.from(`${config.messageAesKey}=`, 'base64').subarray(0, 16),
  );
  cipher.setAutoPadding(false);
  return Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.alloc(padding || 32, padding || 32)])),
    cipher.final(),
  ]).toString('base64');
};
const signature = (token: string, timestamp: string, nonce: string, encrypted: string) =>
  crypto
    .createHash('sha1')
    .update([token, timestamp, nonce, encrypted].sort().join(''))
    .digest('hex');
const event = (encrypted: string, format = 'xml') => {
  const timestamp = '100';
  const nonce = 'nonce';
  return {
    httpMethod: 'POST',
    query: {
      timestamp,
      nonce,
      encrypt_type: 'aes',
      msg_signature: signature(config.messageToken, timestamp, nonce, encrypted),
    },
    rawBody:
      format === 'xml'
        ? `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`
        : JSON.stringify({ Encrypt: encrypted }),
  };
};
const queryClient = (remote: Record<string, unknown>) => {
  let calls = 0;
  return new VirtualPayment(config, async () => ({
    statusCode: 200,
    body: JSON.stringify(
      ++calls === 1 ? { access_token: 'token', expires_in: 7200 } : { errcode: 0, order: remote },
    ),
  }));
};

describe('virtual membership payment adapter', () => {
  it('trusts a full refund only from the exact verified notification and binds the original payment', () => {
    const client = new VirtualPayment(config);
    const message = {
      MsgType: 'event',
      Event: 'xpay_refund_notify',
      OpenId: order.open_id,
      MchOrderId: order.order_id,
      WxOrderId: 'original-payment',
      WxRefundId: 'refund-platform-id',
      MchRefundId: 'refund-merchant-id',
      RetCode: 0,
      RefundFee: 2800,
    };
    expect(() => client.refundProof(message, order)).toThrow('invalid refund');
    const verified = client.readNotification(
      event(encrypt(JSON.stringify(message)), 'json'),
    ).message;
    expect(Object.isFrozen(verified)).toBe(true);
    expect(() => client.refundProof({ ...verified }, order)).toThrow('invalid refund');
    expect(() =>
      client.refundProof(verified, { ...order, transaction_id: 'other-payment' }),
    ).toThrow('invalid refund');
    const proof = client.refundProof(verified, { ...order, transaction_id: 'original-payment' });
    expect(proof).toMatchObject({
      trade_state: 'REFUNDED',
      transaction_id: 'original-payment',
      refund_transaction_id: 'refund-platform-id',
    });
    expect(client.verifyProof(proof, context)).toBe(true);
    for (const wrong of [
      { RefundFee: 1 },
      { RetCode: 1 },
      { WxOrderId: '' },
      { OpenId: 'other' },
    ]) {
      const invalid = client.readNotification(
        event(encrypt(JSON.stringify({ ...message, ...wrong })), 'json'),
      ).message;
      expect(() => client.refundProof(invalid, order)).toThrow('invalid refund');
    }
  });
  it('uses the documented HMAC construction', () => {
    expect(hmac('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
    expect(
      hmac('12345', '/xpay/query_user_balance&{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}'),
    ).toBe('c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5');
    expect(
      hmac('9hAb/NEYUlkaMBEsmFgzig==', '{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}'),
    ).toBe('089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7');
  });

  it('keeps notification parsing fail-closed without callback credentials but allows payment and reconciliation', async () => {
    for (const missing of [{ messageToken: '' }, { messageAesKey: 'invalid' }]) {
      const client = new VirtualPayment(
        { ...config, ...missing },
        async (_method: string, url: string) => ({
          statusCode: 200,
          body: JSON.stringify(
            url.includes('jscode2session') ? { openid: 'openid', session_key: 'session' } : {},
          ),
        }),
      );
      expect(client.available).toBe(true);
      expect(client.messageReady).toBe(false);
      expect(client.canReconcile).toBe(true);
      await expect(client.createPayment(order, context, 'code')).resolves.toMatchObject({
        mode: 'short_series_goods',
        signData: expect.any(String),
        paySig: expect.stringMatching(/^[a-f\d]{64}$/),
        signature: expect.stringMatching(/^[a-f\d]{64}$/),
      });
      // This is a correctly signed and encrypted notification under the complete
      // configuration. The callback credentials are therefore the only reason
      // the reduced configuration rejects it.
      const signedDelivery = event(
        encrypt('<xml><MsgType>event</MsgType><Event>xpay_goods_deliver_notify</Event></xml>'),
      );
      expect(() => new VirtualPayment(config).readNotification(signedDelivery)).not.toThrow();
      expect(() => client.readNotification(signedDelivery)).toThrow('invalid notification');
    }
  });

  it('only signs a payment after code2Session proves the SDK identity', async () => {
    const client = new VirtualPayment(config, async (_method: string, url: string) => ({
      statusCode: 200,
      body: JSON.stringify(
        url.includes('jscode2session') ? { openid: 'openid', session_key: 'session' } : {},
      ),
    }));
    const payment = await client.createPayment(order, context, 'login-code');
    expect(payment).toMatchObject({ mode: 'short_series_goods' });
    await expect(
      client.createPayment(order, { ...context, OPENID: 'other' }, 'login-code'),
    ).rejects.toThrow('invalid order');
  });

  it('accepts only a complete authenticated successful query proof', async () => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1
          ? { access_token: 'token', expires_in: 7200 }
          : {
              errcode: 0,
              order: {
                order_id: order.order_id,
                env_type: 1,
                order_type: 7,
                order_fee: 2800,
                paid_fee: 2800,
                coupon_fee: 0,
                refund_fee: 0,
                left_fee: 2800,
                wx_order_id: 'wx-order',
                paid_time: 1_800_000_000,
                status: 2,
              },
            },
      ),
    }));
    const proof = await client.query(order.order_id, order);
    expect(proof).toMatchObject({ trade_state: 'SUCCESS', platform_status: 2 });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(client.verifyProof(proof, context)).toBe(true);
    expect(client.verifyProof({ ...proof }, context)).toBe(false);
  });

  it('accepts the documented successful query response when coupon_fee is omitted', async () => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1
          ? { access_token: 'token', expires_in: 7200 }
          : {
              errcode: 0,
              order: {
                order_id: order.order_id,
                env_type: 1,
                order_type: 0,
                order_fee: 2800,
                paid_fee: 2800,
                refund_fee: 0,
                left_fee: 2800,
                wx_order_id: 'wx-order',
                paid_time: 1_800_000_000,
                status: 2,
              },
            },
      ),
    }));
    await expect(client.query(order.order_id, order)).resolves.toMatchObject({
      trade_state: 'SUCCESS',
    });
  });

  it.each([1, null, '0'])(
    'rejects a supplied nonzero or invalid coupon_fee (%j)',
    async (couponFee) => {
      let calls = 0;
      const client = new VirtualPayment(config, async () => ({
        statusCode: 200,
        body: JSON.stringify(
          ++calls === 1
            ? { access_token: 'token', expires_in: 7200 }
            : {
                errcode: 0,
                order: {
                  order_id: order.order_id,
                  env_type: 1,
                  order_type: 0,
                  order_fee: 2800,
                  paid_fee: 2800,
                  coupon_fee: couponFee,
                  refund_fee: 0,
                  left_fee: 2800,
                  wx_order_id: 'wx-order',
                  paid_time: 1_800_000_000,
                  status: 2,
                },
              },
        ),
      }));
      await expect(client.query(order.order_id, order)).rejects.toThrow('virtual query');
    },
  );

  it.each([
    [2, 0],
    [2, 7],
    [3, 0],
    [3, 7],
    [4, 0],
    [4, 7],
  ])(
    'accepts successful status %i and order type %i when refund_fee is omitted',
    async (status, orderType) => {
      const client = queryClient({
        order_id: order.order_id,
        env_type: 1,
        order_type: orderType,
        order_fee: 2800,
        paid_fee: 2800,
        coupon_fee: 0,
        left_fee: 2800,
        wx_order_id: 'wx-order',
        paid_time: 1_800_000_000,
        status,
      });
      await expect(client.query(order.order_id, order)).resolves.toMatchObject({
        trade_state: 'SUCCESS',
        platform_status: status,
      });
    },
  );

  it.each([1, null, '0'])(
    'rejects a supplied nonzero or invalid refund_fee (%j)',
    async (refundFee) => {
      const client = queryClient({
        order_id: order.order_id,
        env_type: 1,
        order_type: 0,
        order_fee: 2800,
        paid_fee: 2800,
        coupon_fee: 0,
        refund_fee: refundFee,
        left_fee: 2800,
        wx_order_id: 'wx-order',
        paid_time: 1_800_000_000,
        status: 2,
      });
      await expect(client.query(order.order_id, order)).rejects.toMatchObject({
        diagnostic: {
          code: 'ORDER_QUERY_SETTLEMENT',
          amountMatch: true,
          refundMatch: false,
        },
      });
    },
  );

  it.each([
    ['missing', {}],
    ['wrong amount', { left_fee: 1 }],
    ['null', { left_fee: null }],
    ['string', { left_fee: '2800' }],
    ['negative', { left_fee: -1 }],
  ])('rejects successful query with %s left_fee', async (_caseName, settlement) => {
    const client = queryClient({
      order_id: order.order_id,
      env_type: 1,
      order_type: 0,
      order_fee: 2800,
      paid_fee: 2800,
      coupon_fee: 0,
      refund_fee: 0,
      wx_order_id: 'wx-order',
      paid_time: 1_800_000_000,
      status: 2,
      ...settlement,
    });
    await expect(client.query(order.order_id, order)).rejects.toMatchObject({
      diagnostic: {
        code: 'ORDER_QUERY_SETTLEMENT',
        amountMatch: true,
        refundMatch: false,
      },
    });
  });

  it.each([
    [5, undefined],
    [5, 0],
    [8, undefined],
    [8, 0],
  ])('preserves full refund status %i with left_fee %j', async (status, leftFee) => {
    const client = queryClient({
      order_id: order.order_id,
      env_type: 1,
      order_type: 7,
      order_fee: 2800,
      paid_fee: 2800,
      refund_fee: 2800,
      left_fee: leftFee,
      wx_order_id: 'wx-order',
      paid_time: 1_800_000_000,
      status,
    });
    const proof = await client.query(order.order_id, order);
    expect(proof).toMatchObject({ trade_state: 'REFUNDED', platform_status: status });
    expect(client.verifyProof(proof, context)).toBe(true);
  });

  it('rejects an otherwise successful order with a mismatched amount or environment', async () => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1
          ? { access_token: 'token', expires_in: 7200 }
          : {
              errcode: 0,
              order: {
                order_id: order.order_id,
                env_type: 2,
                order_type: 0,
                order_fee: 1,
                paid_fee: 1,
                coupon_fee: 0,
                wx_order_id: 'wx-order',
                paid_time: 1_800_000_000,
                status: 2,
              },
            },
      ),
    }));
    await expect(client.query(order.order_id, order)).rejects.toThrow('virtual query');
  });

  it('keeps a valid unissued order pending without inventing payment evidence', async () => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1
          ? { access_token: 'token', expires_in: 7200 }
          : {
              errcode: 0,
              order: {
                order_id: order.order_id,
                env_type: 1,
                order_type: 0,
                order_fee: 2800,
                paid_fee: 0,
                status: 1,
              },
            },
      ),
    }));
    await expect(client.query(order.order_id, order)).resolves.toMatchObject({
      trade_state: 'NOTPAY',
    });
  });

  it.each([
    [0, 'INITIALIZED'],
    [1, 'NOTPAY'],
  ])('maps documented query status %i to %s', async (status, tradeState) => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1
          ? { access_token: 'token', expires_in: 7200 }
          : {
              errcode: 0,
              order: {
                order_id: order.order_id,
                env_type: 1,
                order_type: 0,
                order_fee: 2800,
                paid_fee: 0,
                status,
              },
            },
      ),
    }));
    await expect(client.query(order.order_id, order)).resolves.toMatchObject({
      trade_state: tradeState,
    });
  });

  it.each([
    '数据不存在',
    ' 数据不存在\n',
    '数据不存在 rid: A1B2C3D4-0A0B0C0D-11223344',
    '数据不存在rid: A1B2C3D4-0A0B0C0D-11223344',
    '数据不存在 rid: A1B2C3D4-0A0B0C0D-11223344z',
    '数据不存在；订单参数错误',
  ])('keeps query_order 268490002 blocked regardless of errmsg (%s)', async (errmsg) => {
    let calls = 0;
    const client = new VirtualPayment(
      { ...config, terminalPlatformCodes: { 268490002: 'CLOSED' } },
      async () => ({
        statusCode: 200,
        body: JSON.stringify(
          ++calls === 1
            ? { access_token: 'token', expires_in: 7200 }
            : { errcode: 268490002, errmsg },
        ),
      }),
    );
    await expect(client.query(order.order_id, order)).rejects.toSatisfy(
      (error: any) => error.diagnostic?.platformCode === 268490002,
    );
  });

  it('classifies query failures without retaining platform responses and preserves NOTPAY/CLOSED', async () => {
    const response = (body: unknown, statusCode = 200) => ({
      statusCode,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const token = { access_token: 'token-private', expires_in: 7200 };
    const remote = (status: number) => ({
      errcode: 0,
      order: {
        order_id: order.order_id,
        env_type: 1,
        order_type: 0,
        order_fee: 2800,
        paid_fee: 0,
        status,
      },
    });
    const cases: Array<[string, Array<unknown>, string]> = [
      ['token platform error', [response({ errcode: 40013 })], 'ORDER_TOKEN_PLATFORM'],
      ['HTTP error', [response(token), response('secret-private', 503)], 'ORDER_HTTP_STATUS'],
      ['invalid JSON', [response(token), response('secret-private')], 'ORDER_QUERY_JSON'],
      [
        'invalid order shape',
        [response(token), response({ errcode: 0, order: {} })],
        'ORDER_QUERY_IDENTITY',
      ],
      [
        'amount mismatch',
        [response(token), response({ ...remote(1), order: { ...remote(1).order, order_fee: 1 } })],
        'ORDER_QUERY_IDENTITY',
      ],
    ];
    for (const [, results, expected] of cases) {
      let index = 0;
      const client = new VirtualPayment(config, async () => results[index++]);
      await expect(client.query(order.order_id, order)).rejects.toSatisfy(
        (error: any) => error.diagnostic?.code === expected,
      );
    }
    for (const [state, expected] of [
      [1, 'NOTPAY'],
      [6, 'CLOSED'],
    ] as const) {
      let index = 0;
      const client = new VirtualPayment(
        config,
        async () => [response(token), response(remote(state))][index++],
      );
      await expect(client.query(order.order_id, order)).resolves.toMatchObject({
        trade_state: expected,
      });
    }
  });

  it.each([412, -412, 268490001, 268490010])(
    'preserves a numeric platform query errcode (%i) before requiring an order response',
    async (errcode) => {
      let calls = 0;
      const client = new VirtualPayment(config, async () => ({
        statusCode: 200,
        body: JSON.stringify(
          ++calls === 1 ? { access_token: 'token-private', expires_in: 7200 } : { errcode },
        ),
      }));
      await expect(client.query(order.order_id, order)).rejects.toSatisfy(
        (error: any) =>
          error.diagnostic?.code === `ORDER_PLATFORM_ERROR[errcode=${errcode}]` &&
          error.diagnostic?.platformCode === errcode,
      );
    },
  );

  it.each([
    ['order_id=order-private does not exist', 'ORDER_NOT_FOUND_EXPLICIT'],
    ['openid=openid-private is invalid', 'OPENID_FIELD_ERROR'],
    ['env is invalid', 'ENV_FIELD_ERROR'],
    ['order_id is invalid', 'ORDER_ID_FIELD_ERROR'],
    ['signature=signature-private is invalid', 'SIGNATURE_FIELD_ERROR'],
    ['unrecognized platform wording', 'UNRECOGNIZED'],
    ['x'.repeat(257), 'UNRECOGNIZED'],
    [null, 'UNRECOGNIZED'],
  ])(
    'classifies errcode 268490002 without retaining platform errmsg (%s)',
    async (errmsg, platformDetail) => {
      let calls = 0;
      const client = new VirtualPayment(
        { ...config, terminalPlatformCodes: { 268490002: 'CLOSED' } },
        async () => ({
          statusCode: 200,
          body: JSON.stringify(
            ++calls === 1
              ? { access_token: 'token-private', expires_in: 7200 }
              : { errcode: 268490002, errmsg },
          ),
        }),
      );
      let caught: any = null;
      try {
        await client.query(order.order_id, order);
      } catch (error) {
        caught = error;
      }
      expect(caught?.diagnostic).toEqual({
        code: 'ORDER_PLATFORM_ERROR[errcode=268490002]',
        platformCode: 268490002,
        platformDetail,
      });
      const serialized = JSON.stringify(caught?.diagnostic);
      for (const secret of ['order-private', 'openid-private', 'signature-private'])
        expect(serialized).not.toContain(secret);
    },
  );

  it('treats a throwing platform errmsg getter as unrecognized without leaking it', async () => {
    const client: any = new VirtualPayment(config, async () => {
      throw new Error('not called');
    });
    client.accessToken = async () => 'token-private';
    client.call = async () => {
      const response: any = { errcode: 268490002 };
      Object.defineProperty(response, 'errmsg', {
        get: () => {
          throw new Error('openid-private signature-private');
        },
      });
      return response;
    };
    await expect(client.query(order.order_id, order)).rejects.toSatisfy(
      (error: any) =>
        error.diagnostic?.code === 'ORDER_PLATFORM_ERROR[errcode=268490002]' &&
        error.diagnostic?.platformDetail === 'UNRECOGNIZED' &&
        !JSON.stringify(error.diagnostic).includes('private'),
    );
  });

  it.each([
    ['A1B2C3D4-0A0B0C0D-11223344', 'a1b2c3d4-0a0b0c0d-11223344'],
    ['order_123 openid-private signature-private', null],
  ])('retains only a strict platform rid (%s)', async (rid, expectedRid) => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1
          ? { access_token: 'token-private', expires_in: 7200 }
          : { errcode: 268490001, rid, errmsg: 'openid-private signature-private' },
      ),
    }));
    await expect(client.query(order.order_id, order)).rejects.toSatisfy(
      (error: any) =>
        (expectedRid === null
          ? !Object.hasOwn(error.diagnostic || {}, 'platformRid')
          : error.diagnostic?.platformRid === expectedRid) &&
        !JSON.stringify(error.diagnostic).includes('private'),
    );
  });

  it.each([
    ['rid: A1B2C3D4-0A0B0C0D-11223344', 'a1b2c3d4-0a0b0c0d-11223344'],
    ['RID= A1B2C3D4-0A0B0C0D-11223344', 'a1b2c3d4-0a0b0c0d-11223344'],
    ['order_id=A1B2C3D4-0A0B0C0D-11223344', null],
    ['openid=A1B2C3D4-0A0B0C0D-11223344', null],
    ['signature=A1B2C3D4-0A0B0C0D-11223344', null],
    ['arid=A1B2C3D4-0A0B0C0D-11223344', null],
    ['rid=A1B2C3D4-0A0B0C0D-11223344g', null],
    ['rid=A1B2C3D4-0A0B0C0D-11223344_Z', null],
    ['rid=A1B2C3D4-0A0B0C0D-11223344-9', null],
  ])(
    'extracts only an explicitly labelled rid from platform errmsg',
    async (errmsg, expectedRid) => {
      let calls = 0;
      const client = new VirtualPayment(config, async () => ({
        statusCode: 200,
        body: JSON.stringify(
          ++calls === 1
            ? { access_token: 'token-private', expires_in: 7200 }
            : { errcode: 268490001, errmsg },
        ),
      }));
      await expect(client.query(order.order_id, order)).rejects.toSatisfy(
        (error: any) =>
          (expectedRid === null
            ? !Object.hasOwn(error.diagnostic || {}, 'platformRid')
            : error.diagnostic?.platformRid === expectedRid) &&
          !JSON.stringify(error.diagnostic).includes('private'),
      );
    },
  );

  it.each([1000000000, Number.MAX_SAFE_INTEGER])(
    'keeps an out-of-range numeric query errcode (%i) blocked without a strict encoding',
    async (errcode) => {
      let calls = 0;
      const records: any[] = [];
      const diagnostics = createDiagnostics({
        logger: { info: (_channel: string, row: any) => records.push(row) },
      });
      const client = new VirtualPayment(
        { ...config, terminalPlatformCodes: { [errcode]: 'CLOSED' } },
        async () => ({
          statusCode: 200,
          body: JSON.stringify(
            ++calls === 1
              ? { access_token: 'token-private', expires_in: 7200 }
              : { errcode, errmsg: 'openid-private signature-private' },
          ),
        }),
      );
      try {
        await client.query(order.order_id, order);
      } catch (error) {
        expect((error as any).diagnostic).toEqual({ code: 'ORDER_PLATFORM_ERROR' });
        diagnostics.reconcileFail(order.order_id, error);
      }
      expect(records).toEqual([expect.objectContaining({ errorCode: 'ORDER_PLATFORM_ERROR' })]);
      expect(records[0]).not.toHaveProperty('platformCode');
      const serialized = JSON.stringify(records);
      for (const secret of [order.order_id, 'openid-private', 'signature-private'])
        expect(serialized).not.toContain(secret);
    },
  );

  it.each([1.5, '412'])(
    'rejects a non-safe-integer platform query errcode without encoding it',
    async (errcode) => {
      let calls = 0;
      const client = new VirtualPayment(config, async () => ({
        statusCode: 200,
        body: JSON.stringify(
          ++calls === 1 ? { access_token: 'token-private', expires_in: 7200 } : { errcode },
        ),
      }));
      await expect(client.query(order.order_id, order)).rejects.toSatisfy(
        (error: any) => error.diagnostic?.code === 'ORDER_QUERY_SHAPE',
      );
    },
  );

  it('only converts an explicitly injected audited platform code to a terminal query proof', async () => {
    let calls = 0;
    const client = new VirtualPayment(
      { ...config, terminalPlatformCodes: { 98765: 'CLOSED' } },
      async () => ({
        statusCode: 200,
        body: JSON.stringify(
          ++calls === 1 ? { access_token: 'token-private', expires_in: 7200 } : { errcode: 98765 },
        ),
      }),
    );
    await expect(client.query(order.order_id, order)).resolves.toMatchObject({
      trade_state: 'CLOSED',
      platform_status: 98765,
    });
  });

  it('extracts only a bounded errcode from a non-2xx query response and never treats HTTP 412 as closure', async () => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: ++calls === 1 ? 200 : 412,
      body:
        calls === 1
          ? JSON.stringify({ access_token: 'token-private', expires_in: 7200 })
          : JSON.stringify({ errcode: 12345, errmsg: 'private platform text' }),
    }));
    await expect(client.query(order.order_id, order)).rejects.toSatisfy(
      (error: any) =>
        error.diagnostic?.code === 'ORDER_HTTP_STATUS' &&
        error.diagnostic?.httpStatus === 412 &&
        error.diagnostic?.platformCode === 12345 &&
        !Object.values(error.diagnostic).some((value) => String(value).includes('private')),
    );
  });

  it('keeps an out-of-range non-2xx platform code blocked despite an injected terminal mapping', async () => {
    let calls = 0;
    const records: any[] = [];
    const diagnostics = createDiagnostics({
      logger: { info: (_channel: string, row: any) => records.push(row) },
    });
    const client = new VirtualPayment(
      { ...config, terminalPlatformCodes: { 1000000000: 'CLOSED' } },
      async () => ({
        statusCode: ++calls === 1 ? 200 : 412,
        body:
          calls === 1
            ? JSON.stringify({ access_token: 'token-private', expires_in: 7200 })
            : JSON.stringify({ errcode: 1000000000, errmsg: 'openid-private signature-private' }),
      }),
    );
    let caught: any = null;
    try {
      await client.query(order.order_id, order);
    } catch (error) {
      caught = error;
      diagnostics.reconcileFail(order.order_id, error);
    }
    expect(caught?.diagnostic).toEqual({
      code: 'ORDER_HTTP_STATUS',
      httpStatus: 412,
      httpOperation: 'query',
    });
    expect(records).toEqual([
      expect.objectContaining({ errorCode: 'ORDER_HTTP_STATUS', httpStatus: 412 }),
    ]);
    expect(records[0]).not.toHaveProperty('platformCode');
    const serialized = JSON.stringify(records);
    for (const secret of [order.order_id, 'openid-private', 'signature-private'])
      expect(serialized).not.toContain(secret);
  });

  it('keeps a non-2xx explicit order-not-found platform response unresolved without its errmsg', async () => {
    let calls = 0;
    const client: any = new VirtualPayment(
      { ...config, terminalPlatformCodes: { 268490002: 'CLOSED' } },
      async () => ({
        statusCode: ++calls === 1 ? 200 : 412,
        body:
          calls === 1
            ? JSON.stringify({ access_token: 'token-private', expires_in: 7200 })
            : JSON.stringify({
                errcode: 268490002,
                errmsg:
                  'order_id=order-private does not exist rid=A1B2C3D4-0A0B0C0D-11223344 openid-private signature-private',
              }),
      }),
    );
    let caught: any = null;
    try {
      await client.query(order.order_id, order);
    } catch (error) {
      caught = error;
    }
    expect(caught?.diagnostic).toEqual({
      code: 'ORDER_HTTP_STATUS',
      httpStatus: 412,
      platformCode: 268490002,
      platformDetail: 'ORDER_NOT_FOUND_EXPLICIT',
      platformRid: 'a1b2c3d4-0a0b0c0d-11223344',
      httpOperation: 'query',
    });
    const serialized = JSON.stringify(caught?.diagnostic);
    for (const secret of [order.order_id, 'order-private', 'openid-private', 'signature-private'])
      expect(serialized).not.toContain(secret);
  });

  it('still rejects a successful platform response without an order', async () => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1 ? { access_token: 'token-private', expires_in: 7200 } : { errcode: 0 },
      ),
    }));
    await expect(client.query(order.order_id, order)).rejects.toSatisfy(
      (error: any) => error.diagnostic?.code === 'ORDER_QUERY_SHAPE',
    );
  });

  it('signs the exact provide-goods path and transmitted body with the production AppKey', async () => {
    const client = new VirtualPayment(
      config,
      async (method: string, url: string, _headers: unknown, body: string) => {
        if (url.includes('/cgi-bin/stable_token'))
          return {
            statusCode: 200,
            body: JSON.stringify({ access_token: 'token&private', expires_in: 7200 }),
          };
        const requestUrl = new URL(url);
        expect(method).toBe('POST');
        expect(requestUrl.pathname).toBe('/xpay/notify_provide_goods');
        expect(requestUrl.searchParams.get('access_token')).toBe('token&private');
        expect(JSON.parse(body)).toEqual({ order_id: order.order_id, env: 0 });
        const expected = crypto
          .createHmac('sha256', config.appKey)
          .update(`/xpay/notify_provide_goods&${body}`)
          .digest('hex');
        expect(requestUrl.searchParams.get('pay_sig')).toBe(expected);
        return { statusCode: 200, body: JSON.stringify({ errcode: 0 }) };
      },
    );
    await expect(client.provideGoods(order)).resolves.toEqual({ errcode: 0 });
  });

  it('treats an empty successful provide-goods response as acknowledged', async () => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: ++calls === 1 ? JSON.stringify({ access_token: 'token', expires_in: 7200 }) : '',
    }));
    await expect(client.provideGoods(order)).resolves.toEqual({});
  });

  it('treats an errcode-zero provide-goods response as acknowledged', async () => {
    let calls = 0;
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1 ? { access_token: 'token', expires_in: 7200 } : { errcode: 0 },
      ),
    }));
    await expect(client.provideGoods(order)).resolves.toEqual({ errcode: 0 });
  });

  it('retains a bounded provide-goods platform code without its errmsg', async () => {
    let calls = 0;
    const secret = 'openid-private token-private order-private';
    const client = new VirtualPayment(config, async () => ({
      statusCode: 200,
      body: JSON.stringify(
        ++calls === 1
          ? { access_token: 'token', expires_in: 7200 }
          : { errcode: 123456, errmsg: secret },
      ),
    }));
    let caught: any = null;
    try {
      await client.provideGoods(order);
    } catch (error) {
      caught = error;
    }
    expect(caught?.diagnostic).toEqual({
      code: 'ORDER_PLATFORM_ERROR',
      platformCode: 123456,
    });
    expect(JSON.stringify(caught?.diagnostic)).not.toContain(secret);
  });

  it.each([
    ['a bare ampersand', 'goods&services'],
    ['a literal entity', 'goods&amp;services'],
  ])('preserves CDATA with %s in an encrypted, signed XML notification', (_label, note) => {
    const client = new VirtualPayment(config);
    const xml = `<xml><Note><![CDATA[${note}]]></Note></xml>`;

    expect(client.readNotification(event(encrypt(xml))).message.Note).toBe(note);
  });

  it('verifies, decrypts, and parses the protected XML delivery message', () => {
    const client = new VirtualPayment(config);
    // Fixed AES-256-CBC vector: key and IV are the decoded EncodingAESKey and its first 16 bytes.
    const encrypted =
      'TzjmzHpSkdEYaTNaED2R58OwnlMZEzNuHJPXSdCORPkv7gFwf2DxiezBSUwSa9iS2gMkr9Ag/WeNqmTtK2LXo5pvTMYmkGNIzXbRb6IyCgPK9BbUFkEojsTAR4zgHNtnMLOq1pnyXIUjCHjczITdqKjASJGqQwEeAGWCs3MRV1vaxmnxgo/7MZjebAn3/NIiRRXvU9+NFnSdQwdg/vuFVsXPScUTPK0GoDoDxY17DERA54lGpRs6XDR40Qco6nnS4aLiIlBtu44b83TeSE4Lo54ExIwQDdQSRrTaKoNrdrfNJMdV/Q62j1S5I/g2NcD46ZWdikOUNfL26nWJWD/ICfutTrHs1wYr/aW2Zcycm1ES2eS6EzLobXlCbBXEbrEyvl7djnI3otZODjeyhmyEWS2Wqg1HF2+uij09IDj38cUUqSoeGUZtVGj0P4G4YEa5B9h0okeMOuBZG/mgDNrZsLIlYqQp7IOtku/WJumxqzfCrOjYm2QpkKwUpc3X50N3';
    const result = client.readNotification(event(encrypted));
    expect(result.format).toBe('xml');
    expect(client.validateDelivery(result.message, order)).toBe(true);
  });

  it('accepts long formatted XML and JSON deliveries but rejects malformed XML and wrong-IV ciphertext', () => {
    const client = new VirtualPayment(config);
    const long = `<xml>\n  <MsgType>event</MsgType>\n  <Event>xpay_goods_deliver_notify</Event>\n  <Env>0</Env>\n  <OpenId>openid</OpenId>\n  <OutTradeNo>order_123</OutTradeNo>\n  <GoodsInfo>\n    <ProductId>membership-six-months</ProductId>\n    <Quantity>1</Quantity>\n    <OrigPrice>2800</OrigPrice>\n    <ActualPrice>2800</ActualPrice>\n    <Attach>order_123</Attach>\n    <Note>${'x'.repeat(700)}</Note>\n  </GoodsInfo>\n</xml>`;
    const encrypted = encrypt(long);
    expect(client.readNotification(event(encrypted)).message.GoodsInfo.Note).toHaveLength(700);
    const json = JSON.stringify({
      MsgType: 'event',
      Event: 'xpay_goods_deliver_notify',
      Env: 0,
      OpenId: 'openid',
      OutTradeNo: 'order_123',
      GoodsInfo: {
        ProductId: 'membership-six-months',
        Quantity: 1,
        OrigPrice: 2800,
        ActualPrice: 2800,
        Attach: 'order_123',
      },
    });
    expect(
      client.validateDelivery(client.readNotification(event(encrypt(json), 'json')).message, order),
    ).toBe(true);
    expect(() => client.readNotification(event(encrypt('<xml><A>bad</xml>')))).toThrow(
      'invalid message',
    );
    expect(() =>
      client.readNotification(event(encrypt('<xml><__proto__>bad</__proto__></xml>'))),
    ).toThrow('invalid message');
    const wrongIv = (() => {
      const bytes = Buffer.from(encrypted, 'base64');
      bytes[0] = bytes[0]! ^ 1;
      return bytes.toString('base64');
    })();
    expect(() => client.readNotification(event(wrongIv))).toThrow('invalid notification');
  });
});

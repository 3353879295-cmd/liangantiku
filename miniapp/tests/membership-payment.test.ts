/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unnecessary-type-assertion */
import { createRequire } from 'node:module';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { WechatPayment, configFromEnv } =
  require('../cloudfunctions/membership/lib/payment.js') as any;
describe('membership payment configuration', () => {
  it('fails closed while merchant secrets are absent', () => {
    expect(new WechatPayment(configFromEnv({})).available).toBe(false);
  });
  it('rejects an unsigned payment notification', () => {
    const client = new WechatPayment({
      enabled: true,
      appId: 'wx',
      mchId: 'm',
      merchantSerial: 's',
      privateKey: 'key',
      apiV3Key: 'a'.repeat(32),
      notifyUrl: 'https://example.test',
      platformCertificates: {},
    });
    expect(client.verifyHeaders({}, '{}')).toBe(false);
  });
  it('verifies the exact WeChat response/callback signing payload', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = new Date('2026-09-05T00:00:00.000Z');
    const client = new WechatPayment(
      {
        enabled: true,
        appId: 'wx',
        mchId: 'm',
        merchantSerial: 'merchant',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        apiV3Key: 'a'.repeat(32),
        notifyUrl: 'https://example.test',
        platformCertificates: {
          platform: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        },
      },
      undefined,
      () => now,
    );
    const body = '{"id":"notice"}';
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const nonce = 'nonce';
    const signature = createSign('RSA-SHA256')
      .update(`${timestamp}\n${nonce}\n${body}\n`)
      .sign(privateKey, 'base64');
    expect(
      client.verifyHeaders(
        {
          'wechatpay-timestamp': timestamp,
          'wechatpay-nonce': nonce,
          'wechatpay-serial': 'platform',
          'wechatpay-signature': signature,
        },
        body,
      ),
    ).toBe(true);
    expect(
      client.verifyHeaders(
        {
          'wechatpay-timestamp': timestamp,
          'wechatpay-nonce': nonce,
          'wechatpay-serial': 'platform',
          'wechatpay-signature': signature,
        },
        '{"id":"changed"}',
      ),
    ).toBe(false);
  });
  it('requires amount, app and payer identity from WeChat evidence', () => {
    const client = new WechatPayment({ mchId: 'm' });
    expect(
      client.verifyProof(
        {
          trade_state: 'SUCCESS',
          appid: 'wx',
          mchid: 'm',
          payer: { openid: 'other' },
          amount: { total: 2800, currency: 'CNY' },
        },
        { APPID: 'wx', OPENID: 'open' },
      ),
    ).toBe(false);
  });
});

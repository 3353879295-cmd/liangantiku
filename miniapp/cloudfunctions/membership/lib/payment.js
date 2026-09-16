'use strict';
/* global Buffer, process */
const crypto = require('node:crypto');
const https = require('node:https');
const { URL } = require('node:url');
const { AMOUNT } = require('./handler');
const request = (method, url, headers, body) =>
  new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
class WechatPayment {
  constructor(config, httpRequest = request, now = () => new Date()) {
    this.config = config;
    this.httpRequest = httpRequest;
    this.now = now;
    this.available = Boolean(
      config.enabled &&
      config.appId &&
      config.mchId &&
      config.merchantSerial &&
      config.privateKey &&
      config.apiV3Key &&
      config.notifyUrl &&
      config.platformCertificates &&
      Object.keys(config.platformCertificates).length &&
      Buffer.byteLength(config.apiV3Key, 'utf8') === 32,
    );
    this.validateConfiguration();
  }
  validateConfiguration() {
    if (!this.available) return;
    try {
      if (new URL(this.config.notifyUrl).protocol !== 'https:') throw new Error('HTTPS required');
      if (crypto.createPrivateKey(this.config.privateKey).asymmetricKeyType !== 'rsa')
        throw new Error('RSA required');
      for (const key of Object.values(this.config.platformCertificates)) {
        if (crypto.createPublicKey(key).asymmetricKeyType !== 'rsa')
          throw new Error('RSA required');
      }
    } catch {
      this.available = false;
    }
  }
  authorization(method, path, body) {
    const timestamp = Math.floor(this.now().getTime() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body || ''}\n`;
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(message)
      .sign(this.config.privateKey, 'base64');
    return {
      value: `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.config.merchantSerial}",signature="${signature}"`,
    };
  }
  async api(method, path, payload) {
    const body = payload ? JSON.stringify(payload) : '';
    const result = await this.httpRequest(
      method,
      `https://api.mch.weixin.qq.com${path}`,
      {
        Authorization: this.authorization(method, path, body).value,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'warehouse-practice-membership/1.0',
      },
      body,
    );
    const responseHeaders = Object.fromEntries(
      Object.entries(result.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    if (
      result.statusCode < 200 ||
      result.statusCode >= 300 ||
      !this.verifyHeaders(responseHeaders, result.body)
    )
      throw new Error('wechat API');
    return JSON.parse(result.body);
  }
  async createJsapi(order, openId) {
    const response = await this.api('POST', '/v3/pay/transactions/jsapi', {
      appid: this.config.appId,
      mchid: this.config.mchId,
      description: '保管员刷题半年会员',
      out_trade_no: order.order_id,
      notify_url: this.config.notifyUrl,
      amount: { total: AMOUNT, currency: 'CNY' },
      payer: { openid: openId },
    });
    if (typeof response.prepay_id !== 'string' || !response.prepay_id)
      throw new Error('missing prepay id');
    const timeStamp = Math.floor(this.now().getTime() / 1000).toString();
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const packageValue = `prepay_id=${response.prepay_id}`;
    const paySign = crypto
      .createSign('RSA-SHA256')
      .update(`${this.config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`)
      .sign(this.config.privateKey, 'base64');
    return { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign };
  }
  query(orderId) {
    return this.api(
      'GET',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${encodeURIComponent(this.config.mchId)}`,
    );
  }
  verifyHeaders(headers, body) {
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const signature = headers['wechatpay-signature'];
    const serial = headers['wechatpay-serial'];
    const certificates = this.config.platformCertificates || {};
    const certificate =
      typeof serial === 'string' && Object.hasOwn(certificates, serial)
        ? certificates[serial]
        : null;
    if (
      typeof timestamp !== 'string' ||
      !/^\d+$/.test(timestamp) ||
      typeof nonce !== 'string' ||
      !nonce ||
      typeof signature !== 'string' ||
      !signature ||
      !certificate ||
      Math.abs(Math.floor(this.now().getTime() / 1000) - Number(timestamp)) > 300
    )
      return false;
    return crypto
      .createVerify('RSA-SHA256')
      .update(`${timestamp}\n${nonce}\n${body}\n`)
      .verify(certificate, signature, 'base64');
  }
  decryptNotification(resource) {
    if (
      !resource ||
      resource.algorithm !== 'AEAD_AES_256_GCM' ||
      typeof resource.ciphertext !== 'string' ||
      typeof resource.nonce !== 'string'
    )
      throw new Error('invalid resource');
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAuthTag(encrypted.subarray(-16));
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
    return JSON.parse(
      Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString(
        'utf8',
      ),
    );
  }
  verifyProof(proof, context) {
    return Boolean(
      proof &&
      proof.trade_state === 'SUCCESS' &&
      proof.appid === context.APPID &&
      proof.appid === this.config.appId &&
      proof.mchid === this.config.mchId &&
      proof.payer &&
      proof.payer.openid === context.OPENID &&
      proof.amount &&
      proof.amount.total === AMOUNT &&
      proof.amount.currency === 'CNY' &&
      typeof proof.out_trade_no === 'string' &&
      proof.out_trade_no.length > 0 &&
      typeof proof.transaction_id === 'string' &&
      proof.transaction_id.length > 0 &&
      typeof proof.success_time === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        proof.success_time,
      ) &&
      Number.isFinite(Date.parse(proof.success_time)) &&
      Date.parse(proof.success_time) <= this.now().getTime() + 300000,
    );
  }
}
const configFromEnv = (env = process.env) => {
  let platformCertificates = {};
  try {
    platformCertificates = env.WX_PAY_PLATFORM_CERTIFICATES
      ? JSON.parse(env.WX_PAY_PLATFORM_CERTIFICATES)
      : {};
  } catch {
    // Invalid secret configuration leaves payment unavailable while membership checks work.
  }
  return {
    enabled: env.MEMBERSHIP_PAYMENT_ENABLED === 'true',
    appId: env.WX_APP_ID,
    mchId: env.WX_PAY_MCH_ID,
    merchantSerial: env.WX_PAY_MERCHANT_SERIAL,
    privateKey:
      env.WX_PAY_MERCHANT_PRIVATE_KEY && env.WX_PAY_MERCHANT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    apiV3Key: env.WX_PAY_API_V3_KEY,
    notifyUrl: env.WX_PAY_NOTIFY_URL,
    platformCertificates,
  };
};
module.exports = { WechatPayment, configFromEnv };

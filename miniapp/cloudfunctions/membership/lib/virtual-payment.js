'use strict';
/* global Buffer, process */
const crypto = require('node:crypto');
const https = require('node:https');
const { URLSearchParams } = require('node:url');

const AMOUNT = 2800;
const LIMIT = 512 * 1024;
const PLATFORM_CODE_MIN = -999999999;
const PLATFORM_CODE_MAX = 999999999;
const PLATFORM_ORDER_NOT_FOUND_CODE = 268490002;
const MAX_PLATFORM_ERRMSG = 256;
// Intentionally empty until WeChat documents and a production query captures an exact,
// reviewed errcode.  HTTP status is never payment/closure evidence.
const SAFE_TERMINAL_PLATFORM_CODES = Object.freeze({});
const terminalStateForPlatformCode = (code, mapping = SAFE_TERMINAL_PLATFORM_CODES) => {
  const state = mapping && mapping[code];
  return state === 'CLOSED' || state === 'FAILED' ? state : null;
};
const boundedPlatformCode = (code) =>
  Number.isSafeInteger(code) && code >= PLATFORM_CODE_MIN && code <= PLATFORM_CODE_MAX
    ? code
    : null;
const safeRead = (value, key) => {
  try {
    return value && value[key];
  } catch {
    return null;
  }
};
const platformDetailFor = (code, response) => {
  if (code !== PLATFORM_ORDER_NOT_FOUND_CODE) return null;
  const errmsg = safeRead(response, 'errmsg');
  if (typeof errmsg !== 'string' || errmsg.length === 0 || errmsg.length > MAX_PLATFORM_ERRMSG)
    return 'UNRECOGNIZED';
  const mentionsOrder = /(?:order(?:[_\s-]?id)?|订单(?:号)?)/i.test(errmsg);
  const explicitlyAbsent = /(?:not\s+found|does\s+not\s+exist|不存在|未找到|无此订单)/i.test(
    errmsg,
  );
  if (mentionsOrder && explicitlyAbsent) return 'ORDER_NOT_FOUND_EXPLICIT';
  if (/openid/i.test(errmsg)) return 'OPENID_FIELD_ERROR';
  if (/(?:\benv\b|环境)/i.test(errmsg)) return 'ENV_FIELD_ERROR';
  if (/(?:order[_\s-]?id|订单号)/i.test(errmsg)) return 'ORDER_ID_FIELD_ERROR';
  if (/(?:signature|签名)/i.test(errmsg)) return 'SIGNATURE_FIELD_ERROR';
  return 'UNRECOGNIZED';
};
const platformRidFor = (response) => {
  const normalize = (value) => {
    if (typeof value !== 'string') return null;
    const match = /^([a-f\d]{8}(?:-[a-f\d]{8}){2})$/i.exec(value);
    return match ? match[1].toLowerCase() : null;
  };
  const direct = normalize(safeRead(response, 'rid'));
  if (direct) return direct;
  const errmsg = safeRead(response, 'errmsg');
  if (typeof errmsg !== 'string' || errmsg.length === 0 || errmsg.length > MAX_PLATFORM_ERRMSG)
    return null;
  const match = /(?:^|[^a-z\d_])rid\s*[:=]\s*([a-f\d]{8}(?:-[a-f\d]{8}){2})(?![a-z\d_-])/i.exec(
    errmsg,
  );
  return match ? match[1].toLowerCase() : null;
};
const plainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const required = (value, max = 512) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const safeEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex');
const sha1 = (values) => crypto.createHash('sha1').update(values.sort().join('')).digest('hex');
const diagnosticError = (code, details = {}, message = 'virtual payment failure') => {
  const error = new Error(message);
  Object.defineProperty(error, 'diagnostic', {
    value: Object.freeze({ code, ...details }),
    enumerable: false,
  });
  return error;
};
const request = (method, url, headers, body) =>
  new Promise((resolve, reject) => {
    let deadline;
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(deadline);
      callback(value);
    };
    const fail = (error) => settle(reject, error);
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > LIMIT) {
          const error = new Error('response too large');
          fail(error);
          return req.destroy(error);
        }
        chunks.push(chunk);
      });
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('response aborted')));
      res.on('close', () => {
        if (res.complete === false) fail(new Error('incomplete response'));
      });
      res.on('end', () => {
        if (res.complete === false) return fail(new Error('incomplete response'));
        settle(resolve, {
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', fail);
    if (!settled)
      deadline = globalThis.setTimeout(() => {
        const error = new Error('timeout');
        fail(error);
        req.destroy(error);
      }, 8000);
    if (body !== undefined && body !== null)
      req.setHeader('Content-Length', Buffer.byteLength(body));
    req.end(body);
  });
const parseJson = (body) => {
  if (typeof body !== 'string' || Buffer.byteLength(body) > LIMIT)
    throw new Error('invalid response');
  return JSON.parse(body, (key, value) => {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor')
      throw new Error('invalid response');
    return value;
  });
};
const parseXml = (input) => {
  if (
    typeof input !== 'string' ||
    Buffer.byteLength(input) > LIMIT ||
    /<!DOCTYPE|<!ENTITY|<\?xml|<!--/i.test(input)
  )
    throw new Error('invalid message');
  const token = /<!\[CDATA\[([\s\S]*?)\]\]>|<[^>]*>|[^<]+/g;
  const stack = [];
  let root;
  let match;
  let count = 0;
  let end = 0;
  while ((match = token.exec(input))) {
    if (match.index !== end) throw new Error('invalid message');
    end = token.lastIndex;
    if (++count > 256) throw new Error('invalid message');
    const raw = match[0];
    if (match[1] !== undefined || !raw.startsWith('<')) {
      if (!stack.length) {
        if (!String(match[1] ?? raw).trim()) continue;
        throw new Error('invalid message');
      }
      if (match[1] !== undefined) stack.at(-1).parts.push(match[1]);
      else {
        if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(raw)) throw new Error('invalid message');
        stack
          .at(-1)
          .parts.push(
            raw.replace(
              /&(amp|lt|gt|quot|apos);/g,
              (_item, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity],
            ),
          );
      }
    } else if (raw.startsWith('</')) {
      const name = raw.slice(2, -1);
      const node = stack.pop();
      if (!node || node.name !== name) throw new Error('invalid message');
      const hasChildren = Object.keys(node.value).length > 0;
      const hasText = node.parts.some((part) => part.trim());
      if (hasChildren && hasText) throw new Error('invalid message');
      const value = hasChildren ? node.value : node.parts.join('');
      if (stack.length) {
        const parent = stack.at(-1);
        if (Object.hasOwn(parent.value, node.name)) throw new Error('invalid message');
        parent.value[node.name] = value;
      } else if (root) throw new Error('invalid message');
      else root = { [node.name]: value };
    } else {
      const name = raw.slice(1, -1);
      if (
        !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
        ['__proto__', 'prototype', 'constructor'].includes(name) ||
        stack.length >= 12
      )
        throw new Error('invalid message');
      stack.push({ name, value: {}, parts: [] });
    }
  }
  if (stack.length || !root || !Object.hasOwn(root, 'xml') || !/^\s*$/.test(input.slice(end)))
    throw new Error('invalid message');
  return root.xml;
};
const messageObject = (input) => {
  const parsed = parseJson(input);
  if (!plainObject(parsed)) throw new Error('invalid message');
  return parsed;
};
const freezeMessage = (message) => {
  const pending = [message];
  while (pending.length) {
    const item = pending.pop();
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      pending.push(...Object.values(item));
      Object.freeze(item);
    }
  }
};

class VirtualPayment {
  constructor(config, httpRequest = request, now = () => new Date()) {
    this.kind = 'virtual';
    this.config = config;
    this.httpRequest = httpRequest;
    this.now = now;
    this.proofs = new WeakSet();
    this.notifications = new WeakSet();
    this.token = null;
    this.terminalPlatformCodes = config.terminalPlatformCodes || SAFE_TERMINAL_PLATFORM_CODES;
    this.canReconcile = this.completeConfig();
    this.messageReady = Boolean(
      required(config.appId) && required(config.messageToken) && this.aesKey(),
    );
    // A notification endpoint is an additional settlement signal, not a prerequisite
    // for starting or reconciling a payment.  Keeping these independent means a
    // missing callback credential cannot silently turn the purchase entry point off.
    // readNotification remains fail-closed on messageReady below.
    this.available = Boolean(config.enabled && this.canReconcile);
  }
  completeConfig() {
    return ['appId', 'appSecret', 'offerId', 'appKey', 'productId'].every((key) =>
      required(this.config[key]),
    );
  }
  aesKey() {
    if (!required(this.config.messageAesKey) || this.config.messageAesKey.length !== 43)
      return null;
    try {
      const key = Buffer.from(`${this.config.messageAesKey}=`, 'base64');
      return key.length === 32 ? key : null;
    } catch {
      return null;
    }
  }
  async callRaw(method, path, body, httpOperation = 'other') {
    const url = `https://api.weixin.qq.com${path}`;
    let result;
    try {
      result = await this.httpRequest(
        method,
        url,
        { Accept: 'application/json', 'Content-Type': 'application/json' },
        body,
      );
    } catch {
      throw diagnosticError('ORDER_HTTP_TRANSPORT');
    }
    if (!result || result.statusCode < 200 || result.statusCode >= 300) {
      // Gateways sometimes return WeChat's JSON error body with a non-2xx status (notably 412).
      // Read only the bounded numeric code; never retain or log the body/message.
      let platformCode = null;
      let platformDetail = null;
      let platformRid = null;
      try {
        const parsed = parseJson(result?.body);
        const parsedPlatformCode = plainObject(parsed) ? boundedPlatformCode(parsed.errcode) : null;
        if (parsedPlatformCode !== null && parsedPlatformCode !== 0) {
          platformCode = parsedPlatformCode;
          platformDetail = platformDetailFor(parsedPlatformCode, parsed);
          platformRid = platformRidFor(parsed);
        }
      } catch {
        // The HTTP status remains diagnostic-only when the body is malformed.
      }
      throw diagnosticError('ORDER_HTTP_STATUS', {
        httpStatus: Number.isSafeInteger(result?.statusCode) ? result.statusCode : null,
        ...(platformCode === null ? {} : { platformCode }),
        ...(platformDetail === null ? {} : { platformDetail }),
        ...(platformRid === null ? {} : { platformRid }),
        httpOperation: ['token', 'query', 'provide'].includes(httpOperation)
          ? httpOperation
          : 'other',
      });
    }
    return result;
  }
  async call(method, path, body, jsonCode = 'ORDER_RESPONSE_JSON', httpOperation = 'other') {
    try {
      return parseJson((await this.callRaw(method, path, body, httpOperation)).body);
    } catch (error) {
      if (error?.diagnostic) throw error;
      throw diagnosticError(jsonCode);
    }
  }
  async accessToken() {
    if (this.token && this.token.expiresAt > this.now().getTime()) return this.token.value;
    const response = await this.call(
      'POST',
      '/cgi-bin/stable_token',
      JSON.stringify({
        grant_type: 'client_credential',
        appid: this.config.appId,
        secret: this.config.appSecret,
        force_refresh: false,
      }),
      'ORDER_TOKEN_RESPONSE',
      'token',
    );
    if (plainObject(response) && Number.isSafeInteger(response.errcode) && response.errcode !== 0)
      throw diagnosticError('ORDER_TOKEN_PLATFORM', { platformCode: response.errcode });
    if (
      !plainObject(response) ||
      !required(response.access_token) ||
      !Number.isFinite(response.expires_in) ||
      response.expires_in < 60
    )
      throw diagnosticError('ORDER_TOKEN_SHAPE');
    this.token = {
      value: response.access_token,
      expiresAt: this.now().getTime() + (response.expires_in - 30) * 1000,
    };
    return this.token.value;
  }
  async codeSession(loginCode, context) {
    if (
      !required(loginCode, 1024) ||
      !context ||
      context.APPID !== this.config.appId ||
      !required(context.OPENID)
    )
      throw new Error('invalid login');
    const query = new URLSearchParams({
      appid: this.config.appId,
      secret: this.config.appSecret,
      js_code: loginCode,
      grant_type: 'authorization_code',
    });
    const response = await this.call('GET', `/sns/jscode2session?${query.toString()}`);
    if (
      !plainObject(response) ||
      response.openid !== context.OPENID ||
      !required(response.session_key)
    )
      throw new Error('invalid login');
    return response.session_key;
  }
  async createPayment(order, context, loginCode) {
    if (
      !this.available ||
      !plainObject(order) ||
      order.app_id !== this.config.appId ||
      order.open_id !== context?.OPENID ||
      order.amount !== AMOUNT ||
      order.payment_provider !== 'virtual' ||
      order.product_id !== this.config.productId ||
      !required(order.order_id)
    )
      throw new Error('invalid order');
    const sessionKey = await this.codeSession(loginCode, context);
    const sign = {
      offerId: this.config.offerId,
      buyQuantity: 1,
      env: 0,
      currencyType: 'CNY',
      productId: order.product_id,
      goodsPrice: AMOUNT,
      outTradeNo: order.order_id,
      attach: order.order_id,
    };
    const signData = JSON.stringify(sign);
    return {
      mode: 'short_series_goods',
      signData,
      paySig: hmac(this.config.appKey, `requestVirtualPayment&${signData}`),
      signature: hmac(sessionKey, signData),
    };
  }
  async query(orderId, order) {
    if (
      !this.canReconcile ||
      !plainObject(order) ||
      orderId !== order.order_id ||
      !required(orderId) ||
      !required(order.open_id) ||
      order.app_id !== this.config.appId ||
      order.amount !== AMOUNT ||
      order.payment_provider !== 'virtual' ||
      order.product_id !== this.config.productId
    )
      throw diagnosticError('ORDER_LOCAL_VALIDATION');
    const body = JSON.stringify({ openid: order.open_id, env: 0, order_id: orderId });
    const token = await this.accessToken();
    let response;
    try {
      response = await this.call(
        'POST',
        `/xpay/query_order?access_token=${encodeURIComponent(token)}&pay_sig=${hmac(this.config.appKey, `/xpay/query_order&${body}`)}`,
        body,
        'ORDER_QUERY_JSON',
        'query',
      );
    } catch (error) {
      const platformCode = boundedPlatformCode(error?.diagnostic?.platformCode);
      // 268490002 is a request-field error in the published contract.  An HTTP
      // response or errmsg cannot prove that a merchant order was never charged.
      const terminalState =
        platformCode === null ||
        platformCode === 0 ||
        platformCode === PLATFORM_ORDER_NOT_FOUND_CODE
          ? null
          : terminalStateForPlatformCode(platformCode, this.terminalPlatformCodes);
      if (!terminalState) throw error;
      const proof = Object.freeze({
        out_trade_no: orderId,
        appid: order.app_id,
        payer: Object.freeze({ openid: order.open_id }),
        amount: Object.freeze({ total: AMOUNT, currency: 'CNY' }),
        trade_state: terminalState,
        platform_status: platformCode,
      });
      this.proofs.add(proof);
      return proof;
    }
    if (!plainObject(response) || !Number.isSafeInteger(response.errcode))
      throw diagnosticError('ORDER_QUERY_SHAPE', {}, 'virtual query');
    if (response.errcode !== 0) {
      const platformCode = boundedPlatformCode(response.errcode);
      const platformDetail =
        platformCode === null ? null : platformDetailFor(response.errcode, response);
      const platformRid = platformCode === null ? null : platformRidFor(response);
      const terminalState =
        platformCode === null || platformCode === PLATFORM_ORDER_NOT_FOUND_CODE
          ? null
          : terminalStateForPlatformCode(response.errcode, this.terminalPlatformCodes);
      if (terminalState) {
        const proof = Object.freeze({
          out_trade_no: orderId,
          appid: order.app_id,
          payer: Object.freeze({ openid: order.open_id }),
          amount: Object.freeze({ total: AMOUNT, currency: 'CNY' }),
          trade_state: terminalState,
          platform_status: response.errcode,
        });
        this.proofs.add(proof);
        return proof;
      }
      throw diagnosticError(
        platformCode === null
          ? 'ORDER_PLATFORM_ERROR'
          : `ORDER_PLATFORM_ERROR[errcode=${platformCode}]`,
        platformCode === null
          ? {}
          : {
              platformCode,
              ...(platformDetail ? { platformDetail } : {}),
              ...(platformRid ? { platformRid } : {}),
            },
        'virtual query',
      );
    }
    if (!plainObject(response.order))
      throw diagnosticError('ORDER_QUERY_SHAPE', {}, 'virtual query');
    const remote = response.order;
    if (
      remote.order_id !== orderId ||
      remote.env_type !== 1 ||
      ![0, 7].includes(remote.order_type) ||
      remote.order_fee !== AMOUNT
    )
      throw diagnosticError(
        'ORDER_QUERY_IDENTITY',
        {
          orderMatch: remote.order_id === orderId,
          environmentMatch: remote.env_type === 1,
          amountMatch: remote.order_fee === AMOUNT,
        },
        'virtual query',
      );
    const state = remote.status;
    let tradeState;
    if ([2, 3, 4].includes(state)) tradeState = 'SUCCESS';
    // 0 means platform initialization has not succeeded. It is neither a
    // successful platform order nor NOTPAY evidence, so it must not authorize
    // a second bridge invocation. 7/9/10 likewise stay blocked.
    else if (state === 0) tradeState = 'INITIALIZED';
    else if (state === 1) tradeState = 'NOTPAY';
    else if (state === 6) tradeState = 'CLOSED';
    else if ([5, 8].includes(state) && remote.refund_fee === AMOUNT) tradeState = 'REFUNDED';
    else
      throw diagnosticError(
        'ORDER_QUERY_STATE',
        { state: Number.isSafeInteger(state) ? state : null },
        'virtual order state',
      );
    const proof = {
      out_trade_no: orderId,
      appid: order.app_id,
      payer: { openid: order.open_id },
      amount: { total: AMOUNT, currency: 'CNY' },
      trade_state: tradeState,
      platform_status: state,
      platform_env: remote.env_type,
      platform_order_type: remote.order_type,
    };
    if (tradeState === 'SUCCESS' || tradeState === 'REFUNDED') {
      if (
        remote.paid_fee !== AMOUNT ||
        // query_order documents coupon_fee as absent for this API response in some
        // platform versions.  An omitted field is therefore not payment evidence,
        // while any supplied value must still prove that no coupon altered the price.
        (remote.coupon_fee !== undefined && remote.coupon_fee !== 0) ||
        (tradeState === 'SUCCESS' &&
          (remote.left_fee !== AMOUNT ||
            (remote.refund_fee !== undefined && remote.refund_fee !== 0))) ||
        !required(remote.wx_order_id) ||
        !Number.isSafeInteger(remote.paid_time) ||
        remote.paid_time <= 0
      )
        throw diagnosticError(
          'ORDER_QUERY_SETTLEMENT',
          {
            amountMatch: remote.paid_fee === AMOUNT,
            refundMatch:
              tradeState !== 'SUCCESS' ||
              (remote.left_fee === AMOUNT &&
                (remote.refund_fee === undefined || remote.refund_fee === 0)),
          },
          'virtual query',
        );
      proof.transaction_id = remote.wx_order_id;
      proof.platform_wx_order_id = remote.wx_order_id;
      proof.success_time = new Date(remote.paid_time * 1000).toISOString();
    }
    Object.freeze(proof.payer);
    Object.freeze(proof.amount);
    Object.freeze(proof);
    this.proofs.add(proof);
    return proof;
  }
  verifyProof(proof, context) {
    return Boolean(
      this.proofs.has(proof) &&
      context &&
      proof.appid === context.APPID &&
      proof.payer.openid === context.OPENID &&
      ['SUCCESS', 'REFUNDED'].includes(proof.trade_state),
    );
  }
  async provideGoods(order) {
    if (!this.canReconcile || !plainObject(order) || !required(order.order_id))
      throw new Error('invalid order');
    const token = await this.accessToken();
    const path = '/xpay/notify_provide_goods';
    const body = JSON.stringify({ order_id: order.order_id, env: 0 });
    const result = await this.callRaw(
      'POST',
      `${path}?access_token=${encodeURIComponent(token)}&pay_sig=${hmac(this.config.appKey, `${path}&${body}`)}`,
      body,
      'provide',
    );
    if (!result.body) return {};
    const response = parseJson(result.body);
    if (plainObject(response) && Number.isSafeInteger(response.errcode) && response.errcode !== 0) {
      const platformCode = boundedPlatformCode(response.errcode);
      throw diagnosticError('ORDER_PLATFORM_ERROR', platformCode === null ? {} : { platformCode });
    }
    if (!plainObject(response) || response.errcode !== 0) throw new Error('provide goods');
    return response;
  }
  readNotification(event) {
    const query = event?.queryStringParameters ?? event?.query ?? {};
    if (!plainObject(query) || !this.messageReady) throw new Error('invalid notification');
    const timestamp = query.timestamp;
    const nonce = query.nonce;
    if (!required(timestamp) || !required(nonce)) throw new Error('invalid notification');
    if (event?.httpMethod === 'GET') {
      if (
        !safeEqual(sha1([this.config.messageToken, timestamp, nonce]), query.signature) ||
        !required(query.echostr, LIMIT)
      )
        throw new Error('invalid notification');
      return { kind: 'handshake', body: query.echostr };
    }
    if (
      event?.httpMethod !== 'POST' ||
      query.encrypt_type !== 'aes' ||
      !required(query.msg_signature)
    )
      throw new Error('invalid notification');
    const raw = event.rawBody ?? event.body;
    if (typeof raw !== 'string') throw new Error('invalid notification');
    const source = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
    if (Buffer.byteLength(source) > LIMIT) throw new Error('invalid notification');
    const outerFormat = /^\s*</.test(source) ? 'xml' : 'json';
    const outer = outerFormat === 'xml' ? parseXml(source) : messageObject(source);
    const encrypted = outer.Encrypt;
    if (
      !required(encrypted, Math.ceil((LIMIT / 3) * 4)) ||
      !safeEqual(sha1([this.config.messageToken, timestamp, nonce, encrypted]), query.msg_signature)
    )
      throw new Error('invalid notification');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted) || encrypted.length % 4 !== 0)
      throw new Error('invalid notification');
    const cipher = Buffer.from(encrypted, 'base64');
    if (!cipher.length || cipher.length % 16 !== 0 || cipher.length > LIMIT)
      throw new Error('invalid notification');
    let decrypted;
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        this.aesKey(),
        this.aesKey().subarray(0, 16),
      );
      decipher.setAutoPadding(false);
      decrypted = Buffer.concat([decipher.update(cipher), decipher.final()]);
    } catch {
      throw new Error('invalid notification');
    }
    const padding = decrypted.at(-1);
    if (
      !padding ||
      padding > 32 ||
      padding > decrypted.length ||
      !decrypted.subarray(-padding).every((byte) => byte === padding)
    )
      throw new Error('invalid notification');
    const payload = decrypted.subarray(0, -padding);
    if (payload.length < 20) throw new Error('invalid notification');
    const length = payload.readUInt32BE(16);
    if (length > LIMIT || payload.length !== 20 + length + Buffer.byteLength(this.config.appId))
      throw new Error('invalid notification');
    const data = payload.subarray(20, 20 + length).toString('utf8');
    if (payload.subarray(20 + length).toString('utf8') !== this.config.appId)
      throw new Error('invalid notification');
    const format = /^\s*</.test(data) ? 'xml' : 'json';
    const message = format === 'xml' ? parseXml(data) : messageObject(data);
    freezeMessage(message);
    this.notifications.add(message);
    return { kind: 'notification', message, format };
  }
  refundProof(message, order) {
    if (
      !this.notifications.has(message) ||
      !plainObject(order) ||
      order.payment_provider !== 'virtual' ||
      order.app_id !== this.config.appId ||
      order.product_id !== this.config.productId ||
      order.amount !== AMOUNT ||
      order.currency !== 'CNY' ||
      message.MsgType !== 'event' ||
      message.Event !== 'xpay_refund_notify' ||
      ![0, '0'].includes(message.RetCode) ||
      ![AMOUNT, String(AMOUNT)].includes(message.RefundFee) ||
      message.OpenId !== order.open_id ||
      message.MchOrderId !== order.order_id ||
      !required(message.WxOrderId) ||
      !required(message.WxRefundId) ||
      (order.transaction_id && order.transaction_id !== message.WxOrderId)
    )
      throw new Error('invalid refund');
    const proof = Object.freeze({
      out_trade_no: order.order_id,
      appid: order.app_id,
      payer: Object.freeze({ openid: order.open_id }),
      amount: Object.freeze({ total: AMOUNT, currency: 'CNY' }),
      trade_state: 'REFUNDED',
      transaction_id: message.WxOrderId,
      platform_wx_order_id: message.WxOrderId,
      platform_env: 1,
      platform_order_type: 8,
      platform_status: 8,
      refund_transaction_id: message.WxRefundId,
      ...(required(message.MchRefundId) ? { merchant_refund_id: message.MchRefundId } : {}),
    });
    this.proofs.add(proof);
    return proof;
  }
  validateDelivery(message, order) {
    const goods = message?.GoodsInfo;
    return Boolean(
      plainObject(message) &&
      plainObject(order) &&
      message.MsgType === 'event' &&
      message.Event === 'xpay_goods_deliver_notify' &&
      (message.Env === '0' || message.Env === 0) &&
      message.OpenId === order.open_id &&
      message.OutTradeNo === order.order_id &&
      plainObject(goods) &&
      goods.Attach === order.order_id &&
      goods.ProductId === order.product_id &&
      Number(goods.Quantity) === 1 &&
      Number(goods.OrigPrice) === AMOUNT &&
      Number(goods.ActualPrice) === AMOUNT,
    );
  }
}
const virtualConfigFromEnv = (env = process.env) => ({
  enabled: env.MEMBERSHIP_PAYMENT_ENABLED === 'true',
  appId: env.WX_APP_ID,
  appSecret: env.WX_APP_SECRET,
  offerId: env.WX_VIRTUAL_OFFER_ID,
  appKey: env.WX_VIRTUAL_APP_KEY,
  productId: env.WX_VIRTUAL_PRODUCT_ID,
  messageToken: env.WX_MESSAGE_TOKEN,
  messageAesKey: env.WX_MESSAGE_AES_KEY,
});
module.exports = {
  VirtualPayment,
  virtualConfigFromEnv,
  hmac,
  request,
  SAFE_TERMINAL_PLATFORM_CODES,
  terminalStateForPlatformCode,
};

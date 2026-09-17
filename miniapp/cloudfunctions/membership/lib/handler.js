'use strict';

const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const nodeConsole = require('node:console');
const { publicFailure } = require('./diagnostics');
const {
  SAFE_TERMINAL,
  hasReliableTerminalEvidence,
  hasReleasedTestHold,
  hasCancelledPurchase,
  isUnresolved,
  isReconcilable,
  projectedOrder,
} = require('./order-state');
const FREE_LIMIT = 3;
const AMOUNT = 2800;
const SHANGHAI = 'Asia/Shanghai';
const MEMBER_FEATURES = new Set(['fullPractice', 'memberFeature']);
class MembershipError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (error) => {
  let businessCode = null;
  try {
    if (error instanceof MembershipError && typeof error.code === 'string')
      businessCode = error.code;
  } catch {
    // A hostile error must not replace the normalized failure response.
  }
  return publicFailure(error, businessCode);
};
const hashKey = (appId, openId) =>
  crypto.createHash('sha256').update(`${appId}:${openId}`).digest('hex');
// A payment-only cache namespace, never an authorization credential or raw identity.
const paymentAccountScope = (context) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(['membership-payment-scope-v1', context.APPID, context.OPENID]))
    .digest('hex');
const matchesPaymentAccountScope = (expected, context) =>
  typeof expected === 'string' &&
  /^[a-f\d]{64}$/.test(expected) &&
  crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(paymentAccountScope(context), 'hex'),
  );
const PAYMENT_ACTIONS = new Set([
  'createOrder',
  'resumePayment',
  'markPaymentStarting',
  'markPaymentUnknown',
  'getOrder',
  'recoverOrders',
  'cancelPayment',
]);
const iso = (now) => (now instanceof Date ? now : new Date(now)).toISOString();
const dateInShanghai = (now) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const paymentUnavailableReason = (payment, context) => {
  if (!payment) return 'MISSING_CONFIGURATION';
  if (payment.config?.enabled === false) return 'DISABLED';
  if (payment.config?.appId && context?.APPID && payment.config.appId !== context.APPID)
    return 'APP_ID_MISMATCH';
  if (
    payment.config &&
    ['appId', 'appSecret', 'offerId', 'appKey', 'productId'].some((key) => !payment.config[key])
  )
    return 'MISSING_CONFIGURATION';
  return null;
};
const status = (entitlement, usage, now, paymentAvailable, unavailableReason = null) => {
  const timestamp = iso(now);
  const date = dateInShanghai(new Date(timestamp));
  const isMember = Boolean(entitlement && entitlement.expires_at > timestamp);
  const used = usage && usage.free_date === date ? usage.free_used : 0;
  return {
    isMember,
    startsAt: isMember ? entitlement.starts_at : null,
    expiresAt: isMember ? entitlement.expires_at : null,
    freeUsed: used,
    freeRemaining: Math.max(0, FREE_LIMIT - used),
    freeLimit: FREE_LIMIT,
    freeDate: date,
    serverTime: timestamp,
    paymentAvailable,
    ...(paymentAvailable || !unavailableReason
      ? {}
      : { paymentUnavailableReason: unavailableReason }),
  };
};
const addMonthsShanghai = (from, count = 6) => {
  const d = new Date(from);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  let year = get('year');
  let month = get('month') + count;
  const day = get('day');
  year += Math.floor((month - 1) / 12);
  month = ((month - 1) % 12) + 1;
  const finalDay = Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate());
  // Preserve the local Shanghai wall-clock time, including the common 23:59 expiration case.
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: SHANGHAI,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const value = (type) => Number(time.find((part) => part.type === type).value);
  return new Date(
    Date.UTC(year, month - 1, finalDay, value('hour') - 8, value('minute'), value('second')),
  ).toISOString();
};
const renewalBase = (entitlement) => {
  if (entitlement && entitlement.renewal_base !== undefined) return entitlement.renewal_base;
  return entitlement
    ? { starts_at: entitlement.starts_at, expires_at: entitlement.expires_at }
    : null;
};
const replayRenewals = (base, payments) => {
  let startsAt = base ? base.starts_at : null;
  let expiresAt = base ? base.expires_at : null;
  for (const payment of payments) {
    if (payment.refunded) continue;
    // paid_at is immutable payment evidence. effective_at is the authoritative settlement
    // clock: a delayed callback after expiry must renew from settlement time, not old payment time.
    const effectiveAt = payment.effective_at || payment.settled_at || payment.paid_at;
    const active = expiresAt && new Date(expiresAt).valueOf() > new Date(effectiveAt).valueOf();
    const from = active ? expiresAt : effectiveAt;
    startsAt = active ? startsAt : effectiveAt;
    expiresAt = addMonthsShanghai(from);
  }
  return { starts_at: startsAt, expires_at: expiresAt };
};
const validId = (value, max = 128) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  /^[A-Za-z0-9_-]+$/.test(value);
const validQuestions = (ids) =>
  Array.isArray(ids) &&
  ids.length >= 1 &&
  ids.length <= 10 &&
  ids.every((id) => typeof id === 'string' && id.trim() && id.length <= 128) &&
  new Set(ids).size === ids.length;
const publicOrder = (order) => ({
  orderId: order.order_id,
  status: order.status,
  amount: order.amount,
  paidAt: order.paid_at || null,
  ...(hasCancelledPurchase(order) ? { purchaseCancelled: true } : {}),
});
const canResumeVirtualPayment = (order, payment, context) =>
  Boolean(
    order &&
    !hasReleasedTestHold(order) &&
    !hasCancelledPurchase(order) &&
    payment?.kind === 'virtual' &&
    order.account_key &&
    order.app_id === context?.APPID &&
    order.open_id === context?.OPENID &&
    order.payment_provider === 'virtual' &&
    order.product_id === payment.config.productId &&
    order.amount === AMOUNT &&
    order.currency === 'CNY',
  );
const assertCancellableVirtualOrder = (order, accountKey, context) => {
  if (!order || order.account_key !== accountKey) throw new MembershipError('ORDER_NOT_FOUND');
  if (
    order.payment_provider !== 'virtual' ||
    order.app_id !== context.APPID ||
    order.open_id !== context.OPENID
  )
    throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
};
const bridgeAttemptHash = (value) =>
  typeof value === 'string' ? crypto.createHash('sha256').update(value).digest('hex') : null;
const createBridgeAttempt = () => crypto.randomBytes(32).toString('base64url');
const validBridgeAttempt = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const sameBridgeAttempt = (candidate, storedHash) => {
  const computed = bridgeAttemptHash(candidate);
  if (
    typeof computed !== 'string' ||
    typeof storedHash !== 'string' ||
    !/^[a-f\d]{64}$/i.test(storedHash)
  )
    return false;
  const left = Buffer.from(computed, 'hex');
  const right = Buffer.from(storedHash, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const paymentFingerprint = (payment) => {
  if (
    !payment ||
    typeof payment !== 'object' ||
    payment.mode !== 'short_series_goods' ||
    typeof payment.signData !== 'string' ||
    payment.signData.length === 0 ||
    payment.signData.length > 65536 ||
    ![payment.paySig, payment.signature].every(
      (value) => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value),
    )
  )
    return null;
  // Keep the field order explicit and exclude unrecognized properties so the
  // digest is a stable protocol binding rather than a serialization accident.
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([payment.mode, payment.signData, payment.paySig, payment.signature]))
    .digest('hex');
};
const samePaymentFingerprint = (payment, storedFingerprint) => {
  const candidate = paymentFingerprint(payment);
  if (
    typeof candidate !== 'string' ||
    typeof storedFingerprint !== 'string' ||
    !/^[a-f\d]{64}$/i.test(storedFingerprint)
  )
    return false;
  return crypto.timingSafeEqual(
    Buffer.from(candidate, 'hex'),
    Buffer.from(storedFingerprint, 'hex'),
  );
};
const clearPointer = async (tx, order) => {
  // Older stores/tests may not have acquired the account pointer yet.  Absence of that
  // optional optimization must not affect settlement atomicity.
  if (typeof tx.getPendingPurchase !== 'function' || typeof tx.savePendingPurchase !== 'function')
    return;
  const pointer = await tx.getPendingPurchase(order.account_key);
  if (pointer?.pending_order_id === order.order_id)
    await tx.savePendingPurchase(order.account_key, null);
};
const paymentLockId = (appid, env, wxOrderId) =>
  `v1:${crypto.createHash('sha256').update(`${appid}:${env}:${wxOrderId}`).digest('hex')}`;

// Signing is intentionally outside the transaction because it exchanges a one-time login code.
// The second transaction binds exactly that signed payload to the still-unclaimed PREPARED order.
const authorizePreparedBridge = async (store, payment, order, context, loginCode, timestamp) => {
  if (order.status !== 'PREPARED' || hasReleasedTestHold(order) || hasCancelledPurchase(order))
    return { order, canStartPayment: false };
  const signedPayment = await payment.createPayment(order, context, loginCode);
  const fingerprint = paymentFingerprint(signedPayment);
  if (!fingerprint) throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
  const bridgeAttempt = createBridgeAttempt();
  const expiresAt = new Date(new Date(timestamp).valueOf() + 120000).toISOString();
  const current = await store.transaction(async (tx) => {
    const latest = await tx.getOrder(order.order_id);
    if (
      !latest ||
      latest.status !== 'PREPARED' ||
      hasReleasedTestHold(latest) ||
      hasCancelledPurchase(latest)
    )
      return latest || order;
    const next = {
      ...latest,
      bridge_attempt_hash: bridgeAttemptHash(bridgeAttempt),
      bridge_attempt_expires_at: expiresAt,
      bridge_payment_fingerprint: fingerprint,
      bridge_authorized_at: iso(timestamp),
      updated_at: iso(timestamp),
    };
    await tx.saveOrder(latest.order_id, next);
    return next;
  });
  return current?.status === 'PREPARED' &&
    !hasReleasedTestHold(current) &&
    !hasCancelledPurchase(current)
    ? { order: current, canStartPayment: true, payment: signedPayment, bridgeAttempt }
    : { order: current || order, canStartPayment: false };
};

const createHandler =
  ({ store, payment, now = () => new Date(), hash = hashKey, diagnostics = null }) =>
  async (event, context) => {
    let observation = null;
    let diagnosticStage = 'validation';
    try {
      if (
        !context ||
        typeof context.APPID !== 'string' ||
        !context.APPID ||
        typeof context.OPENID !== 'string' ||
        !context.OPENID
      )
        throw new MembershipError('UNAUTHENTICATED');
      if (
        !event ||
        typeof event !== 'object' ||
        Array.isArray(event) ||
        typeof event.action !== 'string'
      )
        throw new MembershipError('INVALID_REQUEST');
      const accountKey = hash(context.APPID, context.OPENID);
      const timestamp = now();
      const paymentAvailable = Boolean(payment && payment.available);
      const unavailableReason = paymentUnavailableReason(payment, context);
      const action = event.action;
      if (action === 'getPaymentContext')
        return { ok: true, data: { accountScope: paymentAccountScope(context) } };
      // Existing clients remain supported by the order ownership checks below.
      // New clients bind every payment operation to a freshly resolved account;
      // reject a switched identity before reading or mutating any order.
      if (
        PAYMENT_ACTIONS.has(action) &&
        event.expectedPaymentAccountScope !== undefined &&
        !matchesPaymentAccountScope(event.expectedPaymentAccountScope, context)
      )
        throw new MembershipError('UNAUTHENTICATED');
      if (action === 'getStatus') {
        const [entitlement, usage] = await Promise.all([
          store.getEntitlement(accountKey),
          store.getUsage(accountKey),
        ]);
        return {
          ok: true,
          data: status(entitlement, usage, timestamp, paymentAvailable, unavailableReason),
        };
      }
      if (action === 'validateRandomPractice') {
        observation = diagnostics?.start(action, event);
        if (!validId(event.sessionId) || !validQuestions(event.questionIds))
          throw new MembershipError('INVALID_REQUEST');
        const grant = await store.getGrant(accountKey, event.sessionId);
        if (!grant) throw new MembershipError('GRANT_NOT_FOUND');
        if (JSON.stringify(grant.question_ids) !== JSON.stringify(event.questionIds))
          throw new MembershipError('INVALID_GRANT');
        const [entitlement, usage] = await Promise.all([
          store.getEntitlement(accountKey),
          store.getUsage(accountKey),
        ]);
        const result = {
          ok: true,
          data: { membership: status(entitlement, usage, timestamp, paymentAvailable) },
        };
        diagnostics?.complete(observation, diagnosticStage);
        return result;
      }
      if (action === 'checkPermission') {
        if (typeof event.feature !== 'string') throw new MembershipError('INVALID_REQUEST');
        const [entitlement, usage] = await Promise.all([
          store.getEntitlement(accountKey),
          store.getUsage(accountKey),
        ]);
        const current = status(entitlement, usage, timestamp, paymentAvailable);
        if (event.feature === 'randomPractice')
          return {
            ok: true,
            data: { allowed: current.isMember || current.freeRemaining > 0, membership: current },
          };
        if (!MEMBER_FEATURES.has(event.feature)) throw new MembershipError('MEMBERSHIP_REQUIRED');
        return { ok: true, data: { allowed: current.isMember, membership: current } };
      }
      if (action === 'startRandomPractice') {
        observation = diagnostics?.start(action, event);
        if (
          !validId(event.requestId) ||
          !validId(event.sessionId) ||
          event.requestId !== event.sessionId ||
          !validQuestions(event.questionIds)
        )
          throw new MembershipError('INVALID_REQUEST');
        diagnosticStage = 'transaction';
        const result = await store.transaction(async (tx) => {
          const timestamp = now();
          const existing = await tx.getGrant(accountKey, event.sessionId);
          if (existing) {
            if (
              existing.request_id !== event.requestId ||
              JSON.stringify(existing.question_ids) !== JSON.stringify(event.questionIds)
            )
              throw new MembershipError('IDEMPOTENCY_CONFLICT');
            const [entitlement, usage] = await Promise.all([
              tx.getEntitlement(accountKey),
              tx.getUsage(accountKey),
            ]);
            return {
              ok: true,
              data: { membership: status(entitlement, usage, timestamp, paymentAvailable) },
            };
          }
          const [entitlement, oldUsage] = await Promise.all([
            tx.getEntitlement(accountKey),
            tx.getUsage(accountKey),
          ]);
          const current = status(entitlement, oldUsage, timestamp, paymentAvailable);
          if (!current.isMember && current.freeRemaining <= 0)
            throw new MembershipError('DAILY_LIMIT_REACHED');
          const usage = current.isMember
            ? oldUsage
            : {
                account_key: accountKey,
                free_date: current.freeDate,
                free_used: current.freeUsed + 1,
              };
          if (!current.isMember) await tx.saveUsage(accountKey, usage);
          await tx.createGrant(`${accountKey}:${event.sessionId}`, {
            account_key: accountKey,
            session_id: event.sessionId,
            request_id: event.requestId,
            question_ids: event.questionIds,
            created_at: iso(timestamp),
          });
          return {
            ok: true,
            data: { membership: status(entitlement, usage, timestamp, paymentAvailable) },
          };
        });
        diagnostics?.complete(observation, diagnosticStage);
        return result;
      }
      if (action === 'createOrder') {
        observation = diagnostics?.start(action, event);
        if (!validId(event.requestId)) throw new MembershipError('INVALID_REQUEST');
        if (!paymentAvailable || payment.config.appId !== context.APPID)
          throw new MembershipError('PAYMENT_NOT_CONFIGURED');
        const virtual = payment.kind === 'virtual';
        // The rebuilt flow has one production purchase provider.  Do not leave
        // a generic JSAPI fallback reachable without its own reviewed contract.
        if (!virtual) throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
        if (
          virtual &&
          (typeof event.loginCode !== 'string' || !event.loginCode || event.loginCode.length > 512)
        )
          throw new MembershipError('INVALID_REQUEST');
        const orderId = `M${crypto.createHash('sha256').update(`${accountKey}:${event.requestId}`).digest('hex').slice(0, 31)}`;
        // Legacy orders predate the account-level pointer. Read them before taking the pointer lock,
        // then verify again inside the transaction before binding one to this account.
        const legacyPending = virtual ? await store.listDuePendingOrders(accountKey, 100) : [];
        const created = await store.transaction(async (tx) => {
          const existing = await tx.getOrder(orderId);
          if (existing) {
            if (
              existing.account_key !== accountKey ||
              (virtual &&
                (existing.payment_provider !== 'virtual' ||
                  existing.product_id !== payment.config.productId))
            )
              throw new MembershipError('IDEMPOTENCY_CONFLICT');
            return { order: existing, created: false };
          }
          if (virtual) {
            const pointer = await tx.getPendingPurchase(accountKey);
            if (pointer?.pending_order_id) {
              const pointed = await tx.getOrder(pointer.pending_order_id);
              if (!pointed || pointed.account_key !== accountKey)
                throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
              if (
                isUnresolved(pointed) &&
                !hasReleasedTestHold(pointed) &&
                !hasCancelledPurchase(pointed)
              )
                return { order: pointed, created: false };
              if (hasReleasedTestHold(pointed) || hasCancelledPurchase(pointed)) {
                await tx.savePendingPurchase(accountKey, null);
              } else if (!['PAID', ...SAFE_TERMINAL].includes(pointed.status)) {
                throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
              } else {
                await tx.savePendingPurchase(accountKey, null);
              }
            }
            for (const candidate of legacyPending) {
              const legacy = await tx.getOrder(candidate.order_id);
              if (
                legacy?.account_key === accountKey &&
                isUnresolved(legacy) &&
                !hasReleasedTestHold(legacy) &&
                !hasCancelledPurchase(legacy)
              ) {
                await tx.savePendingPurchase(accountKey, legacy.order_id);
                return { order: legacy, created: false };
              }
            }
            // A full page can have a later pending order. Ask the caller to retry rather than risk a new charge.
            if (legacyPending.length === 100) throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
          }
          const next = {
            order_id: orderId,
            account_key: accountKey,
            app_id: context.APPID,
            open_id: context.OPENID,
            request_id: event.requestId,
            amount: AMOUNT,
            currency: 'CNY',
            status: 'PREPARED',
            paid_at: null,
            transaction_id: null,
            payment_provider: 'virtual',
            product_id: payment.config.productId,
            created_at: iso(timestamp),
            next_check_at: iso(timestamp),
          };
          await tx.createOrder(orderId, next);
          if (virtual) await tx.savePendingPurchase(accountKey, orderId);
          return { order: next, created: true };
        });
        const order = created.order;
        const bridge =
          virtual && order.status === 'PREPARED' && !hasCancelledPurchase(order)
            ? await authorizePreparedBridge(
                store,
                payment,
                order,
                context,
                event.loginCode,
                timestamp,
              )
            : { order, canStartPayment: false };
        diagnostics?.complete(observation, 'authorization');
        return {
          ok: true,
          data: {
            order: publicOrder(projectedOrder(bridge.order)),
            canStartPayment: bridge.canStartPayment,
            ...(bridge.canStartPayment
              ? { payment: bridge.payment, bridgeAttempt: bridge.bridgeAttempt }
              : {}),
          },
        };
      }
      if (action === 'getOrder') {
        observation = diagnostics?.start(action, event);
        if (!validId(event.orderId)) throw new MembershipError('INVALID_REQUEST');
        diagnosticStage = 'store-read';
        let order = await store.getOrder(event.orderId);
        if (!order || order.account_key !== accountKey)
          throw new MembershipError('ORDER_NOT_FOUND');
        if (
          !hasCancelledPurchase(order) &&
          canReconcile(payment) &&
          (isReconcilable(order) || (payment.kind === 'virtual' && order.status === 'PAID'))
        ) {
          diagnosticStage = 'reconcile';
          await reconcileOrder(store, payment, order, context, timestamp);
        }
        diagnosticStage = 'status-read';
        order = await store.getOrder(event.orderId);
        const [entitlement, usage] = await Promise.all([
          store.getEntitlement(accountKey),
          store.getUsage(accountKey),
        ]);
        const result = {
          ok: true,
          data: {
            order: publicOrder(projectedOrder(order)),
            membership: status(entitlement, usage, timestamp, paymentAvailable, unavailableReason),
          },
        };
        diagnostics?.complete(observation, diagnosticStage);
        return result;
      }
      if (action === 'resumePayment') {
        observation = diagnostics?.start(action, event);
        if (!validId(event.orderId)) throw new MembershipError('INVALID_REQUEST');
        if (
          !paymentAvailable ||
          payment.kind !== 'virtual' ||
          payment.config.appId !== context.APPID ||
          typeof event.loginCode !== 'string' ||
          !event.loginCode ||
          event.loginCode.length > 512
        )
          throw new MembershipError('INVALID_REQUEST');
        let order = await store.getOrder(event.orderId);
        if (!order || order.account_key !== accountKey)
          throw new MembershipError('ORDER_NOT_FOUND');
        if (!canResumeVirtualPayment(order, payment, context))
          throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
        if (order.status === 'PREPARED') {
          const bridge = await authorizePreparedBridge(
            store,
            payment,
            order,
            context,
            event.loginCode,
            timestamp,
          );
          diagnostics?.complete(observation, 'authorization');
          return {
            ok: true,
            data: {
              order: publicOrder(bridge.order),
              canStartPayment: bridge.canStartPayment,
              ...(bridge.canStartPayment
                ? { payment: bridge.payment, bridgeAttempt: bridge.bridgeAttempt }
                : {}),
            },
          };
        }
        diagnostics?.complete(observation, 'status-read');
        return {
          ok: true,
          data: { order: publicOrder(projectedOrder(order)), canStartPayment: false },
        };
      }
      if (action === 'cancelPayment') {
        observation = diagnostics?.start(action, event);
        if (!validId(event.orderId)) throw new MembershipError('INVALID_REQUEST');
        diagnosticStage = 'transaction';
        const initial = await store.getOrder(event.orderId);
        assertCancellableVirtualOrder(initial, accountKey, context);
        // A cancellation only withdraws the app's intent to buy. For an order that
        // reached the payment bridge, first accept any authoritative success that is
        // already available. A query failure deliberately does not prevent cancelling:
        // it remains due for server-side reconciliation and is not payment evidence.
        if (
          !hasCancelledPurchase(initial) &&
          ['PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING'].includes(initial.status) &&
          canReconcile(payment)
        ) {
          try {
            await reconcileOrder(store, payment, initial, context, timestamp);
          } catch (error) {
            try {
              diagnostics?.reconcileFail(initial.order_id, error);
            } catch {
              // Diagnostics are best effort; a logger failure must not restore a cancelled hold.
            }
          }
        }
        const result = await store.transaction(async (tx) => {
          const current = await tx.getOrder(event.orderId);
          assertCancellableVirtualOrder(current, accountKey, context);
          // A paid order, or one backed by a reliable platform terminal result, is
          // immutable. Cancelling the app's purchase intent cannot alter payment facts.
          if (current.status === 'PAID' || hasReliableTerminalEvidence(current))
            return { order: current, cancelled: false };
          if (
            !['PREPARED', 'PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING'].includes(current.status)
          )
            return { order: current, cancelled: false };
          if (hasCancelledPurchase(current)) return { order: current, cancelled: true };
          const cancelled = {
            ...current,
            purchase_cancelled_at: iso(timestamp),
            updated_at: iso(timestamp),
          };
          await tx.saveOrder(current.order_id, cancelled);
          await clearPointer(tx, cancelled);
          return { order: cancelled, cancelled: true };
        });
        const [entitlement, usage] = await Promise.all([
          store.getEntitlement(accountKey),
          store.getUsage(accountKey),
        ]);
        diagnostics?.complete(observation, diagnosticStage);
        return {
          ok: true,
          data: {
            order: publicOrder(projectedOrder(result.order)),
            membership: status(entitlement, usage, timestamp, paymentAvailable, unavailableReason),
            cancelled: result.cancelled,
          },
        };
      }
      if (action === 'markPaymentStarting' || action === 'markPaymentUnknown') {
        observation = diagnostics?.start(action, event);
        if (!validId(event.orderId)) throw new MembershipError('INVALID_REQUEST');
        const nextStatus =
          action === 'markPaymentStarting' ? 'PAYMENT_STARTING' : 'PAYMENT_UNKNOWN';
        const result = await store.transaction(async (tx) => {
          const current = await tx.getOrder(event.orderId);
          if (!current || current.account_key !== accountKey)
            throw new MembershipError('ORDER_NOT_FOUND');
          if (hasReleasedTestHold(current) || hasCancelledPurchase(current))
            return { order: current, bridgeLease: false };
          // A terminal platform result is immutable; an old app process cannot resurrect it.
          if (SAFE_TERMINAL.has(current.status) || current.status === 'PAID')
            return { order: current, bridgeLease: false };
          const preparedAttempt =
            current.status === 'PREPARED' &&
            validBridgeAttempt(event.bridgeAttempt) &&
            sameBridgeAttempt(event.bridgeAttempt, current.bridge_attempt_hash) &&
            typeof current.bridge_attempt_expires_at === 'string' &&
            new Date(current.bridge_attempt_expires_at).valueOf() > new Date(timestamp).valueOf();
          const paymentMatches =
            current.status === 'PREPARED' &&
            samePaymentFingerprint(event.payment, current.bridge_payment_fingerprint);
          if (action === 'markPaymentStarting' && !(preparedAttempt && paymentMatches))
            return { order: current, bridgeLease: false };
          // Only the holder of a successful bridge lease may mark its callback uncertain.
          // Repeated unknown reports are harmless; stale reports never downgrade PREPARED/PENDING.
          if (action === 'markPaymentUnknown' && current.status !== 'PAYMENT_STARTING')
            return { order: current, bridgeLease: false };
          await tx.saveOrder(current.order_id, {
            ...current,
            status: nextStatus,
            ...(action === 'markPaymentStarting'
              ? {
                  bridge_attempt_hash: null,
                  bridge_attempt_expires_at: null,
                  bridge_payment_fingerprint: null,
                }
              : {}),
            updated_at: iso(timestamp),
            next_check_at: iso(timestamp),
          });
          return {
            order: { ...current, status: nextStatus },
            bridgeLease: action === 'markPaymentStarting',
          };
        });
        return {
          ok: true,
          data: {
            order: publicOrder(result.order),
            bridgeLease: result.bridgeLease,
            canStartPayment: result.bridgeLease,
          },
        };
      }
      if (action === 'recoverOrders') {
        observation = diagnostics?.start(action, event);
        const requestedLocalOrder = Object.hasOwn(event, 'localOrderId');
        if (requestedLocalOrder && !validId(event.localOrderId))
          throw new MembershipError('INVALID_REQUEST');
        diagnosticStage = 'status-read';
        const [entitlement, usage, pending, localOrder] = await Promise.all([
          store.getEntitlement(accountKey),
          store.getUsage(accountKey),
          store.listDuePendingOrders(accountKey, 1),
          requestedLocalOrder ? store.getOrder(event.localOrderId) : null,
        ]);
        const pendingOrder = pending[0];
        const result = {
          ok: true,
          data: {
            membership: status(entitlement, usage, timestamp, paymentAvailable, unavailableReason),
            ...(pendingOrder ? { pendingOrder: publicOrder(projectedOrder(pendingOrder)) } : {}),
            ...(requestedLocalOrder &&
            localOrder?.account_key === accountKey &&
            localOrder.app_id === context.APPID &&
            localOrder.open_id === context.OPENID &&
            hasReleasedTestHold(localOrder)
              ? { releasedTestOrderId: event.localOrderId }
              : localOrder?.account_key === accountKey &&
                  localOrder.app_id === context.APPID &&
                  localOrder.open_id === context.OPENID &&
                  hasCancelledPurchase(localOrder)
                ? { cancelledOrderId: event.localOrderId }
                : {}),
          },
        };
        diagnostics?.complete(observation, diagnosticStage);
        return result;
      }
      throw new MembershipError('INVALID_REQUEST');
    } catch (error) {
      diagnostics?.fail(observation, diagnosticStage, error);
      return fail(error);
    }
  };
const canReconcile = (payment) => Boolean(payment && (payment.canReconcile ?? payment.available));
const DELIVERY_NOTICE_GRACE_MS = 60000;
const DELIVERY_FALLBACK_LEASE_MS = 60000;
const DELIVERY_FALLBACK_RETRY_MS = 600000;
const validTimestamp = (value) =>
  typeof value === 'string' && !Number.isNaN(new Date(value).valueOf());
const scheduleDeliveryFallback = async (store, orderId, timestamp) =>
  store.transaction(async (tx) => {
    const latest = await tx.getOrder(orderId);
    if (!latest || latest.status !== 'PAID' || latest.provided_at || latest.platform_status === 4)
      return false;
    const anchor = latest.delivery_notice_processed_at || latest.settled_at;
    const anchorTime = validTimestamp(anchor)
      ? new Date(anchor).valueOf()
      : new Date(timestamp).valueOf();
    const graceUntil = anchorTime + DELIVERY_NOTICE_GRACE_MS;
    if (new Date(timestamp).valueOf() < graceUntil) {
      await tx.saveOrder(orderId, {
        ...latest,
        next_check_at: new Date(graceUntil).toISOString(),
        updated_at: iso(timestamp),
      });
      return false;
    }
    if (
      validTimestamp(latest.delivery_fallback_lease_until) &&
      new Date(latest.delivery_fallback_lease_until).valueOf() > new Date(timestamp).valueOf()
    )
      return false;
    await tx.saveOrder(orderId, {
      ...latest,
      delivery_fallback_lease_until: new Date(
        new Date(timestamp).valueOf() + DELIVERY_FALLBACK_LEASE_MS,
      ).toISOString(),
      updated_at: iso(timestamp),
    });
    return true;
  });
const completeDeliveryFallback = async (store, orderId, timestamp, provided) =>
  store.transaction(async (tx) => {
    const latest = await tx.getOrder(orderId);
    if (!latest || latest.status !== 'PAID') return;
    await tx.saveOrder(orderId, {
      ...latest,
      ...(provided ? { provided_at: iso(timestamp) } : {}),
      delivery_fallback_lease_until: null,
      next_check_at: new Date(
        new Date(timestamp).valueOf() + (provided ? 86400000 : DELIVERY_FALLBACK_RETRY_MS),
      ).toISOString(),
      updated_at: iso(timestamp),
    });
  });
const reconcileDeliveryFallback = async (store, payment, order, timestamp) => {
  if (!(await scheduleDeliveryFallback(store, order.order_id, timestamp))) return;
  try {
    await payment.provideGoods(order);
    await completeDeliveryFallback(store, order.order_id, timestamp, true);
  } catch (error) {
    // Membership is already settled. Leave only the acknowledgement retry pending.
    nodeConsole.warn('membership.delivery.failed', publicFailure(error).error);
    await completeDeliveryFallback(store, order.order_id, timestamp, false);
  }
};
const recordPlatformProvided = async (store, proof, timestamp) =>
  store.transaction(async (tx) => {
    const latest = await tx.getOrder(proof.out_trade_no);
    if (
      !latest ||
      latest.status !== 'PAID' ||
      latest.order_id !== proof.out_trade_no ||
      latest.app_id !== proof.appid ||
      latest.open_id !== proof.payer?.openid ||
      latest.amount !== proof.amount?.total ||
      latest.currency !== proof.amount?.currency ||
      (latest.transaction_id && latest.transaction_id !== proof.transaction_id)
    )
      return false;
    await tx.saveOrder(latest.order_id, {
      ...latest,
      platform_status: 4,
      platform_trade_state: 'SUCCESS',
      platform_verified_at: iso(timestamp),
      platform_evidence_version: 1,
      platform_env: proof.platform_env,
      platform_order_type: proof.platform_order_type,
      platform_wx_order_id: proof.transaction_id,
      platform_app_id: proof.appid,
      platform_open_id: proof.payer.openid,
      provided_at: latest.provided_at || iso(timestamp),
      delivery_fallback_lease_until: null,
      next_check_at: new Date(new Date(timestamp).valueOf() + 86400000).toISOString(),
      updated_at: iso(timestamp),
    });
    return true;
  });
const reconcileOrder = async (store, payment, order, context, timestamp) => {
  if (!isReconcilable(order) && !(payment.kind === 'virtual' && order.status === 'PAID')) return;
  const proof = await payment.query(order.order_id, order);
  if (!proof || proof.out_trade_no !== order.order_id)
    throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
  if (proof.trade_state === 'REFUNDED' && payment.kind === 'virtual')
    return settleRefund(store, payment, proof, context, timestamp).then(() => proof);
  if (proof.trade_state === 'SUCCESS') {
    await settleOrder(store, payment, proof, context, timestamp);
    if (payment.kind === 'virtual' && proof.platform_status === 4) {
      await recordPlatformProvided(store, proof, timestamp);
      return proof;
    }
    if (payment.kind === 'virtual')
      await reconcileDeliveryFallback(store, payment, order, timestamp);
    return proof;
  }
  if (proof.trade_state === 'NOTPAY') {
    await store.transaction(async (tx) => {
      const latest = await tx.getOrder(order.order_id);
      if (!latest || !isUnresolved(latest)) return;
      await tx.saveOrder(order.order_id, {
        ...latest,
        status: 'PENDING',
        platform_notpay_confirmed_at: iso(timestamp),
        updated_at: iso(timestamp),
        next_check_at: new Date(new Date(timestamp).valueOf() + 600000).toISOString(),
      });
    });
    return proof;
  }
  if (proof.trade_state === 'INITIALIZED') {
    await store.transaction(async (tx) => {
      const latest = await tx.getOrder(order.order_id);
      if (!latest || !isUnresolved(latest)) return;
      await tx.saveOrder(order.order_id, {
        ...latest,
        // This is deliberately not PENDING: query status 0 has no evidence a
        // platform order was created, and cannot support payment re-issuance.
        status: 'PAYMENT_UNKNOWN',
        previous_status: latest.status,
        previous_updated_at: latest.updated_at || null,
        platform_status: proof.platform_status,
        platform_verified_at: iso(timestamp),
        platform_trade_state: 'INITIALIZED',
        platform_evidence_version: 1,
        platform_env: proof.platform_env,
        platform_order_type: proof.platform_order_type,
        platform_app_id: latest.app_id,
        platform_open_id: latest.open_id,
        updated_at: iso(timestamp),
        next_check_at: new Date(new Date(timestamp).valueOf() + 600000).toISOString(),
      });
    });
    return proof;
  }
  if (['CLOSED', 'FAILED', 'PAYERROR', 'REVOKED'].includes(proof.trade_state))
    await store.transaction(async (tx) => {
      const latest = await tx.getOrder(order.order_id);
      if (latest && isUnresolved(latest)) {
        await tx.saveOrder(order.order_id, {
          ...latest,
          status: proof.trade_state === 'FAILED' ? 'FAILED' : 'CLOSED',
          previous_status: latest.status,
          previous_updated_at: latest.updated_at || null,
          platform_trade_state: proof.trade_state,
          platform_verified_at: iso(timestamp),
          platform_evidence_version: 1,
          platform_status: proof.platform_status,
          platform_env: proof.platform_env,
          platform_order_type: proof.platform_order_type,
          platform_app_id: latest.app_id,
          platform_open_id: latest.open_id,
          updated_at: iso(timestamp),
        });
        if (payment.kind === 'virtual') await clearPointer(tx, latest);
      }
    });
  return proof;
};
const reconcilePendingOrders = async (
  store,
  payment,
  now = () => new Date(),
  limit = 5,
  accountKey = null,
  diagnostics = null,
) => {
  if (!canReconcile(payment)) return 0;
  const listOrders =
    payment.kind === 'virtual' ? store.listDueReconcileOrders : store.listDuePendingOrders;
  const orders = await listOrders.call(
    store,
    accountKey,
    // Virtual orders may need both query and delivery I/O within the 60-second function limit.
    payment.kind === 'virtual' ? Math.min(limit, 2) : limit,
    accountKey ? undefined : iso(now()),
  );
  let processed = 0;
  for (const order of orders) {
    const timestamp = now();
    try {
      // Lease before network I/O. Concurrent jobs skip this row; failures do not starve later rows.
      const leased = await store.transaction(async (tx) => {
        const latest = await tx.getOrder(order.order_id);
        if (
          !latest ||
          !(isReconcilable(latest) || (payment.kind === 'virtual' && latest.status === 'PAID')) ||
          (!accountKey && latest.next_check_at > iso(timestamp))
        )
          return false;
        await tx.saveOrder(order.order_id, {
          ...latest,
          next_check_at: new Date(new Date(timestamp).valueOf() + 600000).toISOString(),
          updated_at: iso(timestamp),
        });
        return true;
      });
      if (!leased) continue;
      processed += 1;
      const proof = await reconcileOrder(
        store,
        payment,
        order,
        { APPID: order.app_id, OPENID: order.open_id },
        timestamp,
      );
      diagnostics?.reconcileSuccess?.(order.order_id, proof);
    } catch (error) {
      // A retryable failure leaves this order pending; continue with the remaining due orders.
      diagnostics?.reconcileFail?.(order.order_id, error);
    }
  }
  return processed;
};
const settleOrder = async (store, payment, proof, context, timestamp) => {
  if (proof.trade_state !== 'SUCCESS' || !payment.verifyProof(proof, context))
    throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
  // Legacy direct callers did not supply a server clock; retain their verified payment-time
  // behavior. Every production entrypoint/reconciler supplies a real settlement clock.
  const settlementTimestamp =
    timestamp === undefined ? new Date(proof.success_time || Date.now()) : timestamp;
  await store.transaction(async (tx) => {
    const order = await tx.getOrder(proof.out_trade_no);
    if (!order) throw new MembershipError('ORDER_NOT_FOUND');
    if (
      order.account_key !== hashKey(context.APPID, context.OPENID) ||
      order.open_id !== proof.payer.openid ||
      order.app_id !== proof.appid ||
      order.amount !== proof.amount.total ||
      proof.amount.currency !== 'CNY' ||
      !proof.transaction_id
    )
      throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
    // A delayed notification must never turn a platform-confirmed terminal result back into paid.
    if (SAFE_TERMINAL.has(order.status) && hasReliableTerminalEvidence(order)) return;
    if (order.status === 'PAID') {
      if (order.transaction_id !== proof.transaction_id)
        throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
      return;
    }
    const scopedLock = paymentLockId(proof.appid, proof.platform_env ?? 1, proof.transaction_id);
    // Read the old bare lock during migration, but only write the scoped lock.
    const existingTransaction =
      (await tx.getOrderByTransaction(scopedLock)) ||
      (await tx.getOrderByTransaction(proof.transaction_id));
    if (existingTransaction && existingTransaction.order_id !== order.order_id)
      throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
    const paidAt = proof.success_time
      ? new Date(proof.success_time).toISOString()
      : iso(settlementTimestamp);
    if (Number.isNaN(new Date(paidAt).valueOf()))
      throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
    const entitlement = await tx.getEntitlement(order.account_key);
    const base = renewalBase(entitlement);
    // PAID orders return above; the transaction appends each verified payment exactly once.
    const payments = [
      ...(entitlement?.renewal_payments ?? []),
      {
        order_id: order.order_id,
        paid_at: paidAt,
        effective_at: iso(settlementTimestamp),
        settled_at: iso(settlementTimestamp),
      },
    ].sort(
      (left, right) =>
        (left.effective_at || left.settled_at || left.paid_at).localeCompare(
          right.effective_at || right.settled_at || right.paid_at,
        ) || left.order_id.localeCompare(right.order_id),
    );
    const nextPeriod = replayRenewals(base, payments);
    const next = {
      account_key: order.account_key,
      ...nextPeriod,
      renewal_base: base,
      renewal_payments: payments,
      updated_at: iso(settlementTimestamp),
    };
    await tx.saveEntitlement(order.account_key, next);
    await tx.saveOrder(order.order_id, {
      ...order,
      status: 'PAID',
      paid_at: paidAt,
      settled_at: iso(settlementTimestamp),
      transaction_id: proof.transaction_id,
      platform_wx_order_id: proof.transaction_id,
      platform_env: proof.platform_env ?? 1,
      platform_verified_at: iso(settlementTimestamp),
      platform_trade_state: 'SUCCESS',
      platform_evidence_version: 1,
      platform_status: proof.platform_status,
      platform_order_type: proof.platform_order_type,
      platform_app_id: proof.appid,
      platform_open_id: proof.payer.openid,
      updated_at: iso(settlementTimestamp),
    });
    await tx.saveTransactionLock(scopedLock, order.order_id);
    await clearPointer(tx, order);
  });
};
const settleRefund = async (store, payment, proof, context, timestamp = new Date()) => {
  if (
    proof.trade_state !== 'REFUNDED' ||
    payment.kind !== 'virtual' ||
    !payment.verifyProof(proof, context)
  )
    throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
  await store.transaction(async (tx) => {
    const order = await tx.getOrder(proof.out_trade_no);
    if (
      !order ||
      order.payment_provider !== 'virtual' ||
      order.account_key !== hashKey(context.APPID, context.OPENID) ||
      order.app_id !== proof.appid ||
      order.open_id !== proof.payer.openid ||
      order.amount !== proof.amount.total ||
      proof.amount.currency !== 'CNY' ||
      !proof.transaction_id ||
      (order.transaction_id && order.transaction_id !== proof.transaction_id)
    )
      throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
    const scopedLock = paymentLockId(proof.appid, proof.platform_env ?? 1, proof.transaction_id);
    const lock =
      (await tx.getOrderByTransaction(scopedLock)) ||
      (await tx.getOrderByTransaction(proof.transaction_id));
    if (lock && lock.order_id !== order.order_id)
      throw new MembershipError('PAYMENT_VERIFICATION_FAILED');
    if (order.status === 'REFUNDED') return;
    const entitlement = await tx.getEntitlement(order.account_key);
    if (entitlement?.renewal_payments?.some((item) => item.order_id === order.order_id)) {
      const payments = entitlement.renewal_payments.map((item) =>
        item.order_id === order.order_id ? { ...item, refunded: true } : item,
      );
      await tx.saveEntitlement(order.account_key, {
        ...entitlement,
        ...replayRenewals(renewalBase(entitlement), payments),
        renewal_payments: payments,
        updated_at: iso(timestamp),
      });
    }
    await tx.saveOrder(order.order_id, {
      ...order,
      status: 'REFUNDED',
      platform_trade_state: 'REFUNDED',
      platform_verified_at: iso(timestamp),
      platform_evidence_version: 1,
      platform_status: proof.platform_status,
      platform_order_type: proof.platform_order_type,
      platform_env: proof.platform_env ?? 1,
      platform_wx_order_id: proof.transaction_id,
      platform_app_id: proof.appid,
      platform_open_id: proof.payer.openid,
      transaction_id: proof.transaction_id,
      refunded_at: iso(timestamp),
      ...(proof.refund_transaction_id
        ? { refund_transaction_id: proof.refund_transaction_id }
        : {}),
      ...(proof.merchant_refund_id ? { merchant_refund_id: proof.merchant_refund_id } : {}),
      updated_at: iso(timestamp),
    });
    await tx.saveTransactionLock(scopedLock, order.order_id);
    await clearPointer(tx, order);
  });
};
module.exports = {
  createHandler,
  MembershipError,
  hashKey,
  dateInShanghai,
  addMonthsShanghai,
  settleOrder,
  settleRefund,
  reconcilePendingOrders,
  FREE_LIMIT,
  AMOUNT,
};

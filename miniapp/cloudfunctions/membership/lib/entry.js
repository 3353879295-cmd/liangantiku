const { Buffer } = require('node:buffer');
const { info } = require('node:console');
const { settleOrder, settleRefund, reconcilePendingOrders } = require('./handler');

const response = (statusCode, message) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: statusCode === 200 ? 'SUCCESS' : 'FAIL', message }),
});

const virtualResponse = (format) => ({
  statusCode: 200,
  headers: { 'Content-Type': format === 'xml' ? 'application/xml' : 'application/json' },
  body:
    format === 'xml'
      ? '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>'
      : JSON.stringify({ ErrCode: 0, ErrMsg: 'success' }),
});
const integer = (value) =>
  typeof value === 'number' && Number.isInteger(value)
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : NaN;
const handleVirtualNotification = async (event, store, payment, now = () => new Date()) => {
  let notice;
  try {
    notice = await payment.readNotification(event);
  } catch {
    return response(401, 'invalid notification');
  }
  if (notice.kind === 'handshake')
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: notice.body };
  if (!payment.canReconcile) return response(503, 'payment not configured');
  const message = notice.message;
  const delivery = message.Event === 'xpay_goods_deliver_notify';
  const refund = message.Event === 'xpay_refund_notify';
  if (message.MsgType !== 'event' || (!delivery && !refund))
    return response(400, 'unsupported notification');
  try {
    const orderId = delivery ? message.OutTradeNo : message.MchOrderId;
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{8,32}$/.test(orderId))
      return response(400, 'invalid order');
    const order = await store.getOrder(orderId);
    if (!order || order.payment_provider !== 'virtual') return response(404, 'order missing');
    if (order.open_id !== message.OpenId) return response(400, 'order mismatch');
    if (delivery) {
      if (!payment.validateDelivery(message, order)) return response(400, 'goods mismatch');
    } else {
      const result = integer(message.RetCode);
      if (!Number.isSafeInteger(result)) return response(400, 'invalid refund');
      if (result !== 0) return virtualResponse(notice.format);
      if (integer(message.RefundFee) !== order.amount)
        return response(409, 'refund requires reconciliation');
    }
    const proof = refund
      ? payment.refundProof(message, order)
      : await payment.query(orderId, order);
    const context = { APPID: order.app_id, OPENID: order.open_id };
    if (refund && message.WxOrderId !== proof.transaction_id)
      return response(400, 'transaction mismatch');
    if (delivery && message.WeChatPayInfo) {
      if (
        message.WeChatPayInfo.MchOrderNo !== proof.transaction_id ||
        integer(message.WeChatPayInfo.PaidTime) !== Date.parse(proof.success_time) / 1000
      )
        return response(400, 'transaction mismatch');
    }
    if (proof.trade_state === 'REFUNDED') await settleRefund(store, payment, proof, context);
    else if (delivery && proof.trade_state === 'SUCCESS') {
      const timestamp = now();
      await settleOrder(store, payment, proof, context, timestamp);
      // A successful delivery callback is the documented normal acknowledgement path.
      // It is distinct from a later notify_provide_goods fallback acknowledgement.
      await store.transaction(async (tx) => {
        const latest = await tx.getOrder(orderId);
        if (latest?.status !== 'PAID') return;
        await tx.saveOrder(orderId, {
          ...latest,
          delivery_notice_processed_at: timestamp.toISOString(),
          updated_at: timestamp.toISOString(),
        });
      });
    } else return response(409, 'order not confirmed');
    return virtualResponse(notice.format);
  } catch {
    return response(500, 'retry');
  }
};

const createEntry =
  ({
    store,
    payment,
    handler,
    getContext,
    isTimerInvocation = () => false,
    now = () => new Date(),
    diagnostics = null,
  }) =>
  async (event) => {
    // HTTP requests never enter the scheduler path, regardless of their JSON payload.
    if (event && event.httpMethod) {
      if (payment.kind === 'virtual') return handleVirtualNotification(event, store, payment, now);
      try {
        if (event.httpMethod !== 'POST') return response(405, 'POST required');
        const raw = typeof event.rawBody === 'string' ? event.rawBody : event.body;
        if (typeof raw !== 'string') return response(400, 'raw body required');
        const body = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
        const headers = Object.fromEntries(
          Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]),
        );
        if (!payment.available || !payment.verifyHeaders(headers, body))
          return response(401, 'invalid signature');
        const notice = JSON.parse(body);
        if (
          notice.event_type !== 'TRANSACTION.SUCCESS' ||
          notice.resource_type !== 'encrypt-resource'
        )
          return response(400, 'unsupported notification');
        const proof = payment.decryptNotification(notice.resource);
        const order = await store.getOrder(proof.out_trade_no);
        if (!order) return response(404, 'order missing');
        await settleOrder(
          store,
          payment,
          proof,
          { APPID: order.app_id, OPENID: order.open_id },
          now(),
        );
        return response(200, '成功');
      } catch {
        return response(500, 'retry');
      }
    }
    const context = getContext();
    // Timer invocations can retain an SDK OPENID; source trust comes from the runtime, never event data.
    const runtimeTimer = isTimerInvocation();
    const timerType = event?.Type === 'Timer';
    const triggerMatches = event?.TriggerName === 'membership-reconcile-pending';
    const hasCaller = Boolean(context?.OPENID);
    if (runtimeTimer && timerType && triggerMatches) {
      try {
        const processed = await reconcilePendingOrders(store, payment, now, 5, null, diagnostics);
        info('membership.reconcile.complete', { processed });
        return { ok: true, data: { processed } };
      } catch {
        return { ok: false, error: { code: 'MEMBERSHIP_UNAVAILABLE' } };
      }
    }
    if (!event?.action)
      info('membership.reconcile.guard-rejected', {
        runtimeTimer,
        timerType,
        triggerMatches,
        hasCaller,
      });
    return handler(event, context);
  };

module.exports = { createEntry };

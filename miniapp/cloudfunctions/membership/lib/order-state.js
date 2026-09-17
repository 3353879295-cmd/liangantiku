'use strict';

// PREPARED blocks a second local order, but it has no evidence that a payment
// request reached WeChat and therefore must never be sent to the platform query.
const UNRESOLVED = new Set(['PREPARED', 'PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING']);
const RECONCILABLE = new Set(['PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING']);
const SAFE_TERMINAL = new Set(['CLOSED', 'FAILED', 'REFUNDED']);

const hasReliableTerminalEvidence = (order) =>
  Boolean(
    order &&
    SAFE_TERMINAL.has(order.status) &&
    order.platform_evidence_version === 1 &&
    order.platform_trade_state === order.status &&
    typeof order.platform_verified_at === 'string' &&
    !Number.isNaN(new Date(order.platform_verified_at).valueOf()) &&
    order.platform_env === 1 &&
    order.platform_app_id === order.app_id &&
    order.platform_open_id === order.open_id &&
    Number.isSafeInteger(order.platform_status) &&
    (order.status === 'REFUNDED'
      ? [0, 7, 8].includes(order.platform_order_type)
      : [0, 7].includes(order.platform_order_type)) &&
    (order.status !== 'REFUNDED' ||
      (typeof order.platform_wx_order_id === 'string' && order.platform_wx_order_id.length > 0)),
  );
const needsHistoricalVerification = (order) =>
  Boolean(order && SAFE_TERMINAL.has(order.status) && !hasReliableTerminalEvidence(order));
const isUnresolved = (order) =>
  Boolean(order && (UNRESOLVED.has(order.status) || needsHistoricalVerification(order)));
const isReconcilable = (order) =>
  Boolean(order && (RECONCILABLE.has(order.status) || needsHistoricalVerification(order)));
const hasReleasedTestHold = (order) => {
  const release = order?.purchase_hold_release;
  const confirmedAt =
    typeof release?.confirmed_at === 'string' ? new Date(release.confirmed_at) : null;
  return Boolean(
    order?.payment_provider === 'virtual' &&
    release &&
    release.version === 1 &&
    release.reason === 'confirmed_unpaid_test' &&
    confirmedAt &&
    !Number.isNaN(confirmedAt.valueOf()) &&
    confirmedAt.toISOString() === release.confirmed_at,
  );
};
const hasCancelledPurchase = (order) => {
  const cancelledAt = order?.purchase_cancelled_at;
  if (typeof cancelledAt !== 'string') return false;
  const cancelled = new Date(cancelledAt);
  return !Number.isNaN(cancelled.valueOf()) && cancelled.toISOString() === cancelledAt;
};
const projectedOrder = (order) =>
  needsHistoricalVerification(order)
    ? { ...order, status: 'PAYMENT_UNKNOWN', historical_status: order.status }
    : order;

module.exports = {
  SAFE_TERMINAL,
  hasReliableTerminalEvidence,
  needsHistoricalVerification,
  isUnresolved,
  isReconcilable,
  hasReleasedTestHold,
  hasCancelledPurchase,
  projectedOrder,
};

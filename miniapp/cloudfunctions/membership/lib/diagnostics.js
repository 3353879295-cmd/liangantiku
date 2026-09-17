'use strict';

const crypto = require('node:crypto');

// Keep this value in the deployed source so a log row identifies the exact diagnostics revision.
const REVISION = 'membership-random-diagnostics-20260908-v1';
const ORDER_REVISION = 'membership-order-diagnostics-20260912-rebuild-v1';
const PLATFORM_CODE_MIN = -999999999;
const PLATFORM_CODE_MAX = 999999999;
const BUSINESS_CODES = new Set([
  'UNAUTHENTICATED',
  'INVALID_REQUEST',
  'GRANT_NOT_FOUND',
  'INVALID_GRANT',
  'IDEMPOTENCY_CONFLICT',
  'DAILY_LIMIT_REACHED',
  'MEMBERSHIP_UNAVAILABLE',
]);
const PLATFORM_DETAILS = new Set([
  'ORDER_NOT_FOUND_EXPLICIT',
  'ORDER_NOT_FOUND_CONFIRMED',
  'OPENID_FIELD_ERROR',
  'ENV_FIELD_ERROR',
  'ORDER_ID_FIELD_ERROR',
  'SIGNATURE_FIELD_ERROR',
  'UNRECOGNIZED',
]);
const TRADE_STATES = new Set([
  'INITIALIZED',
  'NOTPAY',
  'SUCCESS',
  'CLOSED',
  'FAILED',
  'PAYERROR',
  'REVOKED',
  'REFUNDED',
]);
const digest = (value) =>
  typeof value === 'string' && value
    ? crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
    : null;
const safely = (read, fallback = null) => {
  try {
    return read();
  } catch {
    return fallback;
  }
};
const safeRead = (value, key) => safely(() => value && value[key]);
const safeTraceId = (value) =>
  typeof value === 'string' && /^p-[a-z0-9-]{4,32}$/.test(value) ? value : null;
const boundedPlatformCode = (value) =>
  Number.isSafeInteger(value) && value >= PLATFORM_CODE_MIN && value <= PLATFORM_CODE_MAX
    ? value
    : null;
const encodedPlatformError = (value) => {
  if (typeof value !== 'string') return null;
  const match = /^ORDER_PLATFORM_ERROR\[errcode=(0|-?[1-9]\d{0,8})\]$/.exec(value);
  if (!match) return null;
  const platformCode = boundedPlatformCode(Number(match[1]));
  return platformCode === null ? null : { code: 'ORDER_PLATFORM_ERROR', platformCode };
};
const platformRid = (value) => {
  if (typeof value !== 'string') return null;
  const match = /^([a-f\d]{8}(?:-[a-f\d]{8}){2})$/i.exec(value);
  return match ? match[1].toLowerCase() : null;
};
const sdkCode = (error) => {
  const value = safeRead(error, 'errCode');
  if (typeof value === 'number' && Number.isSafeInteger(value)) return `SDK_${value}`;
  if (typeof value === 'string' && /^-?\d{1,8}$/.test(value)) return `SDK_${value}`;
  return null;
};
const errorCode = (error) => {
  const diagnostic = safeRead(error, 'diagnostic');
  const diagnosticCode = safeRead(diagnostic, 'code');
  if (encodedPlatformError(diagnosticCode)) return diagnosticCode;
  if (typeof diagnosticCode === 'string' && /^ORDER_[A-Z_]{1,48}$/.test(diagnosticCode))
    return diagnosticCode;
  const businessCode = safeRead(error, 'code');
  if (BUSINESS_CODES.has(businessCode)) return businessCode;
  return sdkCode(error) || 'UNCLASSIFIED';
};
const errorDetails = (error, includeRid = false) => {
  const source = safeRead(error, 'diagnostic');
  if (!source || typeof source !== 'object') return null;
  const details = {};
  for (const key of ['httpStatus', 'platformCode', 'state']) {
    const value = safeRead(source, key);
    if (boundedPlatformCode(value) !== null) details[key] = value;
  }
  const platformDetail = safeRead(source, 'platformDetail');
  if (PLATFORM_DETAILS.has(platformDetail)) details.platformDetail = platformDetail;
  const rid = includeRid ? platformRid(safeRead(source, 'platformRid')) : null;
  if (rid) details.platformRid = rid;
  const httpOperation = safeRead(source, 'httpOperation');
  if (['token', 'query', 'provide', 'other'].includes(httpOperation))
    details.httpOperation = httpOperation;
  for (const key of ['orderMatch', 'environmentMatch', 'amountMatch', 'refundMatch']) {
    const value = safeRead(source, key);
    if (typeof value === 'boolean') details[key] = value;
  }
  return Object.keys(details).length ? details : null;
};
const reconcileErrorCode = (error, details) => {
  const code = errorCode(error);
  // CloudBase currently retains errorCode reliably when it drops adjacent fields.
  // Encode only the same bounded integer already admitted to errorDetails, so this
  // remains a compact, unambiguous diagnostic rather than an arbitrary payload.
  if (encodedPlatformError(code)) return code;
  if (details && boundedPlatformCode(details.platformCode) !== null)
    return `${code}[errcode=${details.platformCode}]`;
  return code;
};
const publicFailure = (error, businessCode = null) => {
  const result = {
    ok: false,
    error: { code: typeof businessCode === 'string' ? businessCode : 'MEMBERSHIP_UNAVAILABLE' },
  };
  // Only normalize a known, bounded platform code from an otherwise unclassified failure.
  // Never expose the diagnostic object itself: it may carry internal response data.
  if (businessCode !== null) return result;
  const diagnostic = safeRead(error, 'diagnostic');
  const diagnosticCode = safeRead(diagnostic, 'code');
  const encoded = encodedPlatformError(diagnosticCode);
  const code = encoded ? encoded.code : diagnosticCode;
  const platformCode = encoded ? encoded.platformCode : safeRead(diagnostic, 'platformCode');
  const httpStatus = code === 'ORDER_HTTP_STATUS' ? safeRead(diagnostic, 'httpStatus') : null;
  if (
    ['ORDER_PLATFORM_ERROR', 'ORDER_HTTP_STATUS'].includes(code) &&
    Number.isSafeInteger(platformCode) &&
    boundedPlatformCode(platformCode) !== null
  )
    result.error.diagnostic = {
      code,
      ...(code === 'ORDER_HTTP_STATUS' &&
      Number.isSafeInteger(httpStatus) &&
      boundedPlatformCode(httpStatus) !== null
        ? { httpStatus }
        : {}),
      platformCode,
    };
  return result;
};

const createDiagnostics = ({ logger, now = () => Date.now(), revision = REVISION } = {}) => {
  const emit = (channel, record) => {
    try {
      if (logger && typeof logger.info === 'function') logger.info(channel, record);
    } catch {
      // Diagnostics must never change authorization or quota behavior.
    }
  };
  const start = (action, event) => {
    const order = [
      'createOrder',
      'resumePayment',
      'markPaymentStarting',
      'markPaymentUnknown',
      'getOrder',
      'recoverOrders',
      'cancelPayment',
    ].includes(action);
    const observation = {
      action,
      startedAt: now(),
      request: digest(
        order
          ? safeRead(event, 'orderId') || safeRead(event, 'requestId')
          : safeRead(event, 'requestId') || safeRead(event, 'sessionId'),
      ),
      channel: order ? 'membership.order' : 'membership.random-practice',
      revision: order ? ORDER_REVISION : revision,
      ...(order && safeTraceId(safeRead(event, 'diagnosticTraceId'))
        ? { traceId: safeTraceId(safeRead(event, 'diagnosticTraceId')) }
        : {}),
    };
    emit(observation.channel, {
      revision: observation.revision,
      action,
      outcome: 'started',
      stage: 'validation',
      request: observation.request,
      ...(observation.traceId ? { traceId: observation.traceId } : {}),
    });
    return observation;
  };
  const finish = (observation, outcome, stage, error) => {
    if (!observation) return;
    const record = {
      revision: observation.revision,
      action: observation.action,
      outcome,
      stage,
      durationMs: Math.max(0, now() - observation.startedAt),
      request: observation.request,
      ...(observation.traceId ? { traceId: observation.traceId } : {}),
    };
    if (outcome === 'failed') {
      record.errorCode = errorCode(error);
      const details = errorDetails(error);
      if (details) record.errorDetails = details;
    }
    emit(observation.channel, record);
  };
  return {
    start: (...args) => safely(() => start(...args), null),
    complete: (...args) => safely(() => finish(args[0], 'completed', args[1]), undefined),
    fail: (...args) => safely(() => finish(args[0], 'failed', args[1], args[2]), undefined),
    reconcileFail: (orderId, error) =>
      safely(() => {
        const record = {
          revision: ORDER_REVISION,
          action: 'reconcilePendingOrders',
          outcome: 'failed',
          stage: 'reconcile',
          request: digest(orderId),
        };
        const details = errorDetails(error, true);
        // CloudBase log views can truncate nested objects. Project only the already-
        // whitelisted, bounded scalar fields before the error code; never copy the
        // diagnostic/source object or retain a nested errorDetails field.
        if (details) Object.assign(record, details);
        record.errorCode = reconcileErrorCode(error, details);
        emit('membership.order', record);
      }, undefined),
    reconcileSuccess: (orderId, proof) =>
      safely(() => {
        const tradeState = safeRead(proof, 'trade_state');
        if (!TRADE_STATES.has(tradeState)) return;
        const record = {
          revision: ORDER_REVISION,
          action: 'reconcilePendingOrders',
          outcome: 'completed',
          stage: 'reconcile',
          request: digest(orderId),
          tradeState,
        };
        const status = boundedPlatformCode(safeRead(proof, 'platform_status'));
        if (status !== null) record.platformStatus = status;
        emit('membership.order', record);
      }, undefined),
  };
};

module.exports = { createDiagnostics, publicFailure, REVISION, ORDER_REVISION };

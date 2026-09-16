import type {
  MembershipErrorCode,
  MembershipOrder,
  MembershipOrderResult,
  MembershipPayment,
  MembershipStatus,
} from '../types/membership';
import { MEMBERSHIP_STAGING_ENV_ID, canUseMembershipStaging } from '../config/membership';

export interface MembershipCallOptions {
  name: 'membership';
  data: MembershipWireRequest;
}

export type MembershipTransport = (options: MembershipCallOptions) => Promise<{
  result: unknown;
  requestID?: string;
}>;

export const MEMBERSHIP_REQUEST_TIMEOUT_MS = 12_000;

export type MembershipRequest =
  | { action: 'getPaymentContext' }
  | { action: 'getStatus' }
  | { action: 'checkPermission'; feature: string }
  | { action: 'startRandomPractice'; requestId: string; sessionId: string; questionIds: string[] }
  | { action: 'validateRandomPractice'; sessionId: string; questionIds: string[] }
  | { action: 'createOrder'; requestId: string }
  | { action: 'resumePayment'; orderId: string }
  | {
      action: 'markPaymentStarting';
      orderId: string;
      bridgeAttempt?: string;
      payment?: MembershipPayment;
    }
  | { action: 'markPaymentUnknown'; orderId: string }
  | { action: 'getOrder'; orderId: string }
  | { action: 'recoverOrders'; localOrderId?: string };

type MembershipWireRequest = (
  | Exclude<MembershipRequest, { action: 'createOrder' | 'resumePayment' }>
  | {
      action: 'createOrder' | 'resumePayment';
      requestId?: string;
      orderId?: string;
      loginCode: string;
    }
) & { diagnosticTraceId?: string; expectedPaymentAccountScope?: string };

export type MembershipResponse =
  | { accountScope: string }
  | MembershipStatus
  | MembershipOrderResult
  | {
      membership: MembershipStatus;
      pendingOrder?: MembershipOrder;
      releasedTestOrderId?: string;
    }
  | { allowed: boolean; membership: MembershipStatus }
  | { order: MembershipOrder; membership: MembershipStatus };

const ERROR_MESSAGES: Record<MembershipErrorCode, string> = {
  DAILY_LIMIT_REACHED: '今日免费练习次数已用完。',
  MEMBERSHIP_REQUIRED: '该功能需要开通会员。',
  PAYMENT_NOT_CONFIGURED: '会员支付暂未配置，请稍后再试。',
  INVALID_GRANT: '本次练习授权已失效，请重新开始。',
  GRANT_NOT_FOUND: '本次练习授权不存在，请重新开始。',
  IDEMPOTENCY_CONFLICT: '本次练习请求冲突，请重新开始。',
  UNAUTHENTICATED: '当前微信身份不可用，请重新进入小程序后重试。',
  INVALID_REQUEST: '请求无效，请重试。',
  ORDER_NOT_FOUND: '未找到订单，请刷新后重试。',
  MEMBERSHIP_UNAVAILABLE: '会员服务暂不可用，请稍后再试。',
  VIRTUAL_PAYMENT_UNSUPPORTED:
    '当前设备暂不支持会员支付，请更新微信后重试。iOS 需系统15及以上、微信8.0.68及以上。',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isOrderStatus = (value: unknown): value is MembershipOrder['status'] =>
  typeof value === 'string' &&
  [
    'PREPARED',
    'PAYMENT_STARTING',
    'PAYMENT_UNKNOWN',
    'PENDING',
    'PAID',
    'CLOSED',
    'FAILED',
    'REFUNDED',
  ].includes(value);

const isStatus = (value: unknown): value is MembershipStatus =>
  isRecord(value) &&
  typeof value.isMember === 'boolean' &&
  (value.startsAt === null || isIsoDate(value.startsAt)) &&
  (value.expiresAt === null || isIsoDate(value.expiresAt)) &&
  isNonNegativeInteger(value.freeUsed) &&
  isNonNegativeInteger(value.freeRemaining) &&
  value.freeLimit === 3 &&
  isDateKey(value.freeDate) &&
  isIsoDate(value.serverTime) &&
  typeof value.paymentAvailable === 'boolean' &&
  (value.paymentUnavailableReason === undefined ||
    ['DISABLED', 'MISSING_CONFIGURATION', 'APP_ID_MISMATCH'].includes(
      value.paymentUnavailableReason as string,
    )) &&
  (!value.isMember ||
    (isIsoDate(value.expiresAt) && Date.parse(value.expiresAt) > Date.parse(value.serverTime)));

const isOrder = (value: unknown): value is MembershipOrder =>
  isRecord(value) &&
  typeof value.orderId === 'string' &&
  isOrderStatus(value.status) &&
  value.amount === 2800 &&
  (value.paidAt === null || isIsoDate(value.paidAt));

const isPayment = (value: unknown, orderId: string): value is MembershipPayment => {
  if (
    !isRecord(value) ||
    !/^[A-Za-z0-9|*@-][A-Za-z0-9_|*@-]{7,31}$/.test(orderId) ||
    value.mode !== 'short_series_goods' ||
    typeof value.signData !== 'string' ||
    ![value.paySig, value.signature].every(
      (signature) => typeof signature === 'string' && /^[\da-f]{64}$/i.test(signature),
    )
  )
    return false;
  try {
    const signData: unknown = JSON.parse(value.signData);
    return (
      isRecord(signData) &&
      signData.env === 0 &&
      signData.currencyType === 'CNY' &&
      signData.buyQuantity === 1 &&
      signData.goodsPrice === 2800 &&
      (signData.activitySellingPrice === undefined || signData.activitySellingPrice === 2800) &&
      signData.outTradeNo === orderId &&
      signData.attach === orderId &&
      signData.offerId === '1450639573' &&
      signData.productId === 'warehouse_member_6m'
    );
  } catch {
    return false;
  }
};
const isPaymentAccountScope = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{64}$/i.test(value);
const isBridgeAttempt = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

const isOrderResult = (value: unknown): value is MembershipOrderResult =>
  isRecord(value) &&
  isOrder(value.order) &&
  (value.canStartPayment === undefined || typeof value.canStartPayment === 'boolean') &&
  (value.bridgeLease === undefined || typeof value.bridgeLease === 'boolean') &&
  (value.bridgeAttempt === undefined || isBridgeAttempt(value.bridgeAttempt)) &&
  // A payment payload is an authorization to invoke a native cashier only
  // when the server says so explicitly.  Reject malformed combinations at
  // the trust boundary instead of leaving that decision to the page.
  (value.order.status === 'PAYMENT_STARTING' && typeof value.bridgeLease === 'boolean'
    ? value.payment === undefined
    : value.canStartPayment !== true
      ? value.payment === undefined
      : value.order.status === 'PREPARED' &&
        value.payment !== undefined &&
        isPayment(value.payment, value.order.orderId) &&
        isBridgeAttempt(value.bridgeAttempt));

const readSuccessData = (value: unknown): unknown =>
  isRecord(value) && value.ok === true && Object.hasOwn(value, 'data') ? value.data : undefined;

const withTimeout = <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Preserve SDK errors and consume late rejections.
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new MembershipTimeoutError('MEMBERSHIP_UNAVAILABLE')),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};

export class MembershipError extends Error {
  constructor(
    readonly code: MembershipErrorCode,
    message = ERROR_MESSAGES[code],
  ) {
    super(message);
    this.name = 'MembershipError';
  }
}

class MembershipTimeoutError extends MembershipError {}
const unavailable = () => new MembershipError('MEMBERSHIP_UNAVAILABLE');

const readError = (value: unknown): MembershipError | null => {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) return null;
  const code = value.error.code;
  return typeof code === 'string' && Object.hasOwn(ERROR_MESSAGES, code)
    ? new MembershipError(code as MembershipErrorCode)
    : unavailable();
};
const TRACE = /^p-[a-z0-9-]{4,32}$/i;
const tracedAction = (action: MembershipRequest['action']): boolean =>
  [
    'getPaymentContext',
    'createOrder',
    'resumePayment',
    'markPaymentStarting',
    'markPaymentUnknown',
    'getOrder',
    'recoverOrders',
  ].includes(action);
const paymentAction = (action: MembershipRequest['action']): boolean =>
  [
    'createOrder',
    'resumePayment',
    'markPaymentStarting',
    'markPaymentUnknown',
    'getOrder',
    'recoverOrders',
  ].includes(action);
const safeTrace = (value: string | undefined): string | undefined =>
  value && TRACE.test(value) ? value : undefined;
const diagnostic = (entry: Record<string, unknown>): void => {
  try {
    console.info('membership_request', entry);
    wx.getLogManager({ level: 1 }).warn('membership_request', entry);
  } catch {
    /* diagnostics never alter a request */
  }
};

export class MembershipClient {
  constructor(
    private readonly callFunction: MembershipTransport = (options) => {
      const envVersion = wx.getAccountInfoSync().miniProgram.envVersion;
      if (!canUseMembershipStaging(envVersion)) throw unavailable();
      return wx.cloud.callFunction({ ...options, config: { env: MEMBERSHIP_STAGING_ENV_ID } });
    },
    private readonly login: () => Promise<string> = async () => {
      const { code } = await wx.login();
      if (!code) throw new MembershipError('UNAUTHENTICATED');
      return code;
    },
    private readonly timeoutMs = MEMBERSHIP_REQUEST_TIMEOUT_MS,
  ) {}

  async getPaymentAccountScope(traceId?: string): Promise<string> {
    const context = await this.call({ action: 'getPaymentContext' }, traceId);
    if (!('accountScope' in context) || !isPaymentAccountScope(context.accountScope))
      throw unavailable();
    return context.accountScope;
  }

  async call(
    request: MembershipRequest,
    traceId?: string,
    expectedPaymentAccountScope?: string,
  ): Promise<MembershipResponse> {
    const started = Date.now();
    const trace = tracedAction(request.action) ? safeTrace(traceId) : undefined;
    let phase = ['createOrder', 'resumePayment'].includes(request.action) ? 'login' : 'transport';
    let requestID: string | undefined;
    try {
      if (
        paymentAction(request.action) &&
        expectedPaymentAccountScope !== undefined &&
        !isPaymentAccountScope(expectedPaymentAccountScope)
      )
        throw unavailable();
      const deadline = Date.now() + this.timeoutMs;
      const remainingTimeout = (): number => Math.max(1, deadline - Date.now());
      const authenticated =
        request.action === 'createOrder' || request.action === 'resumePayment'
          ? { ...request, loginCode: await withTimeout(this.login(), remainingTimeout()) }
          : request;
      const expected =
        paymentAction(request.action) && isPaymentAccountScope(expectedPaymentAccountScope)
          ? { expectedPaymentAccountScope }
          : {};
      const data: MembershipWireRequest = {
        ...authenticated,
        ...expected,
        ...(trace ? { diagnosticTraceId: trace } : {}),
      };
      phase = 'transport';
      diagnostic({
        action: request.action,
        phase: 'started',
        traceId: trace,
        cloudEnv: MEMBERSHIP_STAGING_ENV_ID,
      });
      const response = await withTimeout(
        this.callFunction({ name: 'membership', data }),
        remainingTimeout(),
      );
      requestID = response.requestID;
      phase = 'response';
      const businessError = readError(response.result);
      if (businessError) throw businessError;
      const successData = readSuccessData(response.result);
      if (
        request.action === 'recoverOrders' &&
        isRecord(successData) &&
        isStatus(successData.membership)
      ) {
        const pendingOrder = isOrder(successData.pendingOrder)
          ? successData.pendingOrder
          : undefined;
        if (
          pendingOrder !== undefined &&
          !['PREPARED', 'PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING'].includes(
            pendingOrder.status,
          )
        )
          throw unavailable();
        if (successData.pendingOrder !== undefined && pendingOrder === undefined)
          throw unavailable();
        const releasedTestOrderId =
          typeof successData.releasedTestOrderId === 'string'
            ? successData.releasedTestOrderId
            : undefined;
        if (successData.releasedTestOrderId !== undefined && releasedTestOrderId === undefined)
          throw unavailable();
        if (
          releasedTestOrderId !== undefined &&
          !/^[A-Za-z0-9|*@-][A-Za-z0-9_|*@-]{7,31}$/.test(releasedTestOrderId)
        )
          throw unavailable();
        if (
          releasedTestOrderId !== undefined &&
          (request.localOrderId === undefined || releasedTestOrderId !== request.localOrderId)
        )
          throw unavailable();
        diagnostic({
          action: request.action,
          phase: 'validated',
          traceId: trace,
          elapsedMs: Date.now() - started,
          orderStatus: pendingOrder?.status,
          paymentAvailable: successData.membership.paymentAvailable,
        });
        if (pendingOrder !== undefined || releasedTestOrderId !== undefined)
          return {
            membership: successData.membership,
            ...(pendingOrder !== undefined ? { pendingOrder } : {}),
            ...(releasedTestOrderId !== undefined ? { releasedTestOrderId } : {}),
          };
        return successData.membership;
      }
      if (request.action === 'getStatus' && isStatus(successData)) return successData;
      if (
        request.action === 'getPaymentContext' &&
        isRecord(successData) &&
        isPaymentAccountScope(successData.accountScope)
      )
        return { accountScope: successData.accountScope };
      if (
        (request.action === 'validateRandomPractice' ||
          request.action === 'startRandomPractice' ||
          request.action === 'recoverOrders') &&
        isRecord(successData) &&
        isStatus(successData.membership)
      ) {
        diagnostic({
          action: request.action,
          phase: 'validated',
          traceId: trace,
          elapsedMs: Date.now() - started,
          paymentAvailable: successData.membership.paymentAvailable,
        });
        return successData.membership;
      }
      if (
        request.action === 'checkPermission' &&
        isRecord(successData) &&
        typeof successData.allowed === 'boolean' &&
        isStatus(successData.membership)
      )
        return { allowed: successData.allowed, membership: successData.membership };
      if (request.action === 'createOrder' && isOrderResult(successData)) {
        diagnostic({
          action: request.action,
          phase: 'validated',
          traceId: trace,
          elapsedMs: Date.now() - started,
          orderStatus: successData.order.status,
          canStartPayment: successData.canStartPayment === true,
          paymentValid: successData.payment !== undefined,
        });
        return successData;
      }
      if (request.action === 'resumePayment' && isOrderResult(successData)) {
        diagnostic({
          action: request.action,
          phase: 'validated',
          traceId: trace,
          elapsedMs: Date.now() - started,
          orderStatus: successData.order.status,
          canStartPayment: successData.canStartPayment === true,
          paymentValid: successData.payment !== undefined,
        });
        return successData;
      }
      if (
        request.action === 'markPaymentStarting' &&
        isOrderResult(successData) &&
        successData.order.status === 'PAYMENT_STARTING' &&
        typeof successData.bridgeLease === 'boolean'
      ) {
        diagnostic({
          action: request.action,
          phase: 'validated',
          traceId: trace,
          elapsedMs: Date.now() - started,
          orderStatus: successData.order.status,
          canStartPayment: successData.canStartPayment === true,
        });
        return successData;
      }
      if (
        request.action === 'markPaymentUnknown' &&
        isOrderResult(successData) &&
        successData.payment === undefined
      ) {
        diagnostic({
          action: request.action,
          phase: 'validated',
          traceId: trace,
          elapsedMs: Date.now() - started,
          orderStatus: successData.order.status,
        });
        return successData;
      }
      if (
        request.action === 'getOrder' &&
        isRecord(successData) &&
        isOrder(successData.order) &&
        isStatus(successData.membership)
      ) {
        diagnostic({
          action: request.action,
          phase: 'validated',
          traceId: trace,
          elapsedMs: Date.now() - started,
          orderStatus: successData.order.status,
          paymentAvailable: successData.membership.paymentAvailable,
        });
        return { order: successData.order, membership: successData.membership };
      }
      throw unavailable();
    } catch (error) {
      try {
        const trace = requestID ?? (isRecord(error) ? error.requestID : undefined);
        diagnostic({
          action: request.action,
          phase,
          elapsedMs: Date.now() - started,
          outcome: error instanceof MembershipTimeoutError ? 'timeout' : 'failed',
          code: error instanceof MembershipError ? error.code : 'MEMBERSHIP_UNAVAILABLE',
          sdkCode: isRecord(error) && typeof error.errCode === 'number' ? error.errCode : undefined,
          requestID: typeof trace === 'string' && /^[\da-f-]{36}$/i.test(trace) ? trace : undefined,
        });
      } catch {
        /* Best-effort diagnostics. */
      }
      if (error instanceof MembershipError) throw error;
      throw unavailable();
    }
  }
}

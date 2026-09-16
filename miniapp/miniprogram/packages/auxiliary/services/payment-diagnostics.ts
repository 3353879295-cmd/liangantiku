interface DiagnosticDetail {
  errCode?: number | undefined;
  errMsg?: string;
  queryResult?: string;
  traceId?: string | undefined;
  elapsedMs?: number;
  reason?: string;
  late?: boolean;
}

interface SafeSystemInfo {
  platform?: string;
  system?: string;
  version?: string;
  SDKVersion?: string;
}

const maskOrderId = (orderId: string | undefined): string | undefined => {
  if (!orderId) return undefined;
  if (orderId.length <= 7) return '*'.repeat(orderId.length);
  return `${orderId.slice(0, 3)}***${orderId.slice(-4)}`;
};

const safeMessage = (message: string | undefined): string | undefined => {
  if (!message) return undefined;
  const value = message.toLowerCase();
  if (value.includes('cancel')) return 'cancel';
  if (value.includes('unsupported')) return 'unsupported';
  if (value.includes('timeout')) return 'timeout';
  if (value.includes('network')) return 'network';
  if (value.includes('system_error')) return 'system_error';
  if (value.includes('unknown')) return 'unknown';
  return 'failed';
};

const safeQueryResult = (result: string | undefined): string | undefined => {
  if (!result) return undefined;
  const value = result.toUpperCase();
  return (
    [
      'PREPARED',
      'PAYMENT_STARTING',
      'PAYMENT_UNKNOWN',
      'PAID',
      'PENDING',
      'CLOSED',
      'FAILED',
      'REFUNDED',
    ].find((status) => value === status) ?? 'UNKNOWN'
  );
};
const safeEnum = (value: string | undefined): string | undefined =>
  value && /^[A-Z0-9_:-]{1,48}$/i.test(value) ? value : undefined;
export const createPaymentTraceId = (): string =>
  `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Emits only the payment fields that are safe for client-side diagnosis. */
export const logPaymentDiagnostic = (
  stage: string,
  orderId?: string,
  detail: DiagnosticDetail = {},
): void => {
  try {
    const info = wx.getSystemInfoSync() as SafeSystemInfo;
    const entry = {
      stage: stage.replace(/[^a-z0-9_:-]/gi, '_').slice(0, 48),
      orderId: maskOrderId(orderId),
      errCode: detail.errCode,
      errMsg: safeMessage(detail.errMsg),
      queryResult: safeQueryResult(detail.queryResult),
      traceId:
        typeof detail.traceId === 'string' && /^p-[a-z0-9-]{4,32}$/i.test(detail.traceId)
          ? detail.traceId
          : undefined,
      elapsedMs:
        typeof detail.elapsedMs === 'number' && detail.elapsedMs >= 0
          ? Math.min(Math.round(detail.elapsedMs), 120_000)
          : undefined,
      reason: safeEnum(detail.reason),
      late: typeof detail.late === 'boolean' ? detail.late : undefined,
      platform: info.platform,
      system: info.system,
      version: info.version,
      SDKVersion: info.SDKVersion,
    };
    console.info('membership_payment', entry);
    wx.getLogManager({ level: 1 }).warn('membership_payment', entry);
  } catch {
    // Diagnostics must never change the payment result.
  }
};

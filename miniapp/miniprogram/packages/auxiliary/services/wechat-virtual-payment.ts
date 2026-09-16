import { MembershipError } from '../../../repositories/membership-client';
import type { MembershipPayment } from '../../../types/membership';
import { logPaymentDiagnostic } from './payment-diagnostics';

export interface VirtualPaymentSystemInfo {
  platform?: string;
  system?: string;
  version?: string;
}

export interface VirtualPaymentPlatform {
  canIUse(api: string): boolean;
  requestVirtualPayment(
    options: WechatMiniprogram.RequestVirtualPaymentOption,
  ): void | Promise<unknown>;
  getSystemInfoSync(): VirtualPaymentSystemInfo;
}

export type VirtualPaymentOutcome = 'cancelled' | 'unknown' | 'failed';

export interface NormalizedVirtualPaymentError {
  outcome: VirtualPaymentOutcome;
  errCode?: number;
  errMsg: string;
}

const errorCode = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null || !('errCode' in error)) return undefined;
  const value = error.errCode;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const errorMessage = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'errMsg' in error) {
    const value = error.errMsg;
    return typeof value === 'string' ? value : '';
  }
  return '';
};

/** Converts WeChat runtime errors into safe, actionable payment outcomes. */
export const normalizeVirtualPaymentError = (error: unknown): NormalizedVirtualPaymentError => {
  const errCode = errorCode(error);
  const source = errorMessage(error).toLowerCase();
  const includes = (value: string): boolean => source.includes(value);
  const outcome =
    errCode === -2 || includes('cancel') || includes('取消')
      ? 'cancelled'
      : includes('not support') || includes('unsupported') || includes('不支持')
        ? 'failed'
        : includes('timeout') ||
            includes('网络') ||
            includes('network') ||
            includes('systemerror') ||
            includes('system error') ||
            includes('system_error')
          ? 'unknown'
          : 'unknown';
  const errMsg =
    outcome === 'cancelled'
      ? 'requestVirtualPayment:cancel'
      : includes('not support') || includes('unsupported') || includes('不支持')
        ? 'requestVirtualPayment:unsupported'
        : includes('timeout')
          ? 'requestVirtualPayment:timeout'
          : includes('网络') || includes('network')
            ? 'requestVirtualPayment:network'
            : includes('systemerror') || includes('system error') || includes('system_error')
              ? 'requestVirtualPayment:system_error'
              : outcome === 'unknown'
                ? 'requestVirtualPayment:unknown'
                : 'requestVirtualPayment:failed';
  return errCode === undefined ? { outcome, errMsg } : { outcome, errCode, errMsg };
};

export class VirtualPaymentError extends Error {
  readonly outcome: VirtualPaymentOutcome;
  readonly errCode?: number;
  readonly errMsg: string;

  constructor(error: unknown) {
    const normalized = normalizeVirtualPaymentError(error);
    super(normalized.errMsg);
    this.name = 'VirtualPaymentError';
    this.outcome = normalized.outcome;
    if (normalized.errCode !== undefined) this.errCode = normalized.errCode;
    this.errMsg = normalized.errMsg;
  }
}

const compareVersion = (left: string, right: string): number => {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const iosVersion = (system: string | undefined): string | null => {
  const match = system?.match(/(?:iOS|iPhone OS)\s+(\d+(?:\.\d+)*)/i);
  return match?.[1] ?? null;
};

const defaultPlatform: VirtualPaymentPlatform = {
  canIUse: (api) => wx.canIUse(api),
  requestVirtualPayment: (options) => wx.requestVirtualPayment(options),
  getSystemInfoSync: () => wx.getSystemInfoSync(),
};

const preflightFailures = new WeakSet<object>();

export const isVirtualPaymentPreflightFailure = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && preflightFailures.has(error);

export class WechatVirtualPayment {
  constructor(
    private readonly platform: VirtualPaymentPlatform = defaultPlatform,
    private readonly watchdogMs = 30_000,
  ) {}

  preflight(): void {
    this.assertSupported();
  }

  async request(payment: MembershipPayment, traceId?: string): Promise<void> {
    const started = Date.now();
    const log = (
      stage: string,
      detail: { errCode?: number | undefined; errMsg?: string; late?: boolean } = {},
    ) =>
      logPaymentDiagnostic(stage, undefined, {
        ...detail,
        traceId,
        elapsedMs: Date.now() - started,
      });
    try {
      this.preflight();
    } catch (error) {
      log('native_preflight_rejected');
      if (error instanceof MembershipError && error.code === 'VIRTUAL_PAYMENT_UNSUPPORTED') {
        preflightFailures.add(error);
      }
      throw error;
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const watchdog = setTimeout(() => {
        settleFailure({ errMsg: 'requestVirtualPayment:timeout' }, 'watchdog');
      }, this.watchdogMs);
      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        callback();
      };
      const settleFailure = (error: unknown, stage: string): void => {
        const paymentError = new VirtualPaymentError(error);
        log(stage, { errCode: paymentError.errCode, errMsg: paymentError.errMsg, late: settled });
        settle(() => reject(paymentError));
      };
      const settleComplete = (result: unknown): void => {
        log('native_complete', { late: settled });
        const message = errorMessage(result).toLowerCase();
        if (
          message.endsWith(':ok') &&
          (errorCode(result) === undefined || errorCode(result) === 0)
        ) {
          settle(resolve);
          return;
        }
        settleFailure(result, 'complete');
      };

      try {
        log('native_invoke');
        const returned = this.platform.requestVirtualPayment({
          mode: payment.mode,
          signData: payment.signData as unknown as WechatMiniprogram.SignData,
          paySig: payment.paySig,
          signature: payment.signature,
          success: () => {
            log('native_success', { late: settled });
            settle(resolve);
          },
          fail: (error) => settleFailure(error, 'native_fail'),
          complete: (result) => settleComplete(result),
        });
        if (returned && typeof returned.then === 'function') {
          void Promise.resolve(returned).catch((error: unknown) =>
            settleFailure(error, 'returned_rejection'),
          );
        }
      } catch (error) {
        settleFailure(error, 'sync_throw');
      }
    });
  }

  private assertSupported(): void {
    if (!this.platform.canIUse('requestVirtualPayment')) {
      throw new MembershipError('VIRTUAL_PAYMENT_UNSUPPORTED');
    }
    const info = this.platform.getSystemInfoSync();
    const platform = info.platform?.toLowerCase();
    if (platform === 'ios') {
      const version = iosVersion(info.system);
      if (
        version === null ||
        compareVersion(version, '15') < 0 ||
        compareVersion(info.version ?? '0', '8.0.68') < 0
      ) {
        throw new MembershipError('VIRTUAL_PAYMENT_UNSUPPORTED');
      }
      return;
    }
    if (platform === 'android' || platform === 'harmony' || platform === 'windows') return;
    throw new MembershipError('VIRTUAL_PAYMENT_UNSUPPORTED');
  }
}

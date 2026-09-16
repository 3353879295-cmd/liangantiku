import { describe, expect, it, vi } from 'vitest';
import {
  isVirtualPaymentPreflightFailure,
  normalizeVirtualPaymentError,
  VirtualPaymentError,
  WechatVirtualPayment,
  type VirtualPaymentPlatform,
} from '../miniprogram/packages/auxiliary/services/wechat-virtual-payment';
import { logPaymentDiagnostic } from '../miniprogram/packages/auxiliary/services/payment-diagnostics';
import type { MembershipPayment } from '../miniprogram/types/membership';

const payment: MembershipPayment = {
  mode: 'short_series_goods',
  signData: '{"outTradeNo":"order-1","goodsPrice":2800}',
  paySig: 'a'.repeat(64),
  signature: 'b'.repeat(64),
};

const platform = (overrides: Partial<VirtualPaymentPlatform> = {}) => ({
  canIUse: vi.fn().mockReturnValue(true),
  requestVirtualPayment: vi.fn((options: WechatMiniprogram.RequestVirtualPaymentOption) => {
    options.success?.({ errMsg: 'requestVirtualPayment:ok' });
  }),
  getSystemInfoSync: vi.fn().mockReturnValue({ platform: 'android', version: '8.0.0' }),
  ...overrides,
});

describe('WechatVirtualPayment', () => {
  it('exposes the compatibility check without opening the payment bridge', () => {
    const runtime = platform({ getSystemInfoSync: vi.fn().mockReturnValue({ platform: 'mac' }) });
    let failure: unknown;
    try {
      new WechatVirtualPayment(runtime).preflight();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'VIRTUAL_PAYMENT_UNSUPPORTED' });
    expect(runtime.requestVirtualPayment).not.toHaveBeenCalled();
  });

  it('brands only its second preflight failure for a same-order retry', async () => {
    const runtime = platform({ canIUse: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) });
    const paymentBridge = new WechatVirtualPayment(runtime);
    paymentBridge.preflight();

    let failure: unknown;
    try {
      await paymentBridge.request(payment);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'VIRTUAL_PAYMENT_UNSUPPORTED' });
    expect(isVirtualPaymentPreflightFailure(failure)).toBe(true);
    expect(runtime.requestVirtualPayment).not.toHaveBeenCalled();
  });

  it('passes the server signed payload through byte-for-byte', async () => {
    const runtime = platform();
    await new WechatVirtualPayment(runtime).request(payment);
    expect(runtime.requestVirtualPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'short_series_goods',
        signData: payment.signData,
        paySig: payment.paySig,
        signature: payment.signature,
      }),
    );
  });

  it('does not call payment on unsupported platforms', async () => {
    const runtime = platform({ getSystemInfoSync: vi.fn().mockReturnValue({ platform: 'mac' }) });
    await expect(new WechatVirtualPayment(runtime).request(payment)).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_UNSUPPORTED',
    });
    expect(runtime.requestVirtualPayment).not.toHaveBeenCalled();
  });

  it('requires iOS 15 and WeChat 8.0.68', async () => {
    const runtime = platform({
      getSystemInfoSync: vi.fn().mockReturnValue({
        platform: 'ios',
        system: 'iOS 14.8',
        version: '8.0.68',
      }),
    });
    await expect(new WechatVirtualPayment(runtime).request(payment)).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_UNSUPPORTED',
    });
  });

  it.each([
    ['8.0.67', false],
    ['8.0.68', true],
    ['8.0.69', true],
    ['8.1.0', true],
  ])('supports iOS 15 with WeChat %s: %s', async (version, supported) => {
    const runtime = platform({
      getSystemInfoSync: vi.fn().mockReturnValue({
        platform: 'ios',
        system: 'iOS 15.0',
        version,
      }),
    });
    const request = new WechatVirtualPayment(runtime).request(payment);

    if (supported) {
      await expect(request).resolves.toBeUndefined();
      expect(runtime.requestVirtualPayment).toHaveBeenCalledOnce();
    } else {
      await expect(request).rejects.toMatchObject({ code: 'VIRTUAL_PAYMENT_UNSUPPORTED' });
      expect(runtime.requestVirtualPayment).not.toHaveBeenCalled();
    }
  });

  it('does not call payment when requestVirtualPayment is unavailable', async () => {
    const runtime = platform({ canIUse: vi.fn().mockReturnValue(false) });
    await expect(new WechatVirtualPayment(runtime).request(payment)).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_UNSUPPORTED',
    });
    expect(runtime.requestVirtualPayment).not.toHaveBeenCalled();
  });

  it('settles an otherwise callback-less attempt through the watchdog', async () => {
    vi.useFakeTimers();
    const runtime = platform({ requestVirtualPayment: vi.fn() });
    const request = new WechatVirtualPayment(runtime, 30).request(payment);
    const expected = expect(request).rejects.toMatchObject({
      outcome: 'unknown',
      errMsg: 'requestVirtualPayment:timeout',
    });
    await vi.advanceTimersByTimeAsync(30);
    await expected;
    vi.useRealTimers();
  });

  it('uses complete as a safe fallback when it arrives without success', async () => {
    const runtime = platform({
      requestVirtualPayment: vi.fn((options: WechatMiniprogram.RequestVirtualPaymentOption) => {
        options.complete?.({ errCode: 0, errMsg: 'requestVirtualPayment:ok' });
      }),
    });
    await expect(new WechatVirtualPayment(runtime).request(payment)).resolves.toBeUndefined();
  });

  it('uses complete failures to release the caller as an unknown result', async () => {
    const runtime = platform({
      requestVirtualPayment: vi.fn((options: WechatMiniprogram.RequestVirtualPaymentOption) => {
        options.complete?.({ errCode: 1, errMsg: 'requestVirtualPayment:fail system error' });
      }),
    });
    await expect(new WechatVirtualPayment(runtime).request(payment)).rejects.toMatchObject({
      outcome: 'unknown',
      errMsg: 'requestVirtualPayment:system_error',
    });
  });

  it('treats an empty complete callback as unknown rather than unpaid', async () => {
    const runtime = platform({
      requestVirtualPayment: vi.fn((options: WechatMiniprogram.RequestVirtualPaymentOption) => {
        options.complete?.({ errCode: 0, errMsg: '' });
      }),
    });
    await expect(new WechatVirtualPayment(runtime).request(payment)).rejects.toMatchObject({
      outcome: 'unknown',
    });
  });

  it('consumes late success and promise rejection after watchdog settlement', async () => {
    vi.useFakeTimers();
    let callbacks: WechatMiniprogram.RequestVirtualPaymentOption | undefined;
    let rejectReturned: ((error: Error) => void) | undefined;
    const runtime = platform({
      requestVirtualPayment: vi.fn((options: WechatMiniprogram.RequestVirtualPaymentOption) => {
        callbacks = options;
        return new Promise((_, reject) => {
          rejectReturned = reject;
        });
      }),
    });
    try {
      const request = new WechatVirtualPayment(runtime, 30).request(payment);
      const expected = expect(request).rejects.toMatchObject({ outcome: 'unknown' });
      await vi.advanceTimersByTimeAsync(30);
      await expected;
      callbacks?.success?.({ errMsg: 'requestVirtualPayment:ok' });
      rejectReturned?.(new Error('SystemError timeout'));
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles once when late callbacks arrive after success', async () => {
    let callbacks: WechatMiniprogram.RequestVirtualPaymentOption | undefined;
    const runtime = platform({
      requestVirtualPayment: vi.fn((options: WechatMiniprogram.RequestVirtualPaymentOption) => {
        callbacks = options;
        options.success?.({ errMsg: 'requestVirtualPayment:ok' });
      }),
    });
    const request = new WechatVirtualPayment(runtime).request(payment);
    callbacks?.fail?.({ errCode: -2, errMsg: 'requestVirtualPayment:cancel' });
    callbacks?.complete?.({ errCode: 1, errMsg: 'requestVirtualPayment:fail system error' });
    await expect(request).resolves.toBeUndefined();
  });

  it('consumes rejected promises returned by unusual bridge implementations', async () => {
    const runtime = platform({
      requestVirtualPayment: vi.fn(() => Promise.reject(new Error('SystemError timeout'))),
    });
    await expect(new WechatVirtualPayment(runtime).request(payment)).rejects.toMatchObject({
      outcome: 'unknown',
      errMsg: 'requestVirtualPayment:timeout',
    });
  });

  it.each([
    [
      { errCode: -2, errMsg: 'requestVirtualPayment:cancel' },
      'cancelled',
      'requestVirtualPayment:cancel',
    ],
    [
      { errMsg: 'requestVirtualPayment:fail not support' },
      'failed',
      'requestVirtualPayment:unsupported',
    ],
    [
      { errMsg: 'SystemError timeout secret-signature' },
      'unknown',
      'requestVirtualPayment:timeout',
    ],
    [{ errMsg: 'other failure paySig=secret' }, 'unknown', 'requestVirtualPayment:unknown'],
  ])('normalizes payment errors without exposing raw error data', (error, outcome, errMsg) => {
    expect(normalizeVirtualPaymentError(error)).toMatchObject({ outcome, errMsg });
    expect(new VirtualPaymentError(error).message).toBe(errMsg);
  });

  it('logs only masked order ids and whitelisted diagnostic fields', () => {
    const warn = vi.fn();
    vi.stubGlobal('wx', {
      getSystemInfoSync: vi.fn(() => ({
        platform: 'android',
        system: 'Android 15',
        version: '8.0.0',
        SDKVersion: '3.0.0',
        openId: 'sensitive',
      })),
      getLogManager: vi.fn(() => ({ warn })),
    });
    logPaymentDiagnostic('payment callback!', 'ORD1234567', {
      errCode: -2,
      errMsg: 'requestVirtualPayment:cancel signData=secret',
      queryResult: 'PAID user-openid',
    });
    expect(warn).toHaveBeenCalledWith(
      'membership_payment',
      expect.objectContaining({
        stage: 'payment_callback_',
        orderId: 'ORD***4567',
        errCode: -2,
        errMsg: 'cancel',
        queryResult: 'UNKNOWN',
        platform: 'android',
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    vi.unstubAllGlobals();
  });
});

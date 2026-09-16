import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type MemberPage = {
  data: Record<string, unknown>;
  onLoad(): void;
  onHide(): void;
  onShow(): void;
  onUnload(): void;
  onPurchase(): Promise<void>;
  onRefresh(): Promise<void>;
  onQueryPending(): Promise<void>;
  onCopyPendingOrder(): void;
  loadMembership(): Promise<void>;
  applyPurchaseResult(result: unknown): Promise<void>;
};

const status = {
  isMember: false,
  startsAt: null,
  expiresAt: null,
  freeUsed: 0,
  freeRemaining: 3,
  freeLimit: 3,
  freeDate: '2026-09-05',
  serverTime: '2026-09-05T00:00:00Z',
  paymentAvailable: true,
};

describe('member page', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the required price, benefits, and payment action', () => {
    const markup = readFileSync(
      resolve(import.meta.dirname, '../miniprogram/packages/auxiliary/pages/member/index.wxml'),
      'utf8',
    );
    for (const text of [
      '¥28',
      '半年内不限次数刷题',
      '解锁完整刷题功能',
      '不受每日3次随机练习限制',
      '立即开通 ¥28',
      '继续支付 ¥28',
      '请先检查支付结果',
      '继续支付 ¥28',
      '可以重新购买 ¥28',
    ])
      expect(markup).toContain(text);
    expect(markup).toContain("transactionStage === 'PREPARED'");
    expect(markup).toContain("transactionStage === 'PAYMENT_UNKNOWN'");
    expect(markup).toContain("transactionStage === 'PENDING'");
    expect(markup).not.toContain('平台处理中，请检查支付结果');
    expect(markup).toContain('disabled="{{loading || purchasing}}" bind:tap="onQueryPending"');
    expect(markup).toContain('bind:tap="onRefresh"');
  });

  it('drives a fresh page purchase through the real service into wx.requestVirtualPayment once', async () => {
    vi.resetModules();
    vi.doUnmock('../miniprogram/packages/auxiliary/services/membership-service');
    let definition: MemberPage | undefined;
    const values = new Map<string, unknown>([
      ['membership.cached-status.v1', { isMember: true, expiresAt: '2099-01-01T00:00:00Z' }],
      ['grain-practice:progress', { answered: 20 }],
      ['grain-practice:sync-outbox', [{ id: 'keep-me' }]],
      ['grain-practice:random-usage', { used: 3 }],
    ]);
    const requestVirtualPayment = vi.fn(
      (options: WechatMiniprogram.RequestVirtualPaymentOption) => {
        options.success?.({ errMsg: 'requestVirtualPayment:ok' });
      },
    );
    const actions: string[] = [];
    const paidMembership = {
      ...status,
      isMember: true,
      startsAt: '2026-09-09T00:00:00.000Z',
      expiresAt: '2027-03-09T00:00:00.000Z',
      serverTime: '2026-09-09T00:00:00.000Z',
    };
    const freeMembership = { ...status, serverTime: '2026-09-09T00:00:00.000Z' };
    const preparedOrder = {
      orderId: 'official-order-1',
      status: 'PREPARED',
      amount: 2800,
      paidAt: null,
    };
    const signData = JSON.stringify({
      env: 0,
      currencyType: 'CNY',
      buyQuantity: 1,
      goodsPrice: 2800,
      outTradeNo: preparedOrder.orderId,
      attach: preparedOrder.orderId,
      offerId: '1450639573',
      productId: 'warehouse_member_6m',
    });
    const callFunction = vi.fn(
      (options: { data: { action: string; expectedPaymentAccountScope?: string } }) => {
        const action = options.data.action;
        actions.push(action);
        const data =
          action === 'getPaymentContext'
            ? { accountScope: 'a'.repeat(64) }
            : action === 'recoverOrders'
              ? { membership: freeMembership }
              : action === 'createOrder'
                ? {
                    order: preparedOrder,
                    canStartPayment: true,
                    bridgeAttempt: 'a'.repeat(43),
                    payment: {
                      mode: 'short_series_goods',
                      signData,
                      paySig: 'a'.repeat(64),
                      signature: 'b'.repeat(64),
                    },
                  }
                : action === 'markPaymentStarting'
                  ? {
                      order: { ...preparedOrder, status: 'PAYMENT_STARTING' },
                      bridgeLease: true,
                      canStartPayment: true,
                    }
                  : action === 'markPaymentUnknown'
                    ? { order: { ...preparedOrder, status: 'PAYMENT_UNKNOWN' } }
                    : {
                        order: {
                          ...preparedOrder,
                          status: 'PAID',
                          paidAt: '2026-09-09T00:01:00.000Z',
                        },
                        membership: paidMembership,
                      };
        return { result: { ok: true, data } };
      },
    );
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => values.get(key) ?? ''),
      setStorageSync: vi.fn((key: string, value: unknown) => values.set(key, value)),
      removeStorageSync: vi.fn((key: string) => values.delete(key)),
      getAccountInfoSync: vi.fn(() => ({ miniProgram: { envVersion: 'develop' } })),
      login: vi.fn().mockResolvedValue({ code: 'one-time-login-code' }),
      cloud: { callFunction },
      canIUse: vi.fn((api: string) => api === 'requestVirtualPayment'),
      getSystemInfoSync: vi.fn(() => ({
        platform: 'ios',
        system: 'iOS 18.0',
        version: '8.0.68',
        SDKVersion: '3.7.0',
      })),
      requestVirtualPayment,
      getLogManager: vi.fn(() => ({ warn: vi.fn() })),
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: { ...structuredClone(definition.data), loading: false } as Record<string, unknown>,
      revision: 0,
      hidden: false,
      unloaded: false,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };

    // A newly opened page begins with payment unavailable until recovery returns.
    // Both taps must share that recovery and open the native bridge only once.
    expect(context.data.paymentAvailable).toBe(false);
    await context.onRefresh();
    const firstTap = context.onPurchase();
    const secondTap = context.onPurchase();
    await Promise.all([firstTap, secondTap]);

    expect(actions.filter((action) => action !== 'getPaymentContext')).toEqual([
      'recoverOrders',
      'createOrder',
      'markPaymentStarting',
      'markPaymentUnknown',
      'getOrder',
    ]);
    expect(actions.filter((action) => action === 'getPaymentContext').length).toBeGreaterThan(0);
    for (const [options] of callFunction.mock.calls) {
      if (options.data.action !== 'getPaymentContext')
        expect(options.data.expectedPaymentAccountScope).toBe('a'.repeat(64));
    }
    expect(requestVirtualPayment).toHaveBeenCalledOnce();
    expect(requestVirtualPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'short_series_goods',
        signData,
        paySig: 'a'.repeat(64),
        signature: 'b'.repeat(64),
      }),
    );
    expect(context.data).toMatchObject({ isMember: true, pendingOrderId: '' });
    expect(values.get('membership.cached-status.v1')).toEqual({
      isMember: true,
      expiresAt: '2099-01-01T00:00:00Z',
    });
    expect(values.get('grain-practice:progress')).toEqual({ answered: 20 });
    expect(values.get('grain-practice:sync-outbox')).toEqual([{ id: 'keep-me' }]);
    expect(values.get('grain-practice:random-usage')).toEqual({ used: 3 });
  });

  it('does not open the bridge or write a stale page after unload during real-service refresh', async () => {
    vi.resetModules();
    vi.doUnmock('../miniprogram/packages/auxiliary/services/membership-service');
    let definition: MemberPage | undefined;
    let resolveRecovery: ((value: { result: { ok: true; data: unknown } }) => void) | undefined;
    const values = new Map<string, unknown>();
    const callFunction = vi.fn(
      () =>
        new Promise<{ result: { ok: true; data: unknown } }>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const requestVirtualPayment = vi.fn();
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => values.get(key) ?? ''),
      setStorageSync: vi.fn((key: string, value: unknown) => values.set(key, value)),
      removeStorageSync: vi.fn((key: string) => values.delete(key)),
      getAccountInfoSync: vi.fn(() => ({ miniProgram: { envVersion: 'develop' } })),
      login: vi.fn(),
      cloud: { callFunction },
      canIUse: vi.fn(() => true),
      getSystemInfoSync: vi.fn(() => ({ platform: 'ios', system: 'iOS 18.0', version: '8.0.68' })),
      requestVirtualPayment,
      getLogManager: vi.fn(() => ({ warn: vi.fn() })),
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
      showToast: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const setData = vi.fn(function (
      this: { data: Record<string, unknown> },
      update: Record<string, unknown>,
    ) {
      Object.assign(this.data, update);
    });
    const context = {
      ...definition,
      data: { ...structuredClone(definition.data), loading: false } as Record<string, unknown>,
      revision: 0,
      hidden: false,
      unloaded: false,
      loadMembershipTask: null as Promise<void> | null,
      loadMembershipTimeout: null as ReturnType<typeof setTimeout> | null,
      loadMembershipCancel: null as (() => void) | null,
      setData,
    };

    const purchase = context.onRefresh();
    await vi.waitFor(() => expect(callFunction).toHaveBeenCalledOnce());
    context.onUnload();
    const writesAtUnload = setData.mock.calls.length;
    resolveRecovery?.({ result: { ok: true, data: { membership: status } } });
    await purchase;
    await Promise.resolve();

    expect(requestVirtualPayment).not.toHaveBeenCalled();
    expect(setData).toHaveBeenCalledTimes(writesAtUnload);
    expect(context.data).toMatchObject({ isMember: false, paymentAvailable: false });
  });

  it('keeps a recovered PREPARED order visible and leaves continue payment enabled', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    const prepared = {
      confirmed: false,
      paymentState: 'pending',
      order: { orderId: 'prepared-order', status: 'PREPARED', amount: 2800, paidAt: null },
      membership: status,
    };
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue(status),
      getPendingOrderId: vi.fn(() => 'prepared-order'),
      getTransactionStage: vi.fn(() => 'PREPARED'),
      getPaymentState: vi.fn(() => 'pending'),
      getLastPurchaseResult: vi.fn(() => prepared),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      data: structuredClone(definition.data),
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
      // eslint-disable-next-line @typescript-eslint/unbound-method
      applyPurchaseResult: definition.applyPurchaseResult,
      revision: 0,
      unloaded: false,
    };
    await definition.loadMembership.call(context);
    expect(context.data.pendingOrderId).toBe('prepared-order');
    expect(context.data.transactionStage).toBe('PREPARED');
    expect(context.data.purchasing).toBe(false);
  });

  it('uses a server-confirmed purchase result before showing an activated membership', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue(status),
      getPendingOrderId: vi.fn(() => null),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      purchase: vi.fn().mockResolvedValue({
        confirmed: true,
        order: { orderId: 'o1', status: 'PAID' },
        membership: { ...status, isMember: true, expiresAt: '2027-03-05T00:00:00Z' },
      }),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      showToast: vi.fn(),
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      data: structuredClone(definition.data),
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
      // eslint-disable-next-line @typescript-eslint/unbound-method
      loadMembership: definition.loadMembership,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      applyPurchaseResult: definition.applyPurchaseResult,
      revision: 0,
      unloaded: false,
      hidden: false,
    };
    await definition.loadMembership.call(context);
    await definition.onPurchase.call(context);
    expect(membership.purchase).toHaveBeenCalledOnce();
    expect(membership.purchase).toHaveBeenCalledWith(expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i));
    expect(context.data.notice).toContain('会员已开通');
    expect(context.data.isMember).toBe(true);
  });

  it('gives visible feedback when refreshing an unavailable payment service without purchasing', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue({ ...status, paymentAvailable: false }),
      getPendingOrderId: vi.fn(() => null),
      getTransactionStage: vi.fn(() => ''),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      purchase: vi.fn(),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    const showToast = vi.fn();
    vi.stubGlobal('wx', {
      showToast,
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: {
        ...structuredClone(definition.data),
        loading: false,
        paymentAvailable: false,
      } as Record<string, unknown>,
      revision: 0,
      unloaded: false,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };

    await context.onRefresh();

    expect(membership.recoverOrders).toHaveBeenCalledOnce();
    expect(membership.recoverOrders).toHaveBeenCalledWith(
      expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
    );
    expect(membership.purchase).not.toHaveBeenCalled();
    expect(context.data['notice']).toBe('会员支付服务暂不可用，请稍后重试。');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not purchase in the same click when refresh restores availability', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    const purchaseResult = {
      confirmed: false,
      paymentState: 'pending',
      order: { orderId: 'prepared-after-refresh', status: 'PREPARED', amount: 2800, paidAt: null },
      membership: status,
    };
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue(status),
      getPendingOrderId: vi.fn(() => null),
      getTransactionStage: vi.fn(() => ''),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      purchase: vi.fn().mockResolvedValue(purchaseResult),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      showToast: vi.fn(),
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: {
        ...structuredClone(definition.data),
        loading: false,
        paymentAvailable: false,
      } as Record<string, unknown>,
      revision: 0,
      unloaded: false,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };

    await context.onRefresh();

    expect(membership.recoverOrders).toHaveBeenCalledOnce();
    expect(membership.purchase).not.toHaveBeenCalled();
  });

  it('does not duplicate a purchase when refresh service is tapped rapidly', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    let resolveRecovery: ((value: typeof status) => void) | undefined;
    const membership = {
      recoverOrders: vi.fn(
        () =>
          new Promise<typeof status>((resolve) => {
            resolveRecovery = resolve;
          }),
      ),
      getPendingOrderId: vi.fn(() => null),
      getTransactionStage: vi.fn(() => ''),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      purchase: vi.fn().mockResolvedValue({
        confirmed: false,
        paymentState: 'pending',
        order: { orderId: 'prepared-once', status: 'PREPARED', amount: 2800, paidAt: null },
        membership: status,
      }),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      showToast: vi.fn(),
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: { ...structuredClone(definition.data), loading: false, paymentAvailable: false },
      revision: 0,
      unloaded: false,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };

    const first = context.onRefresh();
    const second = context.onRefresh();
    await Promise.resolve();
    expect(membership.recoverOrders).toHaveBeenCalledOnce();
    expect(membership.purchase).not.toHaveBeenCalled();
    resolveRecovery?.(status);
    await Promise.all([first, second]);

    expect(membership.purchase).not.toHaveBeenCalled();
  });

  it('shows a pending order and lets the user manually check its server result', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue(status),
      getPendingOrderId: vi.fn(() => null),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      purchase: vi.fn().mockResolvedValue({
        confirmed: false,
        order: { orderId: 'o-pending', status: 'PENDING' },
        membership: status,
      }),
      queryOrder: vi.fn().mockResolvedValue({
        confirmed: true,
        order: { orderId: 'o-pending', status: 'PAID' },
        membership: { ...status, isMember: true, expiresAt: '2027-03-05T00:00:00Z' },
      }),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      showToast: vi.fn(),
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      data: structuredClone(definition.data),
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
      // eslint-disable-next-line @typescript-eslint/unbound-method
      loadMembership: definition.loadMembership,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      applyPurchaseResult: definition.applyPurchaseResult,
      revision: 0,
      unloaded: false,
      hidden: false,
    };
    await definition.loadMembership.call(context);
    await definition.onPurchase.call(context);
    expect(context.data).toMatchObject({
      pendingOrderId: 'o-pending',
      notice: expect.stringContaining('微信平台已确认订单待支付或处理中'),
    });
    const markup = readFileSync(
      resolve(import.meta.dirname, '../miniprogram/packages/auxiliary/pages/member/index.wxml'),
      'utf8',
    );
    expect(markup).toContain('订单号：{{pendingOrderId}}');
    expect(markup).toContain('复制订单号');
    expect(markup).toContain('右上角菜单选择“反馈”');
    await definition.onQueryPending.call(context);
    expect(membership.queryOrder).toHaveBeenCalledWith(
      'o-pending',
      expect.stringMatching(/^p-[a-z0-9-]{4,32}$/i),
    );
  });

  it('does not query a pending order while membership recovery is loading', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    const membership = {
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      queryOrder: vi.fn(),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', { onNetworkStatusChange: vi.fn(), offNetworkStatusChange: vi.fn() });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      data: { ...structuredClone(definition.data), loading: true, pendingOrderId: 'pending-order' },
      revision: 7,
    };

    await definition.onQueryPending.call(context);
    expect(membership.queryOrder).not.toHaveBeenCalled();
    expect(context.revision).toBe(7);
  });

  it('recovers on return from the cashier even when the page was purchasing', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue(status),
      getPendingOrderId: vi.fn(() => null),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
      showToast: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: { ...structuredClone(definition.data), purchasing: true, loading: false },
      revision: 0,
      hidden: false,
      unloaded: false,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };
    context.onLoad();
    context.onHide();
    context.onShow();
    await vi.waitFor(() => expect(membership.recoverOrders).toHaveBeenCalled());
    expect(membership.onPaymentReturn).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(context.data.purchasing).toBe(false));
  });

  it('uses the network listener to recover and removes listeners on unload', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    let networkListener:
      ((result: WechatMiniprogram.OnNetworkStatusChangeListenerResult) => void) | undefined;
    const unsubscribe = vi.fn();
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue(status),
      getPendingOrderId: vi.fn(() => null),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => unsubscribe),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
    };
    const onNetworkStatusChange = vi.fn(
      (listener: (result: WechatMiniprogram.OnNetworkStatusChangeListenerResult) => void) => {
        networkListener = listener;
      },
    );
    const offNetworkStatusChange = vi.fn();
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', { onNetworkStatusChange, offNetworkStatusChange, showToast: vi.fn() });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: structuredClone(definition.data),
      revision: 0,
      hidden: false,
      unloaded: false,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };
    context.onLoad();
    networkListener?.({ isConnected: true, networkType: 'wifi' });
    await vi.waitFor(() => expect(membership.onPaymentReturn).toHaveBeenCalledOnce());
    context.onUnload();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(offNetworkStatusChange).toHaveBeenCalledWith(networkListener);
  });

  it('presents cancellation and unsupported-device outcomes without keeping the button locked', async () => {
    vi.resetModules();
    const { MembershipError: RuntimeMembershipError } =
      await import('../miniprogram/repositories/membership-client');
    let definition: MemberPage | undefined;
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue(status),
      getPendingOrderId: vi.fn(() => 'cancel-order'),
      getPaymentState: vi.fn(() => 'cancelled'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      queryOrder: vi.fn(),
      purchase: vi
        .fn()
        .mockRejectedValue(new RuntimeMembershipError('VIRTUAL_PAYMENT_UNSUPPORTED')),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
      showToast: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: {
        ...structuredClone(definition.data),
        loading: false,
        paymentAvailable: true,
      } as Record<string, unknown>,
      revision: 0,
      hidden: false,
      unloaded: false,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };
    await context.applyPurchaseResult({
      confirmed: false,
      paymentState: 'cancelled',
      order: { orderId: 'cancel-order', status: 'PENDING', amount: 2800, paidAt: null },
      membership: { ...status, isMember: true, expiresAt: '2027-03-05T00:00:00Z' },
    });
    expect(context.data['notice']).toContain('已取消本次支付');
    expect(context.data['notice']).not.toContain('未开通会员');
    expect(context.data['isMember']).toBe(true);
    expect(context.data['pendingOrderId']).toBe('cancel-order');
    await context.applyPurchaseResult({
      confirmed: false,
      paymentState: 'cancelled',
      order: { orderId: 'cancel-order', status: 'CLOSED', amount: 2800, paidAt: null },
      membership: status,
    });
    expect(context.data['pendingOrderId']).toBe('');
    await context.onPurchase();
    expect(membership.purchase).toHaveBeenCalledOnce();
    expect(context.data['purchasing']).toBe(false);
    expect(context.data['notice']).toContain('iOS');
  });

  it('copies the current pending order id without starting another payment', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    const membership = {
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      purchase: vi.fn(),
    };
    const setClipboardData = vi.fn();
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
      setClipboardData,
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      data: { ...structuredClone(definition.data), pendingOrderId: 'M-pending-order' },
    };
    definition.onCopyPendingOrder.call(context);
    expect(setClipboardData).toHaveBeenCalledWith({ data: 'M-pending-order' });
    expect(membership.purchase).not.toHaveBeenCalled();
    setClipboardData.mockRejectedValueOnce(new Error('clipboard unavailable'));
    definition.onCopyPendingOrder.call(context);
    await Promise.resolve();
  });

  it('keeps purchase single-flight and ignores a late old purchase after recovery reports PAID', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    let resolvePurchase: ((result: unknown) => void) | undefined;
    const paidResult = {
      confirmed: true,
      paymentState: 'succeeded',
      order: { orderId: 'new-order', status: 'PAID', amount: 2800, paidAt: 'now' },
      membership: { ...status, isMember: true, expiresAt: '2027-03-05T00:00:00Z' },
    };
    const membership = {
      recoverOrders: vi.fn().mockResolvedValue(paidResult.membership),
      getPendingOrderId: vi.fn(() => null),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => paidResult),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
      purchase: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            resolvePurchase = resolve;
          }),
      ),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
      showToast: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: {
        ...structuredClone(definition.data),
        loading: false,
        paymentAvailable: true,
      } as Record<string, unknown>,
      revision: 0,
      hidden: false,
      unloaded: false,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };
    const first = context.onPurchase();
    const second = context.onPurchase();
    expect(membership.purchase).toHaveBeenCalledOnce();
    await second;
    await context.loadMembership();
    resolvePurchase?.({
      confirmed: false,
      paymentState: 'pending',
      order: { orderId: 'old-order', status: 'PENDING', amount: 2800, paidAt: null },
      membership: status,
    });
    await first;
    expect(context.data['notice']).toBe('会员服务已刷新。');
    expect(context.data['pendingOrderId']).toBe('');
  });

  it('coalesces concurrent membership loads and clears the completed task resources', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    let resolveRecovery: ((value: typeof status) => void) | undefined;
    const membership = {
      recoverOrders: vi.fn(
        () =>
          new Promise<typeof status>((resolve) => {
            resolveRecovery = resolve;
          }),
      ),
      getPendingOrderId: vi.fn(() => null),
      getTransactionStage: vi.fn(() => ''),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', { onNetworkStatusChange: vi.fn(), offNetworkStatusChange: vi.fn() });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: structuredClone(definition.data),
      revision: 0,
      hidden: false,
      unloaded: false,
      loadMembershipTask: null as Promise<void> | null,
      loadMembershipTimeout: null as ReturnType<typeof setTimeout> | null,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };

    const first = context.loadMembership();
    const second = context.loadMembership();
    expect(second).toBe(first);
    expect(context.data).toMatchObject({ loading: true, paymentAvailable: false });
    await Promise.resolve();
    expect(membership.recoverOrders).toHaveBeenCalledOnce();
    resolveRecovery?.(status);
    await Promise.all([first, second]);
    expect(context.data.loading).toBe(false);
    expect(context.loadMembershipTask).toBeNull();
    expect(context.loadMembershipTimeout).toBeNull();
  });

  it.each(['timeout', 'hide'])(
    'releases an unsettled recovery after %s and ignores its late result after a new recovery',
    async (reason) => {
      vi.useFakeTimers();
      vi.resetModules();
      let definition: MemberPage | undefined;
      let resolveFirst!: (value: typeof status) => void;
      const membership = {
        recoverOrders: vi
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise<typeof status>((resolve) => {
                resolveFirst = resolve;
              }),
          )
          .mockResolvedValue(status),
        getPendingOrderId: vi.fn(() => null),
        getTransactionStage: vi.fn(() => ''),
        getPaymentState: vi.fn(() => 'idle'),
        getLastPurchaseResult: vi.fn(() => null),
        subscribePayment: vi.fn(() => vi.fn()),
        invalidateSession: vi.fn(),
        onPaymentReturn: vi.fn(),
      };
      vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
        memberPaymentService: membership,
      }));
      vi.stubGlobal('wx', { onNetworkStatusChange: vi.fn(), offNetworkStatusChange: vi.fn() });
      vi.stubGlobal('Page', (page: MemberPage) => {
        definition = page;
      });
      await import('../miniprogram/packages/auxiliary/pages/member/index');
      if (!definition) throw new Error('member page not registered');
      const context = {
        ...definition,
        data: structuredClone(definition.data),
        revision: 0,
        hidden: false,
        unloaded: false,
        loadMembershipTask: null as Promise<void> | null,
        loadMembershipTimeout: null as ReturnType<typeof setTimeout> | null,
        setData(update: Record<string, unknown>) {
          Object.assign(this.data, update);
        },
      };

      const request = context.loadMembership();
      await Promise.resolve();
      if (reason === 'hide') context.onHide();
      else await vi.advanceTimersByTimeAsync(15_000);
      await request;
      if (reason === 'timeout')
        expect(context.data).toMatchObject({
          loading: false,
          paymentAvailable: false,
          paymentState: 'unknown',
          notice: '订单状态未知，网络恢复后重试。',
        });
      expect(context.loadMembershipTask).toBeNull();
      expect(context.loadMembershipTimeout).toBeNull();
      if (reason === 'hide') {
        expect(membership.invalidateSession).toHaveBeenCalledOnce();
        context.onShow();
        await context.loadMembershipTask;
      } else await context.loadMembership();
      expect(membership.recoverOrders).toHaveBeenCalledTimes(2);
      expect(context.data).toMatchObject({
        loading: false,
        paymentAvailable: true,
        paymentState: 'idle',
        notice: '会员服务已刷新。',
      });
      resolveFirst({ ...status, paymentAvailable: false });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(context.data.paymentAvailable).toBe(true);
      expect(context.data.notice).toBe('会员服务已刷新。');
    },
  );

  it('clears the recovery timeout on unload without applying a late result', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    let definition: MemberPage | undefined;
    const membership = {
      recoverOrders: vi.fn(() => new Promise<typeof status>(() => undefined)),
      getPendingOrderId: vi.fn(() => null),
      getTransactionStage: vi.fn(() => ''),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      onNetworkStatusChange: vi.fn(),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const setData = vi.fn(function (
      this: { data: Record<string, unknown> },
      update: Record<string, unknown>,
    ) {
      Object.assign(this.data, update);
    });
    const context = {
      ...definition,
      data: structuredClone(definition.data),
      revision: 0,
      hidden: false,
      unloaded: false,
      loadMembershipTask: null as Promise<void> | null,
      loadMembershipTimeout: null as ReturnType<typeof setTimeout> | null,
      loadMembershipCancel: null as (() => void) | null,
      setData,
    };
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const task = context.loadMembership();
    const updatesBeforeUnload = setData.mock.calls.length;
    context.onUnload();
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(context.loadMembershipTask).toBeNull();
    expect(context.loadMembershipTimeout).toBeNull();
    expect(context.loadMembershipCancel).toBeNull();
    await task;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(setData).toHaveBeenCalledTimes(updatesBeforeUnload);
  });

  it('reuses the active load when onShow and network recovery arrive together', async () => {
    vi.resetModules();
    let definition: MemberPage | undefined;
    let networkListener:
      ((result: WechatMiniprogram.OnNetworkStatusChangeListenerResult) => void) | undefined;
    let resolveRecovery: ((value: typeof status) => void) | undefined;
    const membership = {
      recoverOrders: vi.fn(
        () =>
          new Promise<typeof status>((resolve) => {
            resolveRecovery = resolve;
          }),
      ),
      getPendingOrderId: vi.fn(() => null),
      getTransactionStage: vi.fn(() => ''),
      getPaymentState: vi.fn(() => 'idle'),
      getLastPurchaseResult: vi.fn(() => null),
      subscribePayment: vi.fn(() => vi.fn()),
      invalidateSession: vi.fn(),
      onPaymentReturn: vi.fn(),
    };
    vi.doMock('../miniprogram/packages/auxiliary/services/membership-service', () => ({
      memberPaymentService: membership,
    }));
    vi.stubGlobal('wx', {
      onNetworkStatusChange: vi.fn((listener) => {
        networkListener = listener;
      }),
      offNetworkStatusChange: vi.fn(),
    });
    vi.stubGlobal('Page', (page: MemberPage) => {
      definition = page;
    });
    await import('../miniprogram/packages/auxiliary/pages/member/index');
    if (!definition) throw new Error('member page not registered');
    const context = {
      ...definition,
      data: structuredClone(definition.data),
      revision: 0,
      hidden: false,
      unloaded: false,
      loadMembershipTask: null as Promise<void> | null,
      loadMembershipTimeout: null as ReturnType<typeof setTimeout> | null,
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };

    context.onLoad();
    context.onShow();
    networkListener?.({ isConnected: true, networkType: 'wifi' });
    await Promise.resolve();
    expect(membership.recoverOrders).toHaveBeenCalledOnce();
    const request = context.loadMembershipTask;
    resolveRecovery?.(status);
    await request;
    expect(context.data.loading).toBe(false);
    expect(context.loadMembershipTask).toBeNull();
  });
});

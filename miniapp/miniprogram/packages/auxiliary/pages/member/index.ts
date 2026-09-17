import { MembershipError } from '../../../../repositories/membership-client';
import {
  formatMembershipExpiry,
  presentMembership,
} from '../../../../presenters/membership-presenter';
import { memberPaymentService as membership } from '../../services/membership-service';
import type { MembershipPurchaseResult } from '../../../../types/membership';
import type { MembershipTransactionStage } from '../../../../types/membership';
import { createPaymentTraceId, logPaymentDiagnostic } from '../../services/payment-diagnostics';

const UNKNOWN_NOTICE = '支付结果暂未确认';
const PENDING_NOTICE = '可点击“重新支付”，系统会先核对上一笔订单。';
const CANCELLED_NOTICE = '已取消本次支付，可以重新开通。原订单将继续核对到账情况';
const noticeForStage = (stage: MembershipTransactionStage | ''): string => {
  if (stage === 'PREPARED') return '订单已准备好，点击“继续支付”即可打开微信收银台。';
  if (stage === 'PAYMENT_STARTING' || stage === 'PAYMENT_UNKNOWN')
    return `${UNKNOWN_NOTICE}。${PENDING_NOTICE}`;
  if (stage === 'PENDING') return '上次支付尚未完成，可以点击“重新支付”继续开通。';
  if (stage === 'PAID') return '平台已确认支付，正在确认会员权益，请稍候检查结果。';
  return `${UNKNOWN_NOTICE}。${PENDING_NOTICE}`;
};

Page({
  data: {
    loading: true,
    purchasing: false,
    paymentState: 'idle',
    isMember: false,
    statusText: '正在确认会员状态',
    detailText: '请稍候',
    paymentAvailable: false,
    notice: '',
    pendingOrderId: '',
    transactionStage: '',
  },
  revision: 0,
  sessionEpoch: 0,
  hidden: false,
  unloaded: false,
  unsubscribePayment: null as (() => void) | null,
  loadMembershipTask: null as Promise<void> | null,
  loadMembershipTimeout: null as ReturnType<typeof setTimeout> | null,
  loadMembershipCancel: null as (() => void) | null,
  networkListener: null as
    | ((
        result:
          | WechatMiniprogram.OnNetworkStatusChangeListenerResult
          | WechatMiniprogram.GeneralCallbackResult,
      ) => void)
    | null,

  onLoad() {
    this.unsubscribePayment = membership.subscribePayment((paymentState) => {
      if (this.unloaded || this.hidden) return;
      this.setData({
        paymentState,
        purchasing: paymentState === 'opening' || paymentState === 'confirming',
        pendingOrderId: membership.getPendingOrderId() ?? '',
        transactionStage: membership.getTransactionStage?.() ?? '',
        ...(paymentState === 'unknown' ? { notice: `${UNKNOWN_NOTICE}。${PENDING_NOTICE}` } : {}),
      });
    });
    this.networkListener = (result) => {
      if ('isConnected' in result && result.isConnected && !this.hidden && !this.unloaded) {
        membership.onPaymentReturn();
        void this.loadMembership();
      }
    };
    wx.onNetworkStatusChange(this.networkListener);
  },

  onHide() {
    this.hidden = true;
    this.sessionEpoch += 1;
    this.revision += 1;
    membership.invalidateSession();
    this.loadMembershipCancel?.();
    if (this.loadMembershipTimeout) clearTimeout(this.loadMembershipTimeout);
    this.loadMembershipTimeout = null;
    this.loadMembershipTask = null;
    this.loadMembershipCancel = null;
  },

  onShow() {
    if (this.hidden) membership.onPaymentReturn();
    this.hidden = false;
    void this.loadMembership();
  },

  onUnload() {
    this.unloaded = true;
    this.revision += 1;
    membership.invalidateSession();
    this.loadMembershipCancel?.();
    if (this.loadMembershipTimeout) clearTimeout(this.loadMembershipTimeout);
    this.loadMembershipTimeout = null;
    this.loadMembershipTask = null;
    this.loadMembershipCancel = null;
    this.unsubscribePayment?.();
    if (this.networkListener) wx.offNetworkStatusChange(this.networkListener);
    membership.onPaymentReturn();
  },

  loadMembership(traceId = createPaymentTraceId()): Promise<void> {
    if (this.loadMembershipTask) {
      logPaymentDiagnostic('refresh_guard', undefined, { traceId, reason: 'IN_FLIGHT' });
      return this.loadMembershipTask;
    }
    const started = Date.now();
    logPaymentDiagnostic('refresh_start', undefined, { traceId });
    const revision = ++this.revision;
    const sessionEpoch = this.sessionEpoch;
    if (!this.unloaded) this.setData({ loading: true, paymentAvailable: false });
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const recovery = Promise.resolve().then(() => membership.recoverOrders(traceId));
    const timedRecovery = new Promise<never>((_, reject) => {
      // The client owns the request deadline. This is only a page escape hatch
      // for a promise that never settles, so it must not race normal cold starts.
      timeout = setTimeout(() => reject(new Error('MEMBERSHIP_RECOVERY_TIMEOUT')), 15_000);
      this.loadMembershipTimeout = timeout;
    });
    let cancel: (() => void) | null = null;
    const cancelledRecovery = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error('MEMBERSHIP_RECOVERY_CANCELLED'));
      this.loadMembershipCancel = cancel;
    });
    const task = (async () => {
      try {
        const status = await Promise.race([recovery, timedRecovery, cancelledRecovery]);
        if (
          revision !== this.revision ||
          sessionEpoch !== this.sessionEpoch ||
          this.hidden ||
          this.unloaded
        ) {
          logPaymentDiagnostic('refresh_discarded', undefined, { traceId, reason: 'STALE_VIEW' });
          return;
        }
        const view = presentMembership(status);
        const pendingOrderId = membership.getPendingOrderId() ?? '';
        const transactionStage = membership.getTransactionStage?.() ?? '';
        const paymentState = membership.getPaymentState();
        this.setData({
          loading: false,
          isMember: view.isMember,
          statusText: view.statusText,
          detailText: view.detailText,
          paymentAvailable: view.canPurchase,
          pendingOrderId,
          transactionStage,
          paymentState,
          purchasing: paymentState === 'opening',
          notice: pendingOrderId
            ? noticeForStage(transactionStage)
            : paymentState === 'cancelled'
              ? `${CANCELLED_NOTICE}。`
              : view.canPurchase
                ? '会员服务已刷新。'
                : status.paymentUnavailableReason === 'DISABLED'
                  ? '会员支付当前未启用，请稍后重试。'
                  : status.paymentUnavailableReason === 'MISSING_CONFIGURATION'
                    ? '会员支付配置尚未完成，请稍后重试。'
                    : status.paymentUnavailableReason === 'APP_ID_MISMATCH'
                      ? '会员服务与当前小程序不匹配，请联系维护人员。'
                      : '会员支付服务暂不可用，请稍后重试。',
        });
        logPaymentDiagnostic('refresh_success', undefined, {
          traceId,
          elapsedMs: Date.now() - started,
          reason: status.paymentAvailable
            ? 'AVAILABLE'
            : (status.paymentUnavailableReason ?? 'UNAVAILABLE'),
        });
      } catch (error) {
        logPaymentDiagnostic('refresh_failed', undefined, {
          traceId,
          elapsedMs: Date.now() - started,
          reason:
            error instanceof Error && error.message.includes('TIMEOUT')
              ? 'TIMEOUT'
              : 'REQUEST_FAILED',
        });
        if (
          revision !== this.revision ||
          sessionEpoch !== this.sessionEpoch ||
          this.hidden ||
          this.unloaded
        )
          return;
        const pendingOrderId = membership.getPendingOrderId() ?? '';
        this.setData({
          loading: false,
          purchasing: false,
          isMember: false,
          statusText: '会员状态暂未确认',
          detailText: '网络恢复后可重试确认',
          paymentAvailable: false,
          paymentState: 'unknown',
          notice: '订单状态未知，网络恢复后重试。',
          pendingOrderId,
          transactionStage: membership.getTransactionStage?.() ?? '',
        });
      } finally {
        if (timeout) clearTimeout(timeout);
        if (this.loadMembershipTimeout === timeout) this.loadMembershipTimeout = null;
        if (this.loadMembershipCancel === cancel) this.loadMembershipCancel = null;
        if (revision === this.revision) this.loadMembershipTask = null;
        if (
          revision === this.revision &&
          sessionEpoch === this.sessionEpoch &&
          !this.hidden &&
          !this.unloaded
        )
          this.setData({ loading: false });
      }
    })();
    this.loadMembershipTask = task;
    return task;
  },

  async onPurchase() {
    const traceId = createPaymentTraceId();
    logPaymentDiagnostic('page_tap', undefined, { traceId, reason: 'PURCHASE' });
    if (this.data.purchasing || this.data.loading) {
      logPaymentDiagnostic('page_guard', undefined, {
        traceId,
        reason: this.data.loading ? 'LOADING' : 'PURCHASING',
      });
      return;
    }
    const stage = membership.getTransactionStage?.();
    if (stage === 'PAID') {
      logPaymentDiagnostic('page_guard', undefined, { traceId, reason: stage });
      return;
    }
    if (!this.data.paymentAvailable) {
      logPaymentDiagnostic('page_guard', undefined, { traceId, reason: 'UNAVAILABLE' });
      this.setData({ notice: '会员支付服务暂不可用，请点击“刷新会员服务”后重试。' });
      return;
    }
    const revision = ++this.revision;
    const sessionEpoch = this.sessionEpoch;
    this.setData({
      purchasing: true,
      paymentState: 'opening',
      notice: this.data.pendingOrderId ? '正在恢复上一笔订单的支付…' : '正在打开支付收银台…',
    });
    try {
      const result = await membership.purchase(traceId);
      if (
        revision === this.revision &&
        sessionEpoch === this.sessionEpoch &&
        !this.hidden &&
        !this.unloaded
      )
        this.applyPurchaseResult(result);
    } catch (error) {
      if (
        revision !== this.revision ||
        sessionEpoch !== this.sessionEpoch ||
        this.hidden ||
        this.unloaded
      )
        return;
      const unsupported =
        error instanceof MembershipError && error.code === 'VIRTUAL_PAYMENT_UNSUPPORTED';
      const cancelled = membership.getPaymentState() === 'cancelled';
      this.setData({
        paymentState: unsupported ? 'failed' : cancelled ? 'cancelled' : 'unknown',
        notice: unsupported
          ? error.message
          : `${cancelled ? `${CANCELLED_NOTICE}。` : ''}${UNKNOWN_NOTICE}。${PENDING_NOTICE}`,
        pendingOrderId: membership.getPendingOrderId() ?? '',
        transactionStage: membership.getTransactionStage?.() ?? '',
      });
    } finally {
      if (
        revision === this.revision &&
        sessionEpoch === this.sessionEpoch &&
        !this.hidden &&
        !this.unloaded
      )
        this.setData({ purchasing: false });
    }
  },

  async onRefresh() {
    const traceId = createPaymentTraceId();
    logPaymentDiagnostic('page_tap', undefined, { traceId, reason: 'REFRESH' });
    if (this.data.loading || this.data.purchasing) {
      logPaymentDiagnostic('page_guard', undefined, {
        traceId,
        reason: this.data.loading ? 'LOADING' : 'PURCHASING',
      });
      return;
    }
    this.setData({ notice: '正在查询会员服务…' });
    await this.loadMembership(traceId);
  },

  async onQueryPending() {
    const traceId = createPaymentTraceId();
    logPaymentDiagnostic('page_tap', undefined, { traceId, reason: 'QUERY' });
    const orderId = this.data.pendingOrderId;
    if (!orderId || this.data.purchasing || this.data.loading) return;
    const revision = ++this.revision;
    const sessionEpoch = this.sessionEpoch;
    this.setData({ purchasing: true, paymentState: 'confirming', notice: '正在检查支付到账状态…' });
    try {
      const result = await membership.queryOrder(orderId, traceId);
      if (
        revision === this.revision &&
        sessionEpoch === this.sessionEpoch &&
        !this.hidden &&
        !this.unloaded
      )
        this.applyPurchaseResult(result);
    } catch {
      if (
        revision === this.revision &&
        sessionEpoch === this.sessionEpoch &&
        !this.hidden &&
        !this.unloaded
      )
        this.setData({
          paymentState: 'unknown',
          notice: `${UNKNOWN_NOTICE}。${PENDING_NOTICE}`,
        });
    } finally {
      if (
        revision === this.revision &&
        sessionEpoch === this.sessionEpoch &&
        !this.hidden &&
        !this.unloaded
      )
        this.setData({ purchasing: false });
    }
  },

  onCopyPendingOrder() {
    const orderId = this.data.pendingOrderId;
    if (orderId)
      void Promise.resolve(wx.setClipboardData({ data: orderId })).catch(() => undefined);
  },

  applyPurchaseResult(result: MembershipPurchaseResult) {
    const view = presentMembership(result.membership);
    this.setData({
      isMember: view.isMember,
      statusText: view.statusText,
      detailText: view.detailText,
      paymentAvailable: view.canPurchase,
    });
    if (result.confirmed) {
      const expires = formatMembershipExpiry(result.membership.expiresAt);
      this.setData({
        paymentState: 'succeeded',
        notice: expires ? `会员已开通，有效期至${expires}` : '会员已开通',
        pendingOrderId: '',
        transactionStage: '',
      });
      return;
    }
    if (result.order.purchaseCancelled && result.order.status !== 'PAID') {
      this.setData({
        paymentState: 'cancelled',
        notice: `${CANCELLED_NOTICE}。`,
        pendingOrderId: '',
        transactionStage: '',
      });
      return;
    }
    if (
      ['PREPARED', 'PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING', 'PAID'].includes(
        result.order.status,
      )
    ) {
      const cancelled = result.paymentState === 'cancelled';
      this.setData({
        paymentState: result.paymentState ?? 'pending',
        notice: cancelled
          ? `${CANCELLED_NOTICE}。${noticeForStage('PAYMENT_UNKNOWN')}`
          : result.paymentState === 'failed'
            ? new MembershipError('VIRTUAL_PAYMENT_UNSUPPORTED').message
            : noticeForStage(result.order.status),
        pendingOrderId: result.order.orderId,
        transactionStage: membership.getTransactionStage?.() ?? result.order.status,
      });
      return;
    }
    this.setData({
      paymentState: result.paymentState === 'cancelled' ? 'cancelled' : 'failed',
      notice:
        result.order.status === 'REFUNDED'
          ? '该订单已退款，对应会员权益已退回。'
          : result.paymentState === 'cancelled'
            ? `${CANCELLED_NOTICE}。`
            : '服务端已确认订单关闭或失败，可以重新开通。',
      pendingOrderId: '',
      transactionStage: '',
    });
  },
});

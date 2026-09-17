import { MembershipService as BaseMembershipService } from '../../../services/membership-service';
import { MembershipClient, MembershipError } from '../../../repositories/membership-client';
import { normalizeVirtualPaymentError, WechatVirtualPayment } from './wechat-virtual-payment';
import { createPaymentTraceId, logPaymentDiagnostic } from './payment-diagnostics';
import type { StorageAdapter } from '../../../types/domain';
import type {
  MembershipOrderResult,
  MembershipPayment,
  MembershipPaymentState,
  MembershipPurchaseResult,
  MembershipStatus,
  MembershipTransactionStage,
} from '../../../types/membership';

const KEY = 'membership.payment-transaction.v2';
type Tx = {
  version: 2;
  accountScope: string;
  sessionScope: string;
  requestId: string;
  orderId: string;
  stage: MembershipTransactionStage;
  cancelRequested?: boolean;
};
type Scope = {
  accountScope: string;
  sessionScope: string;
  key: string;
  epoch: number;
  traceId?: string;
};
type Pay = (payment: MembershipPayment, traceId?: string) => Promise<void>;
const storage: StorageAdapter = {
  get: <T>(k: string) => {
    const v: unknown = wx.getStorageSync(k);
    return v == null || v === '' ? null : (v as T);
  },
  set: <T>(k: string, v: T) => wx.setStorageSync(k, v),
  remove: (k: string) => wx.removeStorageSync(k),
};
const requestPayment: Pay = (payment, traceId) =>
  new WechatVirtualPayment().request(payment, traceId);
const requestId = () => `member-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

/** Local records aid recovery only; server responses authorize membership and payment. */
export class MembershipService extends BaseMembershipService {
  private purchases = new Map<string, Promise<MembershipPurchaseResult>>();
  private recoveries = new Map<string, Promise<MembershipStatus>>();
  private queries = new Map<string, Promise<MembershipPurchaseResult>>();
  private states = new Map<string, MembershipPaymentState>();
  private results = new Map<string, MembershipPurchaseResult>();
  private listeners = new Set<(state: MembershipPaymentState) => void>();
  private activeScope: Scope | null = null;
  private epoch = 0;
  private scopeRequest = 0;
  private acceptedScopeRequest = 0;
  constructor(
    private readonly gateway = new MembershipClient(),
    private readonly db: StorageAdapter = storage,
    private readonly pay: Pay = requestPayment,
    private readonly preflight = pay === requestPayment
      ? () => new WechatVirtualPayment().preflight()
      : () => undefined,
    _waitMs = 15_000,
    private readonly scopeProvider?: () => { accountScope: string; sessionScope: string },
  ) {
    void _waitMs;
    super(gateway);
  }
  private async scope(traceId?: string): Promise<Scope> {
    const epoch = this.epoch;
    const request = ++this.scopeRequest;
    const value = this.scopeProvider
      ? this.scopeProvider()
      : {
          accountScope: await this.gateway.getPaymentAccountScope(traceId),
          sessionScope: 'default',
        };
    const scope = {
      ...value,
      epoch,
      ...(traceId ? { traceId } : {}),
      key: `${value.accountScope}\0${value.sessionScope}\0${epoch}`,
    };
    if (
      epoch !== this.epoch ||
      (request < this.acceptedScopeRequest && this.activeScope?.key !== scope.key)
    )
      throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
    this.acceptedScopeRequest = Math.max(request, this.acceptedScopeRequest);
    this.activeScope = scope;
    return scope;
  }
  private async assert(s: Scope) {
    if (s.epoch !== this.epoch) throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
    if ((await this.scope(s.traceId)).key !== s.key)
      throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
    this.assertCurrent(s);
  }
  private assertCurrent(s: Scope) {
    if (s.epoch !== this.epoch || this.activeScope?.key !== s.key)
      throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
  }
  private key(s: Pick<Scope, 'accountScope' | 'sessionScope'>) {
    return `${KEY}.${encodeURIComponent(s.accountScope)}.${encodeURIComponent(s.sessionScope)}`;
  }
  private tx(s: Scope): Tx | null {
    const v = this.db.get<unknown>(this.key(s));
    return typeof v === 'object' &&
      v !== null &&
      (v as Tx).version === 2 &&
      typeof (v as Tx).orderId === 'string'
      ? (v as Tx)
      : null;
  }
  private matchesTx(current: Tx | null, expected: Tx | null) {
    if (!expected) return current === null;
    return (
      current?.orderId === expected.orderId &&
      current.requestId === expected.requestId &&
      Boolean(current.cancelRequested) === Boolean(expected.cancelRequested) &&
      current.stage === expected.stage
    );
  }
  private save(v: Tx, s: Scope) {
    this.assertCurrent(s);
    this.db.set(this.key(v), v);
  }
  private emit(state: MembershipPaymentState, orderId: string | undefined, s: Scope) {
    this.assertCurrent(s);
    this.states.set(s.key, state);
    logPaymentDiagnostic(state, orderId);
    this.listeners.forEach((fn) => fn(state));
  }
  private state(stage: MembershipTransactionStage): MembershipPaymentState {
    return stage === 'PAID'
      ? 'succeeded'
      : stage === 'PREPARED' || stage === 'PENDING'
        ? 'pending'
        : stage === 'PAYMENT_STARTING'
          ? 'confirming'
          : stage === 'PAYMENT_UNKNOWN'
            ? 'unknown'
            : 'failed';
  }
  getPaymentState() {
    return this.states.get(this.activeScope?.key ?? '') ?? 'idle';
  }
  getLastPurchaseResult() {
    return this.results.get(this.activeScope?.key ?? '') ?? null;
  }
  getPendingOrderId() {
    return this.activeScope ? (this.tx(this.activeScope)?.orderId ?? null) : null;
  }
  getTransactionStage() {
    return this.activeScope ? (this.tx(this.activeScope)?.stage ?? null) : null;
  }
  invalidateSession() {
    this.epoch += 1;
    this.activeScope = null;
    this.states.clear();
    this.results.clear();
    // Durable transactions remain untouched; a new page recovers with fresh identity.
  }
  subscribePayment(fn: (state: MembershipPaymentState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onPaymentReturn() {
    logPaymentDiagnostic('return', this.getPendingOrderId() ?? undefined);
  }
  private hasOrder(v: unknown): v is MembershipOrderResult {
    return typeof v === 'object' && v !== null && 'order' in v;
  }
  async recoverOrders(traceId?: string): Promise<MembershipStatus> {
    const s = await this.scope(traceId),
      active = this.recoveries.get(s.key);
    if (active) return active;
    const task = (async () => {
      const recoveredTx = this.tx(s);
      if (recoveredTx?.cancelRequested)
        return (await this.cancelFor(recoveredTx.orderId, s, traceId)).membership;
      const r = await this.gateway.call(
        {
          action: 'recoverOrders',
          ...(recoveredTx ? { localOrderId: recoveredTx.orderId } : {}),
        },
        traceId,
        s.accountScope,
      );
      await this.assert(s);
      const releasedTestOrderId =
        typeof r === 'object' && r !== null && 'releasedTestOrderId' in r
          ? r.releasedTestOrderId
          : undefined;
      const cancelledOrderId =
        typeof r === 'object' && r !== null && 'cancelledOrderId' in r
          ? r.cancelledOrderId
          : undefined;
      const ownsRecoveredTx = this.matchesTx(this.tx(s), recoveredTx);
      if (
        recoveredTx &&
        (releasedTestOrderId === recoveredTx.orderId || cancelledOrderId === recoveredTx.orderId) &&
        ownsRecoveredTx
      ) {
        this.db.remove(this.key(s));
        this.results.delete(s.key);
        this.states.delete(s.key);
      }
      if (typeof r === 'object' && r !== null && 'pendingOrder' in r && ownsRecoveredTx) {
        const old = this.tx(s);
        this.save(
          {
            version: 2,
            accountScope: s.accountScope,
            sessionScope: s.sessionScope,
            orderId: r.pendingOrder.orderId,
            requestId:
              old?.orderId === r.pendingOrder.orderId
                ? old.requestId
                : `recovered-${r.pendingOrder.orderId}`,
            stage: r.pendingOrder.status,
          },
          s,
        );
        this.emit(this.state(r.pendingOrder.status), r.pendingOrder.orderId, s);
        return r.membership;
      }
      const membership = (
        typeof r === 'object' && r !== null && 'membership' in r ? r.membership : r
      ) as MembershipStatus;
      const old = this.tx(s);
      if (old) return (await this.queryFor(old.orderId, s, traceId)).membership;
      this.emit(cancelledOrderId ? 'cancelled' : 'idle', undefined, s);
      return membership;
    })().finally(() => this.recoveries.delete(s.key));
    this.recoveries.set(s.key, task);
    return task;
  }
  async purchase(traceId = createPaymentTraceId()): Promise<MembershipPurchaseResult> {
    const s = await this.scope(traceId),
      active = this.purchases.get(s.key);
    if (active) return active;
    const task = this.purchaseInner(s, traceId).finally(() => this.purchases.delete(s.key));
    this.purchases.set(s.key, task);
    return task;
  }
  private async purchaseInner(s: Scope, traceId: string): Promise<MembershipPurchaseResult> {
    const started = Date.now();
    let old = this.tx(s);
    logPaymentDiagnostic('purchase_start', undefined, { traceId, reason: old ? old.stage : 'NEW' });
    if (old && (old.cancelRequested || old.stage !== 'PREPARED')) {
      logPaymentDiagnostic('guard', undefined, {
        traceId,
        reason: old.stage,
        elapsedMs: Date.now() - started,
      });
      const previous = old.cancelRequested
        ? await this.cancelFor(old.orderId, s, traceId)
        : await this.queryFor(old.orderId, s, traceId);
      if (previous.confirmed || previous.order.status === 'PAID') return previous;
      if (this.tx(s)) {
        // This explicit tap ends the previous unpaid attempt. Refresh/recovery
        // never creates an order, and a failed query never authorizes a retry.
        const cancelled = await this.cancelFor(old.orderId, s, traceId);
        if (cancelled.confirmed || this.tx(s)) return cancelled;
      }
      old = null;
    }
    this.preflight();
    this.emit('opening', old?.orderId, s);
    logPaymentDiagnostic('cloud_request', undefined, {
      traceId,
      reason: old ? 'RESUME' : 'CREATE',
    });
    const attemptRequestId = old?.requestId ?? requestId();
    const r = old
      ? await this.gateway.call(
          { action: 'resumePayment', orderId: old.orderId },
          traceId,
          s.accountScope,
        )
      : await this.gateway.call(
          { action: 'createOrder', requestId: attemptRequestId },
          traceId,
          s.accountScope,
        );
    await this.assert(s);
    if (!this.hasOrder(r) || (old && r.order.orderId !== old.orderId))
      throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
    const tx: Tx = {
      version: 2,
      accountScope: s.accountScope,
      sessionScope: s.sessionScope,
      orderId: r.order.orderId,
      requestId: attemptRequestId,
      stage: r.order.status,
    };
    this.save(tx, s);
    if (
      r.order.status !== 'PREPARED' ||
      r.order.purchaseCancelled === true ||
      r.canStartPayment !== true ||
      !r.payment ||
      !r.bridgeAttempt
    ) {
      logPaymentDiagnostic('payment_guard', undefined, {
        traceId,
        reason: 'NOT_AUTHORIZED',
        elapsedMs: Date.now() - started,
      });
      return this.queryFor(tx.orderId, s, traceId);
    }
    const start = await this.gateway.call(
      {
        action: 'markPaymentStarting',
        orderId: tx.orderId,
        bridgeAttempt: r.bridgeAttempt,
        payment: r.payment,
      },
      traceId,
      s.accountScope,
    );
    await this.assert(s);
    if (
      !this.hasOrder(start) ||
      start.order.orderId !== tx.orderId ||
      start.bridgeLease !== true ||
      start.canStartPayment !== true
    )
      return this.queryFor(tx.orderId, s, traceId);
    this.save({ ...tx, stage: 'PAYMENT_STARTING' }, s);
    this.emit('confirming', tx.orderId, s);
    logPaymentDiagnostic('bridge_invoke', undefined, { traceId, elapsedMs: Date.now() - started });
    let failure: unknown;
    try {
      await this.pay(r.payment, traceId);
    } catch (e) {
      failure = e;
    }
    const cancelled = failure && normalizeVirtualPaymentError(failure).outcome === 'cancelled';
    if (cancelled) {
      // Native payment can hide/unload the page before its cancel callback.
      // Keep that intent with the captured account/order so a relaunch can
      // finish reporting it, without overwriting a newer purchase.
      const current = this.tx(s);
      if (
        current?.orderId === tx.orderId &&
        current.requestId === tx.requestId &&
        !['PAID', 'CLOSED', 'FAILED', 'REFUNDED'].includes(current.stage)
      )
        this.db.set(this.key(s), {
          ...current,
          stage: 'PAYMENT_UNKNOWN',
          cancelRequested: true,
        });
      let response;
      try {
        response = await this.gateway.call(
          { action: 'cancelPayment', orderId: tx.orderId },
          traceId,
          s.accountScope,
        );
      } finally {
        if (s.epoch === this.epoch && this.activeScope?.key === s.key)
          this.emit('cancelled', tx.orderId, s);
      }
      await this.assert(s);
      if (
        typeof response !== 'object' ||
        response === null ||
        !('order' in response) ||
        !('membership' in response)
      )
        throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
      return this.applyOrderResult(response, tx.orderId, s, traceId);
    }
    try {
      await this.assert(s);
      this.save({ ...tx, stage: 'PAYMENT_UNKNOWN' }, s);
      if (failure) {
        const d = normalizeVirtualPaymentError(failure);
        this.emit(d.outcome === 'cancelled' ? 'cancelled' : 'unknown', tx.orderId, s);
        logPaymentDiagnostic('bridge_result', undefined, {
          ...d,
          traceId,
          elapsedMs: Date.now() - started,
        });
      }
    } finally {
      // Opening the cashier can hide this page. Report the captured attempt
      // even then, but never publish its late response into a newer session.
      try {
        await this.gateway.call(
          { action: 'markPaymentUnknown', orderId: tx.orderId },
          traceId,
          s.accountScope,
        );
      } catch {
        /* a called bridge remains unknown */
      }
    }
    await this.assert(s);
    return this.queryFor(tx.orderId, s, traceId);
  }
  async queryOrder(id: string, traceId?: string) {
    return this.queryFor(id, await this.scope(traceId), traceId);
  }
  private async cancelFor(id: string, s: Scope, traceId?: string) {
    const r = await this.gateway.call(
      { action: 'cancelPayment', orderId: id },
      traceId,
      s.accountScope,
    );
    await this.assert(s);
    if (typeof r !== 'object' || r === null || !('order' in r) || !('membership' in r))
      throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
    return this.applyOrderResult(r, id, s, traceId);
  }
  private queryFor(id: string, s: Scope, traceId?: string): Promise<MembershipPurchaseResult> {
    const k = `${s.key}\0${id}`,
      active = this.queries.get(k);
    if (active) return active;
    const task = (async () => {
      this.emit('confirming', id, s);
      const r = await this.gateway.call(
        { action: 'getOrder', orderId: id },
        traceId,
        s.accountScope,
      );
      await this.assert(s);
      this.assertCurrent(s);
      if (
        typeof r !== 'object' ||
        r === null ||
        !('order' in r) ||
        !('membership' in r) ||
        r.order.orderId !== id
      )
        throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
      return this.applyOrderResult(r, id, s, traceId);
    })().finally(() => this.queries.delete(k));
    this.queries.set(k, task);
    return task;
  }
  private applyOrderResult(
    r: MembershipOrderResult & { membership: MembershipStatus },
    id: string,
    s: Scope,
    traceId?: string,
  ): MembershipPurchaseResult {
    this.assertCurrent(s);
    if (r.order.orderId !== id) throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
    const confirmed = r.order.status === 'PAID' && r.membership.isMember,
      result: MembershipPurchaseResult = {
        order: r.order,
        membership: r.membership,
        confirmed,
        paymentState: confirmed
          ? 'succeeded'
          : r.order.purchaseCancelled && r.order.status !== 'PAID'
            ? 'cancelled'
            : this.state(r.order.status),
      };
    if (this.tx(s)?.orderId === id) {
      this.save({ ...this.tx(s)!, stage: r.order.status }, s);
      if (
        confirmed ||
        (r.order.purchaseCancelled && r.order.status !== 'PAID') ||
        ['CLOSED', 'FAILED', 'REFUNDED'].includes(r.order.status)
      )
        this.db.remove(this.key(s));
    }
    this.results.set(s.key, result);
    logPaymentDiagnostic('query_result', undefined, {
      traceId,
      queryResult: r.order.status,
      reason: confirmed ? 'ENTITLEMENT_CONFIRMED' : 'UNCONFIRMED',
    });
    this.emit(result.paymentState ?? 'unknown', id, s);
    return result;
  }
}
export const memberPaymentService = new MembershipService();

export const MEMBERSHIP_FREE_LIMIT = 3;
export const MEMBERSHIP_PRICE_FEN = 2800;

export type MembershipFeature = string;
export type MembershipOrderStatus =
  | 'PREPARED'
  | 'PAYMENT_STARTING'
  | 'PAYMENT_UNKNOWN'
  | 'PENDING'
  | 'PAID'
  | 'CLOSED'
  | 'FAILED'
  | 'REFUNDED';
export type MembershipPaymentState =
  'idle' | 'opening' | 'confirming' | 'pending' | 'succeeded' | 'cancelled' | 'failed' | 'unknown';

/**
 * Durable client-side transaction phase.  This deliberately is not the same
 * thing as the payment platform's order status: before the native bridge has
 * accepted a request we have no basis for treating an order as platform
 * pending.
 */
export type MembershipTransactionStage =
  | 'PREPARED'
  | 'PAYMENT_STARTING'
  | 'PAYMENT_UNKNOWN'
  | 'PENDING'
  | 'PAID'
  | 'CLOSED'
  | 'FAILED'
  | 'REFUNDED';

export interface MembershipStatus {
  isMember: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  freeUsed: number;
  freeRemaining: number;
  freeLimit: number;
  freeDate: string;
  serverTime: string;
  paymentAvailable: boolean;
  paymentUnavailableReason?: 'DISABLED' | 'MISSING_CONFIGURATION' | 'APP_ID_MISMATCH';
}

export interface MembershipOrder {
  orderId: string;
  status: MembershipOrderStatus;
  amount: number;
  paidAt: string | null;
  /** The user ended this purchase attempt; its payment may still be reconciled. */
  purchaseCancelled?: boolean;
}

export interface MembershipPayment {
  mode: 'short_series_goods';
  signData: string;
  paySig: string;
  signature: string;
}

export interface MembershipOrderResult {
  order: MembershipOrder;
  payment?: MembershipPayment;
  canStartPayment?: boolean;
  /** Opaque server-issued, expiring attempt. Never persist or log it. */
  bridgeAttempt?: string;
  bridgeLease?: boolean;
}

export interface MembershipPurchaseResult {
  order: MembershipOrder;
  membership: MembershipStatus;
  confirmed: boolean;
  paymentState?: MembershipPaymentState;
}

export type MembershipErrorCode =
  | 'DAILY_LIMIT_REACHED'
  | 'MEMBERSHIP_REQUIRED'
  | 'PAYMENT_NOT_CONFIGURED'
  | 'INVALID_GRANT'
  | 'GRANT_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'UNAUTHENTICATED'
  | 'INVALID_REQUEST'
  | 'ORDER_NOT_FOUND'
  | 'MEMBERSHIP_UNAVAILABLE'
  | 'VIRTUAL_PAYMENT_UNSUPPORTED';

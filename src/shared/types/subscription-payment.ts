/** Mirrors the cloud registry's SubscriptionPayment — read-only here, fetched via
 * POST /activation/payments (see main/services/license-service.ts's fetchPaymentHistory). Pending
 * payments double as the client's outstanding invoices — see the "Pay Now" flow on
 * BusinessProfileRoute.tsx and the lockout screens. */
export type SubscriptionPaymentStatus = "PAID" | "PENDING" | "FAILED";

export type SubscriptionPaymentRecord = {
  id: string;
  amountCents: number;
  currency: string;
  paymentMethod: string;
  transactionReference: string | null;
  billingPeriod: string;
  paymentDate: string;
  status: SubscriptionPaymentStatus;
};

export type PaymentHistoryResult = {
  recentPayments: SubscriptionPaymentRecord[];
  pendingPayments: SubscriptionPaymentRecord[];
};

/** Mirrors SERVER's computePaymentSchedule (billing-periods.ts) — the "Jan ✅ Feb ✅ Mar ❌"
 * computed grid, fetched via POST /activation/payment-schedule. Powers both the paid/pending
 * calendar on BusinessProfileRoute and the "pay in advance" period picker's pricing.
 * "overdue" = unpaid and before the current period (red, genuinely late).
 * "due" = unpaid and IS the current period (amber, due now but not yet late). */
export type BillingPeriodEntry = {
  key: string;
  label: string;
  status: "paid" | "overdue" | "due" | "future";
};

export type PaymentScheduleResult = {
  billingCycle: "MONTHLY" | "YEARLY" | "ONCE";
  pricePerPeriodCents: number | null;
  currency: string;
  periods: BillingPeriodEntry[];
  nextDueDate: string | null;
  /** Only ever true once the FIRST recurring-flagged Pesapal IPN has actually landed — see
   * billing-pesapal-service.ts (SERVER). Powers PaymentsRoute.tsx's "Auto-Billing Active" badge. */
  pesapalAutoBillingEnabled: boolean;
  pesapalAutoBillingActivatedAt: string | null;
  /** Prepaid balance — absent from an older SERVER. */
  walletBalanceCents?: number;
};

/** SERVER's subscription-wallet-service.ts WalletSummary — the prepaid balance and its ledger. */
export type WalletEntry = {
  id: string;
  /** TOPUP | DEDUCTION | ADJUSTMENT */
  kind: string;
  amountCents: number;
  balanceAfterCents: number;
  billingPeriod: string | null;
  paymentMethod: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
};

export type WalletSummary = {
  balanceCents: number;
  currency: string;
  pricePerPeriodCents: number | null;
  billingCycle: string;
  periodsCovered: number;
  nextDueDate: string | null;
  nextDueUncovered: boolean;
  entries: WalletEntry[];
};

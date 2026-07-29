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
};

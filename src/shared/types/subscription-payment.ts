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

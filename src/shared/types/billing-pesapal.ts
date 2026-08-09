/** Mirrors SERVER's own response shapes exactly (billing-pesapal-service.ts) — the Card/PayPal
 * counterpart to shared/types/billing-mpesa.ts. This device never computes any of this itself, only
 * displays what SERVER already resolved. */

export type BillingPesapalSubmitOrderResult = {
  orderTrackingId: string;
  merchantReference: string;
  redirectUrl: string;
  amountCents: number;
  periods: string[];
  /** Only set when the order was submitted with enrollAutoBilling — shown in the "Setup Auto Billing"
   * instructions panel ("Setup future recurring payments for account ..."). */
  accountNumber: string | null;
};

export type BillingPesapalTransactionStatus = "pending" | "success" | "failed" | "reversed" | "invalid";

export type BillingPesapalStatusResult = {
  status: BillingPesapalTransactionStatus;
  message: string;
  confirmationCode: string | null;
  paymentMethodDetail: string | null;
  amountCents: number;
};

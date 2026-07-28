/** Mirrors SERVER's own response shapes exactly (billing-mpesa-service.ts) — the platform-billing
 * counterpart to shared/types/mpesa.ts's sales STK types. This device never computes any of this
 * itself, only displays what SERVER already resolved. */

export type BillingStkPushResult = {
  checkoutRequestId: string;
  merchantRequestId: string;
  amountCents: number;
  periods: string[];
};

export type BillingMpesaTransactionStatus =
  | "pending"
  | "success"
  | "insufficient"
  | "cancelled"
  | "wrong_pin"
  | "timeout"
  | "failed";

export type BillingMpesaStatusResult = {
  status: BillingMpesaTransactionStatus;
  message: string;
  mpesaReceiptNumber: string | null;
  amountCents: number;
  phone: string;
};

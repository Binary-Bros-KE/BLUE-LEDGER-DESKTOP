/** Mirrors SERVER's own response shapes exactly (mpesa-service.ts) — this device never computes
 * any of this itself, it only ever displays what SERVER already resolved. */

export type MpesaEnvironment = "sandbox" | "production";

/** Only ever fetched fresh from SERVER when the settings panel is explicitly opened — never
 * cached or persisted locally (see SERVER's MpesaTillSettings model comment for why). */
export type MpesaTillSettings = {
  environment: MpesaEnvironment;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  tillNumber: string;
  accountReference: string;
};

export type MpesaStkPushResult = {
  checkoutRequestId: string;
  merchantRequestId: string;
};

export type MpesaTransactionStatus =
  | "pending"
  | "success"
  | "insufficient"
  | "cancelled"
  | "wrong_pin"
  | "timeout"
  | "failed";

export type MpesaStatusResult = {
  status: MpesaTransactionStatus;
  message: string;
  mpesaReceiptNumber: string | null;
  amountCents: number;
  phone: string;
};

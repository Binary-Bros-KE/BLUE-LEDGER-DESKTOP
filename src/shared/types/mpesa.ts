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

/** Per storefront, only once till credentials are saved. off = nothing shown or recorded; loose (the
 * default) = verification offered, a sale can complete without it; strict = must verify to complete. */
export type MpesaVerificationMode = "off" | "loose" | "strict";

export type MpesaVerificationState = {
  /** The first check: false until this storefront has saved till credentials. */
  available: boolean;
  mode: MpesaVerificationMode;
  /** Safaricom has accepted our payment-notification URLs for this till. */
  connected: boolean;
  connectError: string | null;
};

/** A real payment on the till that hasn't been claimed by any sale. */
export type MpesaPaymentMatch = {
  code: string;
  amountCents: number;
  payerName: string | null;
  maskedPhone: string | null;
  receivedAt: string;
};

export type MpesaVerificationRecord = {
  status: "verified" | "unverified";
  verifiedAt: string | null;
  payerName: string | null;
  amountCents: number | null;
};

/** Per code, on the sale. A sale with none shows no indicator (verification wasn't in play). */
export type MpesaVerifications = Record<string, MpesaVerificationRecord>;

export type MpesaVerificationSummary = MpesaVerificationRecord["status"] | null;

export type MpesaVerifyResult = {
  outcome: "verified" | "not_found" | "already_used" | "amount_mismatch" | "wrong_storefront";
  code: string;
  message: string;
  record: MpesaVerificationRecord | null;
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

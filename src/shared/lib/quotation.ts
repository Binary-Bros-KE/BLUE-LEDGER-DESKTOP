import type { QuotationStatus } from "@shared/types/quotation";

/**
 * Derives the correct quotation status from the numbers, rather than trusting a stored value that
 * can go stale as the calendar moves past valid_until. Mirrors computePaymentStatus() for invoices.
 * Rejected and Converted are terminal — a date rollover never overrides them.
 *
 * validUntil is nullable: a null (or blank) expiry means the client never set one, and the quotation
 * simply never expires — see the quotation_valid_until_optional migration. Only an explicit date in
 * the past flips a live quotation to "expired".
 */
export function computeQuotationStatus(params: {
  storedStatus: QuotationStatus;
  validUntil: string | null;
  now?: Date;
}): QuotationStatus {
  if (params.storedStatus === "rejected" || params.storedStatus === "converted") {
    return params.storedStatus;
  }

  if (!params.validUntil) {
    return params.storedStatus;
  }

  const now = params.now ?? new Date();
  if (new Date(params.validUntil).getTime() < now.getTime()) {
    return "expired";
  }

  return params.storedStatus;
}

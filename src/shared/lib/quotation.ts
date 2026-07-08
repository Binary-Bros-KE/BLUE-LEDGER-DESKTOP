import type { QuotationStatus } from "@shared/types/quotation";

/**
 * Derives the correct quotation status from the numbers, rather than trusting a stored value that
 * can go stale as the calendar moves past valid_until. Mirrors computePaymentStatus() for invoices.
 * Rejected and Converted are terminal — a date rollover never overrides them.
 */
export function computeQuotationStatus(params: {
  storedStatus: QuotationStatus;
  validUntil: string;
  now?: Date;
}): QuotationStatus {
  if (params.storedStatus === "rejected" || params.storedStatus === "converted") {
    return params.storedStatus;
  }

  const now = params.now ?? new Date();
  if (new Date(params.validUntil).getTime() < now.getTime()) {
    return "expired";
  }

  return params.storedStatus;
}

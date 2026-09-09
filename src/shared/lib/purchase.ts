import type { PurchasePaymentStatus } from "@shared/types/purchase";

/** Derives Unpaid/Partially Paid/Paid from the numbers rather than trusting a stored value. */
/** Client request: based on what's actually been RECEIVED, not the full order total — you can only
 * pay for goods that have arrived (see applyPayment's own balanceDueCents check, purchase-
 * service.ts), so a purchase reads "Paid" once everything currently owed is settled, even if more
 * is still to arrive (and be paid for) later. A purchase with nothing received yet stays "unpaid"
 * forever until something arrives — there's nothing to pay against before then. */
export function computePurchasePaymentStatus(params: {
  receivedValueCents: number;
  amountPaidCents: number;
}): PurchasePaymentStatus {
  if (params.amountPaidCents <= 0) return "unpaid";
  if (params.amountPaidCents >= params.receivedValueCents) return "paid";
  return "partially_paid";
}

/** Draft/Ordered are manual; Partially Received/Received are derived purely from item quantities —
 * never set directly, so they can't drift out of sync with what was actually received. */
export function computePurchaseReceivingStatus(params: {
  items: Array<{ orderedQuantity: number; receivedQuantity: number }>;
}): "ordered" | "partially_received" | "received" {
  const totalOrdered = params.items.reduce((sum, item) => sum + item.orderedQuantity, 0);
  const totalReceived = params.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
  if (totalReceived <= 0) return "ordered";
  if (totalReceived >= totalOrdered) return "received";
  return "partially_received";
}

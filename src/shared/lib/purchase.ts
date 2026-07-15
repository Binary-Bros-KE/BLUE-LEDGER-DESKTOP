import type { PurchasePaymentStatus } from "@shared/types/purchase";

/** Derives Unpaid/Partially Paid/Paid from the numbers rather than trusting a stored value. */
export function computePurchasePaymentStatus(params: {
  grandTotalCents: number;
  amountPaidCents: number;
}): PurchasePaymentStatus {
  if (params.amountPaidCents <= 0) return "unpaid";
  if (params.amountPaidCents >= params.grandTotalCents) return "paid";
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

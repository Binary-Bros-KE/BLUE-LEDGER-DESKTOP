import type { PurchasePaymentStatus } from "@shared/types/purchase";

/** What's currently owed to the supplier: item value received so far, plus the FULL shipping fee the
 * moment anything at all has been received (confirmed client decision — the fee isn't gated further
 * by how much has arrived, just THAT something has; before the first receipt, nothing is payable,
 * fee included). Shipping cost (the business's own internal expense) never appears here — it's never
 * owed to the supplier, see purchase-service.ts's createShippingCostExpenseIfNeeded instead. */
export function computePurchasePayableCents(params: { receivedValueCents: number; shippingFeeCents: number }): number {
  return params.receivedValueCents + (params.receivedValueCents > 0 ? params.shippingFeeCents : 0);
}

/** Derives Unpaid/Partially Paid/Paid from the numbers rather than trusting a stored value. */
/** Client request: based on what's actually been RECEIVED (plus the shipping fee once anything has —
 * see computePurchasePayableCents), not the full order total — you can only pay for goods that have
 * arrived (see applyPayment's own balanceDueCents check, purchase-service.ts), so a purchase reads
 * "Paid" once everything currently owed is settled, even if more is still to arrive (and be paid for)
 * later. A purchase with nothing received yet stays "unpaid" forever until something arrives —
 * there's nothing to pay against before then. */
export function computePurchasePaymentStatus(params: {
  receivedValueCents: number;
  shippingFeeCents: number;
  amountPaidCents: number;
}): PurchasePaymentStatus {
  const payableCents = computePurchasePayableCents(params);
  if (params.amountPaidCents <= 0) return "unpaid";
  if (params.amountPaidCents >= payableCents) return "paid";
  return "partially_paid";
}

export type ShipmentStage = "ordered" | "shipped" | "received" | "overdue";

/** Ordered → Shipped (shipmentDepartedAt set) → Received (purchase fully received — partial receiving
 * doesn't count, matching computePurchaseReceivingStatus's own "received" definition) — with an
 * Overdue override once the ETA has passed and the purchase still isn't fully received, regardless of
 * shipped/ordered stage. fillPercent is only meaningful once shipped AND an ETA exists: linear
 * interpolation of "today" between departure and ETA, clamped 0-100; null otherwise (no fill to show,
 * just the stage). */
export function computeShipmentStage(params: {
  shipmentDepartedAt: string | null;
  shipmentEta: string | null;
  isFullyReceived: boolean;
  now?: Date;
}): { stage: ShipmentStage; fillPercent: number | null } {
  const now = params.now ?? new Date();

  if (params.isFullyReceived) {
    return { stage: "received", fillPercent: 100 };
  }

  const isOverdue = Boolean(params.shipmentEta) && now.getTime() > new Date(params.shipmentEta as string).getTime();
  if (isOverdue) {
    return { stage: "overdue", fillPercent: 100 };
  }

  if (!params.shipmentDepartedAt) {
    return { stage: "ordered", fillPercent: null };
  }

  if (!params.shipmentEta) {
    return { stage: "shipped", fillPercent: null };
  }

  const departedMs = new Date(params.shipmentDepartedAt).getTime();
  const etaMs = new Date(params.shipmentEta).getTime();
  const span = etaMs - departedMs;
  const elapsed = now.getTime() - departedMs;
  const fillPercent = span <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((elapsed / span) * 100)));
  return { stage: "shipped", fillPercent };
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

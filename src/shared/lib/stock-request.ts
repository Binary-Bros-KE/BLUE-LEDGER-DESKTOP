export type StockRequestItemFulfillmentTone = "pending" | "full" | "partial" | "none";

/** Shared by both the approver's live-preview (as the storekeeper adjusts dispatch quantities) and
 * the requester's read-only view, so the two surfaces can never disagree on what counts as partial
 * vs. full. `quantityDispatched === null` means the line hasn't been reviewed yet (request still
 * pending, or rejected outright) — never confused with a reviewed line that shipped zero. */
export function computeStockRequestItemFulfillmentTone(item: {
  quantityRequested: number;
  quantityDispatched: number | null;
}): StockRequestItemFulfillmentTone {
  if (item.quantityDispatched === null) return "pending";
  if (item.quantityDispatched <= 0) return "none";
  if (item.quantityDispatched < item.quantityRequested) return "partial";
  return "full";
}

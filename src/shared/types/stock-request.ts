export type StockRequestStatus = "pending" | "approved" | "rejected";

export type StockRequestItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantityRequested: number;
  /** Frozen at the moment this item was approved and shipped — never recomputed, so reopening/
   * reprinting the request months later shows exactly what was true then. Null while the request is
   * still pending, or if it was rejected (nothing ever shipped). Mirrors StockReceiptItem's own
   * previous/new quantity pair. */
  previousQuantity: number | null;
  newQuantity: number | null;
  /** The OTHER side of the same approval — Main Store's own on-hand quantity immediately before/after
   * this item was drawn out. Null under the same conditions as previousQuantity/newQuantity above. */
  mainStorePreviousQuantity: number | null;
  mainStoreNewQuantity: number | null;
  /** Client request: partial fulfillment — how much of quantityRequested the storekeeper actually
   * shipped. Null while pending/rejected (nothing reviewed yet); 0 is a real, explicit "reviewed, shipped
   * nothing" value, never confused with "not yet reviewed". See computeStockRequestItemFulfillmentTone
   * (shared/lib/stock-request.ts) for how this drives the green/yellow/red indicator. */
  quantityDispatched: number | null;
};

/** One row for the Stock Requests list — Cashier/Manager see only their own storefront's requests
 * (branch-scoped like everything else); Storekeeper/Super Admin see every storefront's. */
export type StockRequestListItem = {
  id: string;
  requestNumber: string;
  storefrontId: string;
  storefrontName: string;
  status: StockRequestStatus;
  itemCount: number;
  totalQuantityRequested: number;
  notes: string | null;
  rejectionReason: string | null;
  /** Client request: optional storekeeper note explaining a partial/zero dispatch, so the requesting
   * storefront understands why not everything shipped. Null unless the storekeeper left one — can be
   * present even on a fully-dispatched request. */
  fulfillmentNote: string | null;
  /** Null while pending/rejected (nothing to compute yet). Once approved: true only if every line's
   * quantityDispatched >= quantityRequested — lets the list show a "Partial" badge without a second
   * round trip for per-item data. */
  fullyDispatched: boolean | null;
  requestedByName: string;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

export type StockRequest = StockRequestListItem & {
  items: StockRequestItem[];
};

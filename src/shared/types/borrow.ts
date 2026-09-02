export type BorrowId = string;
export type BorrowItemId = string;

/**
 * "Borrow & Lend" — a client asked for a way to track physical stock moving between this shop and
 * another shop (represented by the existing Suppliers list — no separate "shops" concept, per the
 * client's own framing) WITHOUT it being a purchase (no money/pricing involved) and without it
 * showing up anywhere as a sale. Two directions, named around what happened to THIS shop's own
 * stock:
 *  - "borrowed": this shop borrowed FROM the other shop — they handed over stock, so it's added
 *    here now (movement "borrow_in"), and giving it back later removes it again ("borrow_return_out").
 *  - "lent": this shop lent TO the other shop — stock leaves here now (movement "loan_out"), and
 *    getting it back later adds it back ("loan_return_in").
 * See stock-movement.ts's own doc comment on those four movement types, and borrow-service.ts for
 * where each one is actually created.
 */
export const BORROW_DIRECTION_OPTIONS = [
  { value: "borrowed", label: "Borrowed From Them" },
  { value: "lent", label: "Lent To Them" }
] as const;

export type BorrowDirection = (typeof BORROW_DIRECTION_OPTIONS)[number]["value"];

/** Draft/Ordered-style manual status doesn't apply here — a borrow's stock movement happens the
 * instant it's created (unlike a purchase, which only touches stock on receiving), so there's no
 * "not yet started" state. Purely derived from how much of each item has been returned so far —
 * never set directly, mirroring computePurchaseReceivingStatus's own reasoning. */
export const BORROW_STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "partially_returned", label: "Partially Returned" },
  { value: "returned", label: "Returned" }
] as const;

export type BorrowStatus = (typeof BORROW_STATUS_OPTIONS)[number]["value"];

export type BorrowSyncStatus = "pending" | "synced" | "syncing" | "error";

/** One product line within a single "Record Return" action (see BorrowReturnEvent) — a borrow can
 * be returned across several separate sessions, same reasoning as PurchaseReceivingEventItem: each
 * session freezes its own before/after independently, so a later partial return never retroactively
 * changes what an earlier one's own numbers showed. */
export type BorrowReturnEventItem = {
  borrowItemId: string;
  productId: string;
  productName: string;
  sku: string;
  returnQuantity: number;
  previousQuantity: number;
  newQuantity: number;
};

/** One "Record Return" click — a borrow can have several of these over time as different quantities
 * come back at different times. */
export type BorrowReturnEvent = {
  id: string;
  returnedBy: string;
  returnedByName: string;
  returnedAt: string;
  items: BorrowReturnEventItem[];
};

export type BorrowItem = {
  id: BorrowItemId;
  borrowId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  createdAt: string;
  updatedAt: string;
};

export type Borrow = {
  id: BorrowId;
  tenantId: string;
  borrowNumber: string;
  direction: BorrowDirection;
  /** The other shop — an existing Supplier row, per the client's own request not to build a
   * separate "shops" list. */
  supplierId: string;
  supplierName: string;
  /** Which of THIS tenant's own locations the stock was added to/removed from — same "destination"
   * concept as Purchase.locationId, just bidirectional here. */
  locationId: string;
  locationName: string;
  status: BorrowStatus;
  notes: string | null;
  returnEvents: BorrowReturnEvent[];
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: BorrowSyncStatus;
  lastSyncedAt: string | null;
  items: BorrowItem[];
};

/** Lightweight row for the Borrow & Lend list — no line items, just enough to list and filter. */
export type BorrowListItem = {
  id: string;
  borrowNumber: string;
  direction: BorrowDirection;
  supplierId: string;
  supplierName: string;
  locationId: string;
  locationName: string;
  status: BorrowStatus;
  itemCount: number;
  totalQuantity: number;
  totalRemainingQuantity: number;
  createdAt: string;
};

export type BorrowSummary = {
  totalBorrows: number;
  openCount: number;
  partiallyReturnedCount: number;
  returnedCount: number;
  /** Counts only direction: "borrowed" — units of someone else's stock currently sitting here,
   * unreturned. */
  outstandingBorrowedQuantity: number;
  /** Counts only direction: "lent" — units of this shop's own stock currently out with someone
   * else, unreturned. */
  outstandingLentQuantity: number;
};

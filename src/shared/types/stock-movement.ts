export const STOCK_MOVEMENT_TYPE_OPTIONS = [
  { value: "purchase", label: "Purchase" },
  { value: "sale", label: "Sale" },
  { value: "transfer_in", label: "Transfer In" },
  { value: "transfer_out", label: "Transfer Out" },
  { value: "return", label: "Return" },
  { value: "damage", label: "Damage / Loss" },
  { value: "adjustment", label: "Adjustment" },
  { value: "opening_stock", label: "Opening Stock" },
  // The four Borrow & Lend movements — see shared/types/borrow.ts's own doc comment for the full
  // "why", and borrow-service.ts for where each of these is actually created. Named around what
  // happened to THIS shop's own stock, not the counterparty's, same convention as transfer_in/out.
  { value: "borrow_in", label: "Borrowed In" },
  { value: "borrow_return_out", label: "Returned Borrowed Stock" },
  { value: "loan_out", label: "Lent Out" },
  { value: "loan_return_in", label: "Loan Returned" }
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPE_OPTIONS)[number]["value"];

/**
 * Types a user can pick when manually recording a movement. "sale" is reserved for the checkout
 * flow, "transfer_in"/"transfer_out" are never selected directly — they're always created as a
 * matched pair by the transfer action — and the four borrow/lend types are likewise only ever
 * created by the Borrow & Lend feature's own actions (borrow-service.ts), never standalone.
 */
export const MANUAL_STOCK_MOVEMENT_TYPE_OPTIONS = STOCK_MOVEMENT_TYPE_OPTIONS.filter(
  (option) =>
    option.value !== "sale" &&
    option.value !== "transfer_in" &&
    option.value !== "transfer_out" &&
    option.value !== "borrow_in" &&
    option.value !== "borrow_return_out" &&
    option.value !== "loan_out" &&
    option.value !== "loan_return_in"
);

/** Movement types where the backend/UI infers the sign — the user only ever enters a magnitude. */
export const AUTO_INCREASE_MOVEMENT_TYPES: ReadonlySet<StockMovementType> = new Set([
  "purchase",
  "return",
  "opening_stock"
]);
export const AUTO_DECREASE_MOVEMENT_TYPES: ReadonlySet<StockMovementType> = new Set(["damage"]);

export type StockMovementSyncStatus = "pending" | "synced" | "syncing" | "error";

export type StockMovement = {
  id: string;
  tenantId: string;
  productId: string;
  locationId: string;
  locationName: string;
  movementType: StockMovementType;
  quantityChange: number;
  referenceType: string | null;
  referenceId: string | null;
  performedBy: string | null;
  /** Resolved display name, e.g. "Jane Wanjiru" — null for a historical movement recorded before
   * this existed, or one with no employee attached (e.g. a system/import action). */
  performedByName: string | null;
  notes: string | null;
  createdAt: string;
  syncStatus: StockMovementSyncStatus;
  lastSyncedAt: string | null;
};

/** Result of a two-sided transfer: one deducting movement at the source, one adding at the destination. */
export type StockTransferResult = {
  transferOut: StockMovement;
  transferIn: StockMovement;
};

/** One row in the global Stock Ledger feed — a movement plus enough product context to display it
 * without a second lookup, and its cost value for the "value of stock moved" column. */
export type StockMovementFeedItem = StockMovement & {
  productName: string;
  sku: string;
  valueCents: number;
};

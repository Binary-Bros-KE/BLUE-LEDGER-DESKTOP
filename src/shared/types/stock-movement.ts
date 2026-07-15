export const STOCK_MOVEMENT_TYPE_OPTIONS = [
  { value: "purchase", label: "Purchase" },
  { value: "sale", label: "Sale" },
  { value: "transfer_in", label: "Transfer In" },
  { value: "transfer_out", label: "Transfer Out" },
  { value: "return", label: "Return" },
  { value: "damage", label: "Damage / Loss" },
  { value: "adjustment", label: "Adjustment" },
  { value: "opening_stock", label: "Opening Stock" }
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPE_OPTIONS)[number]["value"];

/**
 * Types a user can pick when manually recording a movement. "sale" is reserved for the checkout
 * flow, and "transfer_in"/"transfer_out" are never selected directly — they're always created as a
 * matched pair by the transfer action, never as a standalone entry.
 */
export const MANUAL_STOCK_MOVEMENT_TYPE_OPTIONS = STOCK_MOVEMENT_TYPE_OPTIONS.filter(
  (option) => option.value !== "sale" && option.value !== "transfer_in" && option.value !== "transfer_out"
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

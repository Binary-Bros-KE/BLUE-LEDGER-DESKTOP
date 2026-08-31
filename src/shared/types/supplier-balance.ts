/** Why one entry exists — 'purchase_ordered'/'purchase_cancelled'/'payment' are written automatically
 * by purchase-service.ts (see its own comments at each call site); 'manual_adjustment' is the only one
 * a person creates directly, via supplier-service.ts's adjustSupplierBalance — covers both "record
 * balance carried forward from the old system" and any later correction (see
 * supplierBalanceAdjustSchema's own doc comment for why those share one action). */
export const SUPPLIER_BALANCE_ENTRY_TYPE_OPTIONS = [
  { value: "purchase_ordered", label: "Purchase Ordered" },
  { value: "purchase_cancelled", label: "Purchase Cancelled" },
  { value: "payment", label: "Payment" },
  { value: "manual_adjustment", label: "Manual Adjustment" }
] as const;

export type SupplierBalanceEntryType = (typeof SUPPLIER_BALANCE_ENTRY_TYPE_OPTIONS)[number]["value"];

/** One row in a supplier's balance ledger — append-only, never edited after creation (same discipline
 * as StockMovement: a correction is a NEW entry, never a change to an old one). amountCents is signed:
 * positive increased what's owed to the supplier, negative decreased it. Mirrors StockMovement's own
 * shape closely on purpose — same "immutable event stream, running total derived incrementally, never
 * summed live" architecture, see supplier-balance-service.ts's own doc comment for why. */
export type SupplierBalanceEntry = {
  id: string;
  supplierId: string;
  entryType: SupplierBalanceEntryType;
  amountCents: number;
  referenceType: "purchase" | null;
  referenceId: string | null;
  notes: string | null;
  performedBy: string | null;
  performedByName: string | null;
  createdAt: string;
};

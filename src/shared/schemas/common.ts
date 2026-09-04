import { z } from "zod";

/** Trimmed optional string that normalizes "" and undefined to null for storage. */
export function optionalText(max = 255) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
}

/** A real tri-state boolean — unlike z.coerce.boolean() (which this codebase otherwise favors for
 * plain flags), this deliberately does NOT coerce, since the whole point of a field like this is
 * telling "explicitly false" apart from "not set" (both are meaningfully different overrides, e.g.
 * saleCartItemSchema's own taxInclusiveOverride) — coercion would risk collapsing that distinction.
 * Normalizes undefined to null so every caller only ever has two states to branch on. */
export function optionalBoolean() {
  return z
    .boolean()
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value));
}

/** Shared by every cart-line item schema that supports "Sourced from another shop" (Checkout,
 * Invoices, Quotations) — a real client's cashier checked the box by accident, never entered a
 * cost, and the line silently skipped the shop's own stock ledger with zero margin accountability
 * recorded either. A checked box now always needs a real, positive cost — 0 doesn't count, since a
 * genuinely locally-sourced item always has SOME real cost. */
export function localSourcingRequiresCost(data: { isLocallySourced: boolean; localCostCents?: number | undefined }): boolean {
  return !data.isLocallySourced || (data.localCostCents !== undefined && data.localCostCents > 0);
}

export const LOCAL_SOURCING_REFINEMENT_OPTS = {
  message: "Enter the buying price for this locally-sourced item",
  path: ["localCostCents"] as PropertyKey[]
};

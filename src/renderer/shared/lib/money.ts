/** Converts a decimal amount string (e.g. "250.50") typed by the user into integer cents. Empty/invalid input becomes 0. */
export function toCents(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

/** Converts integer cents into a decimal string suitable for a text input, e.g. 25050 -> "250.50". */
export function fromCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

/** Formats integer cents for display, e.g. 25050 -> "250.50". Always 2 decimal places, no currency symbol. */
export function formatCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The "Sourced from another shop" cost field is typed as a per-unit price (matching the "Price"
 * override field right next to it) but stored/reported as the line's TOTAL cost (localCostCents —
 * see SaleItem's own doc comment and local-sourcing-report-service.ts's netLine, which nets it
 * against line_total_cents, a full-line figure). This pair keeps that split at the UI edges only, so
 * the DB/report layer never has to change: multiply by quantity right before it leaves the form,
 * divide by quantity right when an existing total is loaded back into the form. */
export function unitCostToTotalCents(unitCostText: string, quantity: number): number {
  return Math.round(toCents(unitCostText) * quantity);
}

/** Inverse of unitCostToTotalCents — turns a stored TOTAL localCostCents back into the per-unit text
 * this field now expects, e.g. when resuming a held sale or opening an existing draft for edit.
 * Null/non-positive quantity (shouldn't happen — every line always has at least 1) falls back to "". */
export function totalCentsToUnitCostText(totalCents: number | null, quantity: number): string {
  if (totalCents === null || !Number.isFinite(totalCents) || quantity <= 0) return "";
  return fromCents(Math.round(totalCents / quantity));
}

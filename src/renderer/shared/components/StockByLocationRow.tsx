import type { InventoryBalance } from "@shared/types/inventory";

/** "Stock at Storefront A: 5" — lets someone building an invoice or quotation see stock without
 * leaving the page to check the Products tab, scoped to ONLY the storefront this document is
 * actually for (a branch-scoped employee's own branch, or whatever a branch-less caller picked via
 * StorefrontPicker). Used to show every location at once ("Main Store: 12 · Storefront A: 5 ·
 * Storefront B: 0") — real field feedback: that made it look like the sale could draw from anywhere,
 * when it can only ever draw from this one location. Renders nothing while locationId is still
 * unresolved (a branch-less caller who hasn't picked a storefront yet), while still loading, or when
 * the signed-in role lacks "inventory","view" (see useProductStockOverview) — never a placeholder or
 * an empty/broken-looking row. */
export function StockByLocationRow({
  balances,
  locationId
}: {
  balances: InventoryBalance[] | undefined;
  locationId: string | null;
}): React.JSX.Element | null {
  if (!balances || !locationId) return null;
  const balance = balances.find((b) => b.locationId === locationId);
  if (!balance) return null;

  return (
    <p className="mt-1 truncate text-[10px] font-semibold text-muted">
      Stock at {balance.locationName}: {balance.quantity}
    </p>
  );
}

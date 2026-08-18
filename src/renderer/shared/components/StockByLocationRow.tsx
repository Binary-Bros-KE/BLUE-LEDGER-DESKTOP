import type { InventoryBalance } from "@shared/types/inventory";

/** "Main Store: 12 · Storefront A: 5 · Storefront B: 0" — lets someone building an invoice or
 * quotation see stock at every location without leaving the page to check the Products tab (the gap
 * this was built to close). Undefined while still loading or when the signed-in role lacks
 * "inventory","view" (see useProductStockOverview) — renders nothing rather than a placeholder, so
 * a role without the permission just doesn't see an empty/broken-looking row. */
export function StockByLocationRow({ balances }: { balances: InventoryBalance[] | undefined }): React.JSX.Element | null {
  if (!balances || balances.length === 0) return null;

  return (
    <p className="mt-1 truncate text-[10px] font-semibold text-muted" title={balances.map((b) => `${b.locationName}: ${b.quantity}`).join(" · ")}>
      Stock — {balances.map((b) => `${b.locationName}: ${b.quantity}`).join(" · ")}
    </p>
  );
}

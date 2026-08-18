import { useEffect, useRef, useState } from "react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import type { InventoryBalance } from "@shared/types/inventory";

/** Per-location stock breakdown for a set of products, fetched lazily and cached by productId so
 * cart-line re-renders (price/qty/discount edits) never re-fetch. Invoices/Quotations-only — see
 * their own doc comments for why Checkout doesn't need this (its ProductInfoModal already covers
 * "check stock without leaving the page" there).
 *
 * Silently returns nothing for a role without "inventory","view" — the endpoint that returns every
 * storefront's own count (inventory:overview) is deliberately gated behind that permission, more
 * restrictive than "products","view" (see ProductStockSummary's own doc comment in
 * shared/types/product.ts for why: per-storefront quantities aren't visible to every role that can
 * see the catalog). A branch-scoped role without it simply sees no stock-by-location row at all,
 * rather than a broken/empty-looking one. */
export function useProductStockOverview(productIds: string[]): Map<string, InventoryBalance[]> {
  const { can } = usePermissions();
  const allowed = can("inventory", "view");
  const [cache, setCache] = useState<Map<string, InventoryBalance[]>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());
  const key = [...new Set(productIds)].sort().join(",");

  useEffect(() => {
    if (!allowed || !key) return;
    const ids = key.split(",");
    const missing = ids.filter((id) => !cache.has(id) && !inFlight.current.has(id));
    if (missing.length === 0) return;

    missing.forEach((id) => inFlight.current.add(id));
    void Promise.all(
      missing.map((id) =>
        window.blueLedger.inventory
          .overview(id)
          .then((balances) => ({ id, balances }))
          .catch(() => ({ id, balances: [] as InventoryBalance[] }))
      )
    ).then((results) => {
      setCache((prev) => {
        const next = new Map(prev);
        for (const { id, balances } of results) next.set(id, balances);
        return next;
      });
      results.forEach(({ id }) => inFlight.current.delete(id));
    });
  }, [key, allowed, cache]);

  return cache;
}

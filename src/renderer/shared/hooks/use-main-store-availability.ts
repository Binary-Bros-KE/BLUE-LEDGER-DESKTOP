import { useEffect, useState } from "react";

/** What the Main Store can supply `storefrontId` per product (earmark + unallocated — the figure a
 * Main Store invoice line is held to), for the invoice/quotation forms' per-line stock pills. Fetched
 * as one call per change of storefront or product set; returns an empty map while `enabled` is false
 * (the admin's "Invoice stock from Main Store" toggle is off), with no storefront chosen yet, or if
 * the call fails — the pill is simply not shown, never a broken/zero-looking one. */
export function useMainStoreAvailability(
  storefrontId: string | null,
  productIds: string[],
  enabled: boolean
): Map<string, number> {
  const [availability, setAvailability] = useState<Map<string, number>>(new Map());
  const key = [...new Set(productIds)].sort().join(",");

  useEffect(() => {
    if (!enabled || !storefrontId || !key) {
      setAvailability(new Map());
      return;
    }
    let cancelled = false;
    window.blueLedger.invoice
      .mainStoreAvailability(storefrontId, key.split(","))
      .then((rows) => {
        if (!cancelled) setAvailability(new Map(rows.map((row) => [row.productId, row.availableQuantity])));
      })
      .catch(() => {
        if (!cancelled) setAvailability(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [storefrontId, key, enabled]);

  return availability;
}

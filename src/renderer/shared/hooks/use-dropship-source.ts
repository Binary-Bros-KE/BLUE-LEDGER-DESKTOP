import { useEffect, useState } from "react";
import type { DropshipState } from "@shared/types/dropship";

const REFRESH_MS = 60 * 1000;

// One shared read per minute however many product cards are on screen.
let cached: { at: number; state: Promise<DropshipState> } | null = null;

function loadState(): Promise<DropshipState> {
  if (!cached || Date.now() - cached.at > REFRESH_MS) {
    cached = { at: Date.now(), state: window.blueLedger.dropship.state() };
  }
  return cached.state;
}

export type DropshipSource = { supplierName: string; asOf: string | null };

/** Non-null when this product's stock follows a dropship supplier. Always null for a tenant without
 * dropshipping. */
export function useDropshipSource(productId: string): DropshipSource | null {
  const [source, setSource] = useState<DropshipSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadState()
      .then((state) => {
        if (cancelled) return;
        const supplierName = state.links[productId];
        setSource(supplierName ? { supplierName, asOf: state.suppliers.find((s) => s.name === supplierName)?.asOf ?? null } : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [productId]);

  return source;
}

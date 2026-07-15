/**
 * Tracks how Main Store's own held stock for a product is earmarked, per destination storefront —
 * a breakdown of the SAME total already reflected in the plain inventory table for Main Store's
 * location, never a second source of truth. storefrontId null means "unallocated" (general stock,
 * not yet earmarked for any one storefront).
 */
export type MainStoreAllocation = {
  id: string;
  tenantId: string;
  productId: string;
  storefrontId: string | null;
  quantity: number;
  createdAt: string;
  updatedAt: string;
};

/** One storefront's slice of a product's Main Store breakdown, alongside what that storefront
 * already has on its own shelves — the side-by-side replenishment view. */
export type MainStoreStorefrontBreakdown = {
  storefrontId: string;
  storefrontName: string;
  allocatedQuantity: number;
  onHandQuantity: number;
};

/** Full Main Store picture for one product: how much is unallocated, and how much is earmarked
 * for each storefront (with that storefront's own on-hand quantity alongside it). */
export type MainStoreProductDetail = {
  productId: string;
  unallocatedQuantity: number;
  totalAtMainStore: number;
  storefronts: MainStoreStorefrontBreakdown[];
};

/** Lightweight per-product summary used to render the Main Store list's columns without a
 * round-trip per row. */
export type MainStoreAllocationSummary = {
  productId: string;
  unallocatedQuantity: number;
  allocatedByStorefront: Record<string, number>;
};

/** One storefront's slice of a product row in the Main Store list — flags low stock right where
 * it's relevant (a storefront's own shelf, not Main Store's central holding). */
export type MainStoreRowStorefrontBreakdown = MainStoreStorefrontBreakdown & {
  isLow: boolean;
};

/** A full, self-contained row for the Main Store product list — everything needed to render an
 * "insightful at a glance" entry (tag, totals, and the complete per-storefront breakdown) without a
 * follow-up request per row. */
export type MainStoreProductRow = {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  storefrontTagId: string | null;
  status: "active" | "inactive";
  reorderLevel: number;
  imagePath: string | null;
  unallocatedQuantity: number;
  totalAtMainStore: number;
  storefronts: MainStoreRowStorefrontBreakdown[];
  hasLowStock: boolean;
};

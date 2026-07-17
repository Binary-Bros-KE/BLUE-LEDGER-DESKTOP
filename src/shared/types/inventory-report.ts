export type StockValueBreakdownEntry = {
  id: string;
  name: string;
  quantity: number;
  valueCents: number;
  percentOfTotal: number;
};

/** Cross-business snapshot: how many distinct products exist, how many units
 * total, and how many distinct products are low/out of stock ANYWHERE (a
 * product counts once here even if it's flagged at more than one location —
 * the per-location breakdown lives in each location's own section below). */
export type InventoryOverviewStats = {
  distinctProductCount: number;
  totalUnits: number;
  lowStockProductCount: number;
  outOfStockProductCount: number;
  totalStockValueCents: number;
};

export type StockMovementReportRow = {
  id: string;
  productName: string;
  sku: string;
  locationName: string;
  movementType: string;
  quantityChange: number;
  valueCents: number;
  referenceType: string | null;
  referenceId: string | null;
  performedByName: string | null;
  notes: string | null;
  createdAt: string;
};

/** One product's row within one location's section.
 *
 * The `storefront*` fields are only ever populated on the Main Store
 * section's rows — how much of this product is out in the field, in total.
 *
 * The `mainStoreQuantity`/`allocatedToThisStorefront` fields are only ever
 * populated on a storefront section's rows — how much Main Store itself
 * holds of this product, and how much of that has specifically been
 * earmarked for this storefront (but not yet physically distributed here).
 *
 * `valueCents`/`percentOfLocationValue` mean different things depending on
 * which kind of section the row belongs to: on the Main Store section, it's
 * this location's own stock value; on a storefront section, it's this
 * storefront's stock combined with Main Store's own stock of the same
 * product (the two locations relevant to that storefront's view), and the
 * percentage is relative to that section's own combined total — not the
 * section's headline "Stock Value" tile, which stays this location's own
 * physical stock only. */
export type LocationProductRow = {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  quantity: number;
  isLow: boolean;
  isOutOfStock: boolean;
  storefrontTotalQuantity: number | null;
  storefrontIsLow: boolean | null;
  storefrontIsOutOfStock: boolean | null;
  mainStoreQuantity: number | null;
  allocatedToThisStorefront: number | null;
  buyingPriceCents: number;
  valueCents: number;
  percentOfLocationValue: number;
};

/** Stock sitting at Main Store that's been earmarked for a storefront but not
 * yet physically moved there — a planning/bookkeeping concept, distinct from
 * (and can exist without) any actual `inventory` row at that storefront.
 * Only ever attached to the Main Store section. */
export type MainStoreAllocationInfo = {
  totalAllocated: number;
  totalUnallocated: number;
  byStorefront: { storefrontId: string; storefrontName: string; allocatedQuantity: number }[];
};

/** Everything about one location, self-contained — stats, the product table,
 * and its own stock movement history. This is the unit a branch-scoped
 * manager will eventually see exactly one of (their own storefront's),
 * once permission-scoped access lands: the backend already only returns the
 * sections the caller's branch scope allows. Every active location gets a
 * section, even one that's never physically received any stock yet (only
 * been allocated stock at Main Store without a matching distribution). */
export type LocationInventorySection = {
  locationId: string;
  locationName: string;
  isMainStore: boolean;
  productCount: number;
  totalUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  stockValueCents: number;
  products: LocationProductRow[];
  movements: StockMovementReportRow[];
  allocation: MainStoreAllocationInfo | null;
};

export type InventoryReportData = {
  overview: InventoryOverviewStats;
  categoryValueBreakdown: StockValueBreakdownEntry[];
  sections: LocationInventorySection[];
};

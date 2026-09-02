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

/** One product's ending balance as of a chosen past (or today's) date, one column per location —
 * pivoted this way (rather than one row per product+location) because every real tenant so far has
 * at most a handful of storefronts, so a wide row reads far easier than the same product repeated
 * once per branch. `quantityByLocation` always has an entry for every location in
 * StockAsOfDateData["locations"] (0 if this product never moved at that location), same "show every
 * location even at zero" convention as the live report's own per-location sections. Computed
 * backward from the current, known-correct `inventory` total minus every movement that happened
 * AFTER that date (see inventory-report-service.ts's getStockAsOfDateReport), never a stored
 * snapshot. Deliberately a much simpler shape than LocationProductRow: value/allocation-bucket
 * breakdowns don't have a clean historical meaning (Main Store allocation has no ledger of its own
 * past state), so this stays to what a date-based query can answer precisely — quantity. */
export type StockAsOfDateRow = {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  quantityByLocation: Record<string, number>;
  totalQuantity: number;
};

export type StockAsOfDateData = {
  /** Echoes back the requested date (YYYY-MM-DD) so the UI/export can label itself without holding
   * separate state. */
  asOfDate: string;
  /** Ordered column list — every active location in scope (just one if the caller filtered to a
   * single storefront), even one with zero stock of everything. */
  locations: { id: string; name: string }[];
  rows: StockAsOfDateRow[];
};

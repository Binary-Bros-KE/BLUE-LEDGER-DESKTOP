import { getDatabase } from "@main/database/connection";

/** One product's stock at one location, tenant/branch-scoped — the single
 * dataset every Inventory report section (Main Store and each storefront)
 * is derived from in the service layer. `inventory` is location-agnostic by
 * design, so a tenant that receives purchases straight into a storefront
 * (skipping Main Store entirely) looks identical here to one that routes
 * everything through it — no special-casing needed at this layer. */
export type CurrentStockRow = {
  product_id: string;
  product_name: string;
  sku: string;
  category_name: string | null;
  location_id: string;
  location_name: string;
  location_type: string;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  buying_price_cents: number;
  reorder_level: number;
};

export function findCurrentStockRows(tenantId: string, locationId: string | null): CurrentStockRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        i.product_id, p.name AS product_name, p.sku, c.name AS category_name,
        i.location_id, l.location_name, l.location_type,
        i.quantity, i.reserved_quantity, i.available_quantity,
        p.buying_price_cents, p.reorder_level
      FROM inventory i
      JOIN products p ON p.id = i.product_id
      JOIN locations l ON l.id = i.location_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE i.tenant_id = ? AND p.track_stock = 1 AND p.status = 'active' AND l.status = 'active'
        AND (? IS NULL OR i.location_id = ?)
      ORDER BY p.name, l.location_name
    `
    )
    .all(tenantId, locationId, locationId) as CurrentStockRow[];
}

export type LocationRow = { id: string; location_name: string; location_type: string };

/** Every active location in scope — including one that has never had a
 * single unit of stock physically moved into it yet. A storefront can exist
 * and have stock *allocated* to it at Main Store (a planning concept) long
 * before anything is actually distributed there, so sectioning by "which
 * locations appear in the stock rows" alone would silently hide it. */
export function findActiveLocations(tenantId: string, locationId: string | null): LocationRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT id, location_name, location_type
      FROM locations
      WHERE tenant_id = ? AND status = 'active' AND (? IS NULL OR id = ?)
      ORDER BY location_name
    `
    )
    .all(tenantId, locationId, locationId) as LocationRow[];
}

export type MainStoreAllocationByStorefrontRow = {
  storefront_id: string;
  storefront_name: string;
  allocated_quantity: number;
};

/** How much of Main Store's stock is earmarked for each storefront, summed
 * across every product — a bookkeeping figure that can be nonzero for a
 * storefront with zero physical inventory (allocated but not yet
 * distributed). */
export function findMainStoreAllocationsByStorefront(tenantId: string): MainStoreAllocationByStorefrontRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT msa.storefront_id, l.location_name AS storefront_name, SUM(msa.quantity) AS allocated_quantity
      FROM main_store_allocations msa
      JOIN locations l ON l.id = msa.storefront_id
      WHERE msa.tenant_id = ? AND msa.storefront_id IS NOT NULL
      GROUP BY msa.storefront_id, l.location_name
      HAVING SUM(msa.quantity) > 0
      ORDER BY allocated_quantity DESC
    `
    )
    .all(tenantId) as MainStoreAllocationByStorefrontRow[];
}

export type MainStoreAllocationByProductRow = {
  product_id: string;
  storefront_id: string;
  quantity: number;
};

/** Per-product allocation earmarked for each storefront — the same
 * bookkeeping ledger as findMainStoreAllocationsByStorefront, just not
 * pre-summed, so each storefront's product table can show "how much of
 * this specific item has Main Store set aside for me". */
export function findMainStoreAllocationsByProduct(tenantId: string): MainStoreAllocationByProductRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT product_id, storefront_id, quantity
      FROM main_store_allocations
      WHERE tenant_id = ? AND storefront_id IS NOT NULL AND quantity > 0
    `
    )
    .all(tenantId) as MainStoreAllocationByProductRow[];
}

/** Tenant-wide "Unallocated @ Main Store" total, summed across every product — the same
 * `trueUnallocatedQuantity` derivation main-store-service.ts uses per-product (ledger-true Main
 * Store quantity minus what's earmarked to NAMED storefronts, clamped at 0), just aggregated here
 * for the report's summary stat. Used to read `main_store_allocations`' own storefront_id IS NULL
 * row directly — that row is gone as of migration 77 (it was an independently-synced fact that
 * could silently drift from the ledger; see that migration's own comment for the live-confirmed
 * root cause). Deriving it here the same way the rest of the app now does means this stat can never
 * again disagree with what Main Store's own product detail or Products tab shows. */
export function findMainStoreUnallocatedQuantity(tenantId: string, mainStoreLocationId: string): number {
  const row = getDatabase()
    .prepare(
      `
      SELECT COALESCE(SUM(MAX(i.quantity - COALESCE(alloc.allocated, 0), 0)), 0) AS total
      FROM inventory i
      LEFT JOIN (
        SELECT product_id, SUM(quantity) AS allocated
        FROM main_store_allocations
        WHERE tenant_id = ? AND storefront_id IS NOT NULL
        GROUP BY product_id
      ) alloc ON alloc.product_id = i.product_id
      WHERE i.tenant_id = ? AND i.location_id = ?
    `
    )
    .get(tenantId, tenantId, mainStoreLocationId) as { total: number };
  return row.total;
}

export type StockMovementReportRowRaw = {
  id: string;
  product_name: string;
  sku: string;
  location_name: string;
  movement_type: string;
  quantity_change: number;
  buying_price_cents: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
  performed_by_name: string | null;
};

/** Pass null for locationId to see every branch's movements. */
export function findStockMovementReportRows(tenantId: string, locationId: string | null, limit: number): StockMovementReportRowRaw[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        sm.id, p.name AS product_name, p.sku, l.location_name,
        sm.movement_type, sm.quantity_change, p.buying_price_cents,
        sm.reference_type, sm.reference_id, sm.notes, sm.created_at,
        (e.first_name || ' ' || e.last_name) AS performed_by_name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      JOIN locations l ON l.id = sm.location_id
      LEFT JOIN employees e ON e.id = sm.performed_by
      WHERE sm.tenant_id = ? AND (? IS NULL OR sm.location_id = ?)
      ORDER BY sm.created_at DESC
      LIMIT ?
    `
    )
    .all(tenantId, locationId, locationId, limit) as StockMovementReportRowRaw[];
}

import { getDatabase } from "@main/database/connection";
import type { StockMovementInput } from "@shared/schemas/stock-movement";
import type {
  StockMovement,
  StockMovementFeedItem,
  StockMovementSyncStatus,
  StockMovementType,
  StockMovementWithUnitPrice
} from "@shared/types/stock-movement";

export type StockMovementRow = {
  id: string;
  tenant_id: string;
  product_id: string;
  location_id: string;
  movement_type: string;
  quantity_change: number;
  reference_type: string | null;
  reference_id: string | null;
  performed_by: string | null;
  notes: string | null;
  // Which Main Store allocation bucket (if any) this movement affected, and whether the caller
  // targeted it explicitly — see migrate.ts v39's own comment on why both are needed to correctly
  // replay the allocation side-effect on a second device. NULL bucket id + explicit=1 means the
  // unallocated bucket was targeted precisely; explicit=0 means no bucket was ever specified (the
  // fallback path in applyValidatedStockMovement).
  allocation_storefront_id: string | null;
  allocation_explicit: number;
  // See StockMovement["previousQuantity"]'s own doc comment (shared/types/stock-movement.ts) — this
  // location's actual on-hand quantity immediately before/after this specific movement, frozen at
  // write time. Null for a movement recorded before this existed.
  previous_quantity: number | null;
  new_quantity: number | null;
  created_at: string;
  sync_status: string;
  last_synced_at: string | null;
};

export type StockMovementListRow = StockMovementRow & {
  location_name: string;
  performed_by_name: string | null;
};

/** A resolved location filter for the movement feed — see inventory-service.ts's
 * resolveMovementLocationFilter. null means "every location." */
export type MovementLocationFilter = { locationId: string; mainStoreLocationId: string | null } | null;

/** Client correction: filtering to a storefront must show that storefront's own movements PLUS ONLY
 * the Main Store movements that actually involve it — never every Main Store movement (a purchase
 * receipt for a different branch, a distribution to someone else, etc). A Main Store row "involves"
 * this storefront one of two ways: it's directly tagged (allocation_storefront_id — set on a receipt/
 * damage/adjustment against this storefront's own allocation bucket), or it shares reference_id with
 * a row actually located at this storefront (the other leg of the same distribute/return transfer —
 * both legs of one transfer share one reference_id, see main-store-service.ts's
 * distributeMainStoreStockCore/returnToMainStore). When the filtered location IS Main Store itself
 * (or the tenant has none), this collapses to a plain equality — nothing extra to correlate.
 *
 * CRITICAL PERFORMANCE NOTE: this used to check the reference_id match via a CORRELATED EXISTS
 * subquery (re-run once per outer row). No index leads with reference_id alone (the only one on it
 * is (reference_type, reference_id), unusable for a reference_id-only lookup), so that subquery fell
 * back to a full linear scan of the table EVERY time — O(n²) overall. Confirmed live against a real
 * tenant's 22,100-row stock_movements table: the query never completed in over 10 minutes and froze
 * the whole app (the main process's better-sqlite3 calls are synchronous, blocking every IPC call
 * too). Fixed by precomputing this storefront's own reference_ids ONCE via a CTE — SQLite materializes
 * it a single time and builds a bloom filter for the `IN` check, turning the whole query into two
 * linear passes instead of n². Confirmed against the same real 22,100-row dataset: 176ms, down from
 * "never finishes." Returns an optional `cte` string the caller must prepend to its own SQL (via
 * `WITH ...`) — empty when there's nothing to precompute. */
/** cteParams bind to placeholders inside `cte` (which the caller must prepend at the very top of its
 * SQL, before SELECT — a `WITH` clause can't go anywhere else); sqlParams bind to placeholders inside
 * `sql` (spliced into the caller's own WHERE). Kept separate deliberately — a single merged params
 * array is exactly how a caller would silently mis-bind params once other placeholders (like
 * `product_id = ?`) sit textually between the CTE and the WHERE fragment. */
function movementLocationClause(filter: MovementLocationFilter): {
  cte: string;
  cteParams: string[];
  sql: string;
  sqlParams: string[];
} {
  if (!filter) return { cte: "", cteParams: [], sql: "1 = 1", sqlParams: [] };
  if (!filter.mainStoreLocationId || filter.mainStoreLocationId === filter.locationId) {
    return { cte: "", cteParams: [], sql: "sm.location_id = ?", sqlParams: [filter.locationId] };
  }
  return {
    // location_id alone is enough to scope this correctly (a location never spans tenants) — no
    // tenant_id needed, so this same clause works for both findAllStockMovementRows (tenant-scoped)
    // and findStockMovementRowsForProduct (product-scoped, no tenantId in hand).
    cte: `WITH storefront_refs(rid) AS (
      SELECT DISTINCT reference_id FROM stock_movements WHERE location_id = ? AND reference_id IS NOT NULL
    )`,
    cteParams: [filter.locationId],
    sql: `(
      sm.location_id = ?
      OR (
        sm.location_id = ?
        AND (
          sm.allocation_storefront_id = ?
          OR sm.reference_id IN (SELECT rid FROM storefront_refs)
        )
      )
    )`,
    sqlParams: [filter.locationId, filter.mainStoreLocationId, filter.locationId]
  };
}

export function findStockMovementRowById(id: string): StockMovementListRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT sm.*, l.location_name AS location_name, (e.first_name || ' ' || e.last_name) AS performed_by_name
      FROM stock_movements sm
      JOIN locations l ON l.id = sm.location_id
      LEFT JOIN employees e ON e.id = sm.performed_by
      WHERE sm.id = ?
    `
    )
    .get(id) as StockMovementListRow | undefined;
}

export function insertStockMovementRow(
  input: StockMovementInput & {
    id: string;
    tenantId: string;
    allocationStorefrontId?: string | null;
    /** See StockMovementRow["previous_quantity"]'s own doc comment — the caller (applyValidatedStockMovement)
     * is the only place with the context to compute these, so this function just stores what it's given. */
    previousQuantity: number | null;
    newQuantity: number | null;
  }
): StockMovementListRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO stock_movements (
        id, tenant_id, product_id, location_id, movement_type, quantity_change,
        reference_type, reference_id, performed_by, notes, allocation_storefront_id, allocation_explicit,
        previous_quantity, new_quantity, created_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.productId,
      input.locationId,
      input.movementType,
      input.quantityChange,
      input.referenceType,
      input.referenceId,
      input.performedBy,
      input.notes,
      input.allocationStorefrontId ?? null,
      input.allocationStorefrontId !== undefined ? 1 : 0,
      input.previousQuantity,
      input.newQuantity,
      now
    );

  const row = findStockMovementRowById(input.id);
  if (!row) {
    throw new Error("Failed to record stock movement");
  }
  return row;
}

/** Row shape for a single product's own movement history (Main Store's ProductHistoryModal and
 * Products tab's ProductDetailModal) — same selling-price/frozen-sale-price pair as
 * StockMovementFeedRow above, just scoped to one already-known product instead of the whole tenant
 * feed. See mapStockMovementProductRow's own doc comment for how the two combine into unitPriceCents. */
export type StockMovementProductRow = StockMovementListRow & {
  selling_price_cents: number;
  sale_unit_price_cents: number | null;
};

/** Pass null for both date bounds to skip date filtering entirely (the default "recent" view) — same
 * `created_at >= ? AND created_at < ?` convention as findAllStockMovementRows/report-repository.ts's
 * own date-range queries; the caller converts a plain calendar date into the device-local-timezone-
 * correct ISO bound (inventory-service.ts's startOfDayIso/addDaysIso). Pass null for locationFilter to
 * see every location (default); see movementLocationClause for the storefront-plus-Main-Store rule. */
export function findStockMovementRowsForProduct(
  productId: string,
  limit: number,
  startDateIso: string | null,
  endDateIsoExclusive: string | null,
  locationFilter: MovementLocationFilter = null
): StockMovementProductRow[] {
  const location = movementLocationClause(locationFilter);
  return getDatabase()
    .prepare(
      `
      ${location.cte}
      SELECT sm.*, l.location_name AS location_name, p.selling_price_cents AS selling_price_cents,
        si.unit_price_cents AS sale_unit_price_cents,
        (e.first_name || ' ' || e.last_name) AS performed_by_name
      FROM stock_movements sm
      JOIN locations l ON l.id = sm.location_id
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN employees e ON e.id = sm.performed_by
      -- See findAllStockMovementRows' own comment on this exact join — 'sale'/'invoice' both point at
      -- the same sales/sale_items rows, just from before/after an older refactor unified the label.
      LEFT JOIN sale_items si
        ON sm.movement_type = 'sale' AND sm.reference_type IN ('sale', 'invoice')
        AND si.sale_id = sm.reference_id AND si.product_id = sm.product_id
      WHERE sm.product_id = ?
        AND ${location.sql}
        AND (? IS NULL OR sm.created_at >= ?)
        AND (? IS NULL OR sm.created_at < ?)
      ORDER BY sm.created_at DESC
      LIMIT ?
    `
    )
    .all(
      ...location.cteParams,
      productId,
      ...location.sqlParams,
      startDateIso,
      startDateIso,
      endDateIsoExclusive,
      endDateIsoExclusive,
      limit
    ) as StockMovementProductRow[];
}

export type StockMovementFeedRow = StockMovementListRow & {
  product_name: string;
  sku: string;
  buying_price_cents: number;
  selling_price_cents: number;
  // Client request: for a "sale" movement, the unit price column should show what the product
  // ACTUALLY sold at — which can differ from the product's own current selling_price_cents via a
  // cashier's price-override at Checkout/Invoices (see cart-pricing.ts/sale-service.ts's own
  // priceOverrideCents) — never the product's live price, which could since have changed anyway.
  // Null whenever this movement isn't a sale line (every other movement type falls back to
  // selling_price_cents in mapStockMovementFeedRow below).
  sale_unit_price_cents: number | null;
};

/** Pass null for locationFilter to see every branch's movements (e.g. a super-admin with no assigned
 * branch, or an audit view). Powers the global Stock Ledger feed — see movementLocationClause for the
 * storefront-plus-Main-Store rule. startDateIso/endDateIsoExclusive (pass both null to skip date
 * filtering entirely) mirror report-repository.ts's own `created_at >= ? AND created_at < ?`
 * convention — the caller is responsible for converting a plain calendar date into the device-local-
 * timezone-correct ISO bound (see inventory-service.ts's startOfDayIso/addDaysIso, ported from
 * report-service.ts). */
export function findAllStockMovementRows(
  tenantId: string,
  locationFilter: MovementLocationFilter,
  limit: number,
  startDateIso: string | null,
  endDateIsoExclusive: string | null
): StockMovementFeedRow[] {
  const location = movementLocationClause(locationFilter);
  return getDatabase()
    .prepare(
      `
      ${location.cte}
      SELECT sm.*, l.location_name AS location_name, p.name AS product_name, p.sku AS sku,
        p.buying_price_cents AS buying_price_cents, p.selling_price_cents AS selling_price_cents,
        si.unit_price_cents AS sale_unit_price_cents,
        (e.first_name || ' ' || e.last_name) AS performed_by_name
      FROM stock_movements sm
      JOIN locations l ON l.id = sm.location_id
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN employees e ON e.id = sm.performed_by
      -- The exact sale line this movement came from, when it is one — see StockMovementFeedRow's
      -- own doc comment on sale_unit_price_cents for why this beats the product's live price.
      -- reference_type is 'sale' for every movement going forward, but a real batch of historical
      -- ones (from before an older refactor unified this) still carry 'invoice' — an invoice is a
      -- sale row like any other (just with invoiceNumber set), never a separate table, so both
      -- values point at the exact same sales/sale_items rows and need covering here.
      LEFT JOIN sale_items si
        ON sm.movement_type = 'sale' AND sm.reference_type IN ('sale', 'invoice')
        AND si.sale_id = sm.reference_id AND si.product_id = sm.product_id
      WHERE sm.tenant_id = ?
        AND ${location.sql}
        AND (? IS NULL OR sm.created_at >= ?)
        AND (? IS NULL OR sm.created_at < ?)
      ORDER BY sm.created_at DESC
      LIMIT ?
    `
    )
    .all(
      ...location.cteParams,
      tenantId,
      ...location.sqlParams,
      startDateIso,
      startDateIso,
      endDateIsoExclusive,
      endDateIsoExclusive,
      limit
    ) as StockMovementFeedRow[];
}

export function mapStockMovementRow(row: StockMovementListRow): StockMovement {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    locationId: row.location_id,
    locationName: row.location_name,
    movementType: row.movement_type as StockMovementType,
    quantityChange: row.quantity_change,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    performedBy: row.performed_by,
    performedByName: row.performed_by_name,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    notes: row.notes,
    createdAt: row.created_at,
    syncStatus: row.sync_status as StockMovementSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

/** Client request: same "Unit Price" logic as mapStockMovementFeedRow below, for the single-product
 * history views (Main Store's ProductHistoryModal, Products tab's ProductDetailModal) — the product's
 * own current selling price by default, or the price a "sale" line actually sold at when it differs. */
export function mapStockMovementProductRow(row: StockMovementProductRow): StockMovementWithUnitPrice {
  return {
    ...mapStockMovementRow(row),
    unitPriceCents: row.sale_unit_price_cents ?? row.selling_price_cents
  };
}

/** The value moved (quantity x the product's current SELLING price) — a simple, live snapshot rather
 * than a price frozen at the time of the movement. Powers the Stock In/Out Value stat tiles; client
 * request: matches the same selling-price basis as unitPriceCents below and the new Opening/Closing
 * Stock Value cards (StockLedgerRoute.tsx), not the buying/cost price this used before. */
export function mapStockMovementFeedRow(row: StockMovementFeedRow): StockMovementFeedItem {
  return {
    ...mapStockMovementRow(row),
    productName: row.product_name,
    sku: row.sku,
    valueCents: Math.abs(row.quantity_change) * row.selling_price_cents,
    // Client request: the product's own selling price by default — but for a sale, the price it
    // ACTUALLY sold at (frozen on the sale line, honors any cashier price-override), never the
    // product's live selling price which could have changed since.
    unitPriceCents: row.sale_unit_price_cents ?? row.selling_price_cents
  };
}

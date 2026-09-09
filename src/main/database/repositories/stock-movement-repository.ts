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
 * correct ISO bound (inventory-service.ts's startOfDayIso/addDaysIso). */
export function findStockMovementRowsForProduct(
  productId: string,
  limit: number,
  startDateIso: string | null,
  endDateIsoExclusive: string | null
): StockMovementProductRow[] {
  return getDatabase()
    .prepare(
      `
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
        AND (? IS NULL OR sm.created_at >= ?)
        AND (? IS NULL OR sm.created_at < ?)
      ORDER BY sm.created_at DESC
      LIMIT ?
    `
    )
    .all(productId, startDateIso, startDateIso, endDateIsoExclusive, endDateIsoExclusive, limit) as StockMovementProductRow[];
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

/** Pass null for locationId to see every branch's movements (e.g. a super-admin with no assigned
 * branch, or an audit view). Powers the global Stock Ledger feed. startDateIso/endDateIsoExclusive
 * (pass both null to skip date filtering entirely) mirror report-repository.ts's own
 * `created_at >= ? AND created_at < ?` convention — the caller is responsible for converting a plain
 * calendar date into the device-local-timezone-correct ISO bound (see inventory-service.ts's
 * startOfDayIso/addDaysIso, ported from report-service.ts). */
export function findAllStockMovementRows(
  tenantId: string,
  locationId: string | null,
  limit: number,
  startDateIso: string | null,
  endDateIsoExclusive: string | null
): StockMovementFeedRow[] {
  return getDatabase()
    .prepare(
      `
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
        AND (? IS NULL OR sm.location_id = ?)
        AND (? IS NULL OR sm.created_at >= ?)
        AND (? IS NULL OR sm.created_at < ?)
      ORDER BY sm.created_at DESC
      LIMIT ?
    `
    )
    .all(
      tenantId,
      locationId,
      locationId,
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

/** The cost value moved (quantity x the product's current buying price) — a simple, live snapshot
 * rather than a price frozen at the time of the movement. Powers the Stock In/Out Value stat tiles;
 * unrelated to unitPriceCents below (a per-unit SELLING price, not a total cost). */
export function mapStockMovementFeedRow(row: StockMovementFeedRow): StockMovementFeedItem {
  return {
    ...mapStockMovementRow(row),
    productName: row.product_name,
    sku: row.sku,
    valueCents: Math.abs(row.quantity_change) * row.buying_price_cents,
    // Client request: the product's own selling price by default — but for a sale, the price it
    // ACTUALLY sold at (frozen on the sale line, honors any cashier price-override), never the
    // product's live selling price which could have changed since.
    unitPriceCents: row.sale_unit_price_cents ?? row.selling_price_cents
  };
}

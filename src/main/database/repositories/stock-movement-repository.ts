import { getDatabase } from "@main/database/connection";
import type { StockMovementInput } from "@shared/schemas/stock-movement";
import type {
  StockMovement,
  StockMovementFeedItem,
  StockMovementSyncStatus,
  StockMovementType
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
  created_at: string;
  sync_status: string;
  last_synced_at: string | null;
};

export type StockMovementListRow = StockMovementRow & {
  location_name: string;
};

export function findStockMovementRowById(id: string): StockMovementListRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT sm.*, l.location_name AS location_name
      FROM stock_movements sm
      JOIN locations l ON l.id = sm.location_id
      WHERE sm.id = ?
    `
    )
    .get(id) as StockMovementListRow | undefined;
}

export function insertStockMovementRow(
  input: StockMovementInput & { id: string; tenantId: string }
): StockMovementListRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO stock_movements (
        id, tenant_id, product_id, location_id, movement_type, quantity_change,
        reference_type, reference_id, performed_by, notes, created_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
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
      now
    );

  const row = findStockMovementRowById(input.id);
  if (!row) {
    throw new Error("Failed to record stock movement");
  }
  return row;
}

export function findStockMovementRowsForProduct(productId: string, limit = 100): StockMovementListRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT sm.*, l.location_name AS location_name
      FROM stock_movements sm
      JOIN locations l ON l.id = sm.location_id
      WHERE sm.product_id = ?
      ORDER BY sm.created_at DESC
      LIMIT ?
    `
    )
    .all(productId, limit) as StockMovementListRow[];
}

export type StockMovementFeedRow = StockMovementListRow & {
  product_name: string;
  sku: string;
  buying_price_cents: number;
};

/** Pass null for locationId to see every branch's movements (e.g. a super-admin with no assigned
 * branch, or an audit view). Powers the global Stock Ledger feed. */
export function findAllStockMovementRows(
  tenantId: string,
  locationId: string | null,
  limit: number
): StockMovementFeedRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT sm.*, l.location_name AS location_name, p.name AS product_name, p.sku AS sku, p.buying_price_cents AS buying_price_cents
      FROM stock_movements sm
      JOIN locations l ON l.id = sm.location_id
      JOIN products p ON p.id = sm.product_id
      WHERE sm.tenant_id = ?
        AND (? IS NULL OR sm.location_id = ?)
      ORDER BY sm.created_at DESC
      LIMIT ?
    `
    )
    .all(tenantId, locationId, locationId, limit) as StockMovementFeedRow[];
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
    notes: row.notes,
    createdAt: row.created_at,
    syncStatus: row.sync_status as StockMovementSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

/** The cost value moved (quantity x the product's current buying price) — a simple, live snapshot
 * rather than a price frozen at the time of the movement. */
export function mapStockMovementFeedRow(row: StockMovementFeedRow): StockMovementFeedItem {
  return {
    ...mapStockMovementRow(row),
    productName: row.product_name,
    sku: row.sku,
    valueCents: Math.abs(row.quantity_change) * row.buying_price_cents
  };
}

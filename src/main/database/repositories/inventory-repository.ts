import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";
import type { InventoryBalance } from "@shared/types/inventory";

export type InventoryRow = {
  id: string;
  tenant_id: string;
  product_id: string;
  location_id: string;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
};

export type InventoryOverviewRow = {
  location_id: string;
  location_name: string;
  location_code: string;
  id: string | null;
  quantity: number | null;
  reserved_quantity: number | null;
  available_quantity: number | null;
  updated_at: string | null;
  sync_status: string | null;
  last_synced_at: string | null;
};

export function findInventoryRow(productId: string, locationId: string): InventoryRow | undefined {
  return getDatabase()
    .prepare("SELECT * FROM inventory WHERE product_id = ? AND location_id = ?")
    .get(productId, locationId) as InventoryRow | undefined;
}

/** Every stocked product's balance at a single location — the POS screen's "available stock" source. */
export function findInventoryRowsForLocation(locationId: string): InventoryRow[] {
  return getDatabase()
    .prepare("SELECT * FROM inventory WHERE location_id = ?")
    .all(locationId) as InventoryRow[];
}

/** Every product's on-hand quantity at every storefront (never Main Store) for the tenant, in one
 * query — powers the Main Store list's embedded per-storefront breakdown without a call per row. */
export function findAllInventoryRowsForStorefronts(tenantId: string): InventoryRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT i.*
      FROM inventory i
      JOIN locations l ON l.id = i.location_id
      WHERE l.tenant_id = ?
        AND l.location_type NOT IN ('warehouse', 'distribution_center')
    `
    )
    .all(tenantId) as InventoryRow[];
}

/** All tenant locations left-joined with this product's inventory rows — missing rows read as zero stock. */
export function findInventoryOverviewForProduct(
  tenantId: string,
  productId: string
): InventoryOverviewRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        l.id AS location_id,
        l.location_name,
        l.location_code,
        i.id AS id,
        i.quantity AS quantity,
        i.reserved_quantity AS reserved_quantity,
        i.available_quantity AS available_quantity,
        i.updated_at AS updated_at,
        i.sync_status AS sync_status,
        i.last_synced_at AS last_synced_at
      FROM locations l
      LEFT JOIN inventory i ON i.location_id = l.id AND i.product_id = ?
      WHERE l.tenant_id = ?
      ORDER BY l.location_name ASC
    `
    )
    .all(productId, tenantId) as InventoryOverviewRow[];
}

/** Inserts a fresh inventory row, or updates the quantity of an existing one. */
export function upsertInventoryQuantity(input: {
  tenantId: string;
  productId: string;
  locationId: string;
  quantity: number;
}): InventoryRow {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = findInventoryRow(input.productId, input.locationId);

  if (existing) {
    db.prepare(
      "UPDATE inventory SET quantity = ?, sync_status = 'pending', updated_at = ? WHERE id = ?"
    ).run(input.quantity, now, existing.id);
  } else {
    db.prepare(
      `
        INSERT INTO inventory (id, tenant_id, product_id, location_id, quantity, reserved_quantity, updated_at, sync_status)
        VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')
      `
    ).run(
      `inventory_${randomUUID()}`,
      input.tenantId,
      input.productId,
      input.locationId,
      input.quantity,
      now
    );
  }

  const row = findInventoryRow(input.productId, input.locationId);
  if (!row) {
    throw new Error("Failed to persist inventory balance");
  }
  return row;
}

export function mapInventoryOverviewRow(
  row: InventoryOverviewRow,
  tenantId: string,
  productId: string
): InventoryBalance {
  return {
    id: row.id,
    tenantId,
    productId,
    locationId: row.location_id,
    locationName: row.location_name,
    locationCode: row.location_code,
    quantity: row.quantity ?? 0,
    reservedQuantity: row.reserved_quantity ?? 0,
    availableQuantity: row.available_quantity ?? 0,
    updatedAt: row.updated_at,
    syncStatus: (row.sync_status as InventoryBalance["syncStatus"]) ?? null,
    lastSyncedAt: row.last_synced_at
  };
}

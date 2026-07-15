import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";
import type { MainStoreAllocation } from "@shared/types/main-store";

export type MainStoreAllocationRow = {
  id: string;
  tenant_id: string;
  product_id: string;
  storefront_id: string | null;
  quantity: number;
  created_at: string;
  updated_at: string;
};

export function findAllocationRow(productId: string, storefrontId: string | null): MainStoreAllocationRow | undefined {
  const db = getDatabase();
  if (storefrontId === null) {
    return db
      .prepare("SELECT * FROM main_store_allocations WHERE product_id = ? AND storefront_id IS NULL")
      .get(productId) as MainStoreAllocationRow | undefined;
  }
  return db
    .prepare("SELECT * FROM main_store_allocations WHERE product_id = ? AND storefront_id = ?")
    .get(productId, storefrontId) as MainStoreAllocationRow | undefined;
}

/** Every bucket (including "unallocated") recorded so far for one product. Missing buckets read as zero. */
export function findAllocationRowsForProduct(productId: string): MainStoreAllocationRow[] {
  return getDatabase()
    .prepare("SELECT * FROM main_store_allocations WHERE product_id = ?")
    .all(productId) as MainStoreAllocationRow[];
}

/** Every allocation row for the tenant at once — powers the Main Store list's per-row columns
 * without a query per product. */
export function findAllAllocationRows(tenantId: string): MainStoreAllocationRow[] {
  return getDatabase()
    .prepare("SELECT * FROM main_store_allocations WHERE tenant_id = ?")
    .all(tenantId) as MainStoreAllocationRow[];
}

function insertAllocationRow(input: {
  tenantId: string;
  productId: string;
  storefrontId: string | null;
  quantity: number;
}): MainStoreAllocationRow {
  const now = new Date().toISOString();
  const id = `main_store_allocation_${randomUUID()}`;
  getDatabase()
    .prepare(
      `
      INSERT INTO main_store_allocations (id, tenant_id, product_id, storefront_id, quantity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(id, input.tenantId, input.productId, input.storefrontId, input.quantity, now, now);

  const row = findAllocationRow(input.productId, input.storefrontId);
  if (!row) {
    throw new Error("Failed to create Main Store allocation record");
  }
  return row;
}

/** Sets a bucket's quantity to an absolute value, creating the row if it doesn't exist yet. */
export function setAllocationQuantity(input: {
  tenantId: string;
  productId: string;
  storefrontId: string | null;
  quantity: number;
}): MainStoreAllocationRow {
  const existing = findAllocationRow(input.productId, input.storefrontId);
  if (!existing) {
    return insertAllocationRow(input);
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE main_store_allocations SET quantity = ?, updated_at = ? WHERE id = ?")
    .run(input.quantity, now, existing.id);

  const row = findAllocationRow(input.productId, input.storefrontId);
  if (!row) {
    throw new Error("Main Store allocation record not found after update");
  }
  return row;
}

/**
 * Adds (or subtracts, for a negative delta) a bucket's quantity. Throws if that would take the
 * bucket below zero — callers that want a lenient, clamped-at-zero adjustment should read the
 * current quantity themselves and call setAllocationQuantity with the clamped value instead.
 */
export function adjustAllocationQuantity(input: {
  tenantId: string;
  productId: string;
  storefrontId: string | null;
  delta: number;
}): MainStoreAllocationRow {
  const existing = findAllocationRow(input.productId, input.storefrontId);
  const currentQuantity = existing?.quantity ?? 0;
  const nextQuantity = currentQuantity + input.delta;

  if (nextQuantity < 0) {
    throw new Error("That bucket doesn't have enough allocated stock for this change");
  }

  return setAllocationQuantity({
    tenantId: input.tenantId,
    productId: input.productId,
    storefrontId: input.storefrontId,
    quantity: nextQuantity
  });
}

export function mapAllocationRow(row: MainStoreAllocationRow): MainStoreAllocation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    storefrontId: row.storefront_id,
    quantity: row.quantity,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

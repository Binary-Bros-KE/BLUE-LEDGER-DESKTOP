import { getDatabase } from "@main/database/connection";
import type { ProductCreateInput, ProductUpdateInput } from "@shared/schemas/product";
import type { Product, ProductListItem, ProductStatus, ProductSyncStatus } from "@shared/types/product";

export type ProductRow = {
  id: string;
  tenant_id: string;
  sku: string;
  barcode: string | null;
  supplier_sku: string | null;
  name: string;
  short_name: string | null;
  description: string | null;
  category_id: string | null;
  buying_price_cents: number;
  selling_price_cents: number;
  wholesale_price_cents: number | null;
  wholesale_min_quantity: number;
  minimum_price_cents: number | null;
  tax_rate: number;
  reorder_level: number;
  track_stock: number;
  allow_negative_stock: number;
  image_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sync_status: string;
  last_synced_at: string | null;
};

export type ProductListRow = ProductRow & {
  category_name: string | null;
  total_stock: number;
};

export function findAllProductRows(tenantId: string): ProductListRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT p.*, c.name AS category_name, COALESCE(SUM(i.quantity), 0) AS total_stock
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.tenant_id = ?
      GROUP BY p.id
      ORDER BY p.name ASC
    `
    )
    .all(tenantId) as ProductListRow[];
}

export function findProductRowById(id: string): ProductRow | undefined {
  return getDatabase().prepare("SELECT * FROM products WHERE id = ?").get(id) as
    | ProductRow
    | undefined;
}

export function findProductByNameRow(
  tenantId: string,
  name: string,
  excludeId?: string
): ProductRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, name, excludeId] : [tenantId, name];
  return getDatabase()
    .prepare(`SELECT * FROM products WHERE tenant_id = ? AND lower(name) = lower(?) ${excludeClause}`)
    .get(...params) as ProductRow | undefined;
}

export function findProductBySkuRow(
  tenantId: string,
  sku: string,
  excludeId?: string
): ProductRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, sku, excludeId] : [tenantId, sku];
  return getDatabase()
    .prepare(`SELECT * FROM products WHERE tenant_id = ? AND lower(sku) = lower(?) ${excludeClause}`)
    .get(...params) as ProductRow | undefined;
}

export function findProductByBarcodeRow(
  tenantId: string,
  barcode: string,
  excludeId?: string
): ProductRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, barcode, excludeId] : [tenantId, barcode];
  return getDatabase()
    .prepare(`SELECT * FROM products WHERE tenant_id = ? AND barcode = ? ${excludeClause}`)
    .get(...params) as ProductRow | undefined;
}

export function insertProductRow(
  input: ProductCreateInput & { id: string; tenantId: string; createdBy: string | null }
): ProductRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO products (
        id, tenant_id, sku, barcode, supplier_sku, name, short_name, description,
        category_id, buying_price_cents, selling_price_cents, wholesale_price_cents,
        wholesale_min_quantity, minimum_price_cents, tax_rate, reorder_level, track_stock,
        allow_negative_stock, image_path, status, created_at, updated_at, created_by, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.sku,
      input.barcode,
      input.supplierSku,
      input.name,
      input.shortName,
      input.description,
      input.categoryId,
      input.buyingPriceCents,
      input.sellingPriceCents,
      input.wholesalePriceCents,
      input.wholesaleMinQuantity,
      input.minimumPriceCents,
      input.taxRate,
      input.reorderLevel,
      input.trackStock ? 1 : 0,
      input.allowNegativeStock ? 1 : 0,
      input.imagePath,
      now,
      now,
      input.createdBy
    );

  const row = findProductRowById(input.id);
  if (!row) {
    throw new Error("Failed to create product record");
  }
  return row;
}

export function updateProductRow(
  id: string,
  input: ProductUpdateInput & { updatedBy: string | null }
): ProductRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE products SET
        sku = ?,
        barcode = ?,
        supplier_sku = ?,
        name = ?,
        short_name = ?,
        description = ?,
        category_id = ?,
        buying_price_cents = ?,
        selling_price_cents = ?,
        wholesale_price_cents = ?,
        wholesale_min_quantity = ?,
        minimum_price_cents = ?,
        tax_rate = ?,
        reorder_level = ?,
        track_stock = ?,
        allow_negative_stock = ?,
        image_path = ?,
        updated_by = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.sku,
      input.barcode,
      input.supplierSku,
      input.name,
      input.shortName,
      input.description,
      input.categoryId,
      input.buyingPriceCents,
      input.sellingPriceCents,
      input.wholesalePriceCents,
      input.wholesaleMinQuantity,
      input.minimumPriceCents,
      input.taxRate,
      input.reorderLevel,
      input.trackStock ? 1 : 0,
      input.allowNegativeStock ? 1 : 0,
      input.imagePath,
      input.updatedBy,
      now,
      id
    );

  const row = findProductRowById(id);
  if (!row) {
    throw new Error("Product not found after update");
  }
  return row;
}

export function setProductStatusRow(id: string, status: ProductStatus): ProductRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE products SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findProductRowById(id);
  if (!row) {
    throw new Error("Product not found after status update");
  }
  return row;
}

export function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    sku: row.sku,
    barcode: row.barcode,
    supplierSku: row.supplier_sku,
    name: row.name,
    shortName: row.short_name,
    description: row.description,
    categoryId: row.category_id,
    buyingPriceCents: row.buying_price_cents,
    sellingPriceCents: row.selling_price_cents,
    wholesalePriceCents: row.wholesale_price_cents,
    wholesaleMinQuantity: row.wholesale_min_quantity,
    minimumPriceCents: row.minimum_price_cents,
    taxRate: row.tax_rate,
    reorderLevel: row.reorder_level,
    trackStock: Boolean(row.track_stock),
    allowNegativeStock: Boolean(row.allow_negative_stock),
    imagePath: row.image_path,
    status: row.status as ProductStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    syncStatus: row.sync_status as ProductSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

export function mapProductListRow(row: ProductListRow): ProductListItem {
  return {
    ...mapProductRow(row),
    categoryName: row.category_name,
    totalStock: row.total_stock
  };
}

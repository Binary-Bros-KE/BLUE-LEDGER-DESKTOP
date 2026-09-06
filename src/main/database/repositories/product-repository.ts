import { getDatabase } from "@main/database/connection";
import type { ProductCreateInput, ProductUpdateInput } from "@shared/schemas/product";
import type {
  OnlineContentBlock,
  OnlineImageRef,
  Product,
  ProductListItem,
  ProductOnlineContent,
  ProductStatus,
  ProductSyncStatus
} from "@shared/types/product";

/** online_image_urls is stored as a JSON TEXT column — tolerate anything that isn't a clean array
 * of {url, thumbUrl} (a hand-edited row, an older write) by falling back to empty rather than
 * throwing on a read that half the app depends on. */
function parseOnlineImageUrls(raw: string | null): OnlineImageRef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is OnlineImageRef => Boolean(e) && typeof e.url === "string")
      .map((e) => ({ url: e.url, thumbUrl: typeof e.thumbUrl === "string" ? e.thumbUrl : e.url }));
  } catch {
    return [];
  }
}

/** online_category_ids is a JSON TEXT string array — same defensive parse. */
function parseIdArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
  } catch {
    return [];
  }
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")).filter((x) => x.length > 0) : [];
}

/** online_content_json — { quickSpecs, blocks }. Defensive: any malformed shape reads as empty. */
function parseOnlineContent(raw: string | null): ProductOnlineContent {
  const empty: ProductOnlineContent = { quickSpecs: [], blocks: [] };
  if (!raw) return empty;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return empty;
    const blocks: OnlineContentBlock[] = (Array.isArray(o.blocks) ? o.blocks : [])
      .map((b: unknown): OnlineContentBlock => {
        const bb = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
        const type = bb.type === "specs" || bb.type === "notes" ? bb.type : "paragraph";
        return {
          type,
          heading: typeof bb.heading === "string" ? bb.heading : undefined,
          body: typeof bb.body === "string" ? bb.body : undefined,
          items: strList(bb.items)
        };
      })
      .slice(0, 12);
    return { quickSpecs: strList(o.quickSpecs).slice(0, 20), blocks };
  } catch {
    return empty;
  }
}

function serializeOnlineContent(c: ProductOnlineContent): string {
  return JSON.stringify({
    quickSpecs: strList(c.quickSpecs).slice(0, 20),
    blocks: (c.blocks ?? []).slice(0, 12).map((b) => ({
      type: b.type === "specs" || b.type === "notes" ? b.type : "paragraph",
      ...(b.heading?.trim() ? { heading: b.heading.trim() } : {}),
      ...(b.body?.trim() ? { body: b.body.trim() } : {}),
      ...(b.type === "specs" ? { items: strList(b.items) } : {})
    }))
  });
}

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
  storefront_id: string | null;
  unit_of_measure: string | null;
  buying_price_cents: number;
  selling_price_cents: number;
  wholesale_price_cents: number | null;
  wholesale_min_quantity: number;
  minimum_price_cents: number | null;
  tax_rate: number;
  tax_type: string;
  /** Null means "inherit the tenant default" — see Product["pricesTaxInclusive"]'s own doc comment. */
  prices_tax_inclusive: number | null;
  reorder_level: number;
  track_stock: number;
  allow_negative_stock: number;
  image_path: string | null;
  /** Online store (migration v86). published_online is 0/1; online_price_cents/online_description
   * are null when the product falls back to its main price/description; online_image_urls is a JSON
   * TEXT array of { url, thumbUrl } (never bytes — see ECOMMERCE-ARCHITECTURE.md §8). */
  published_online: number;
  online_description: string | null;
  online_price_cents: number | null;
  online_image_urls: string;
  /** Online store (migration v87). JSON TEXT string array of extra category ids this product shows
   * under on the website, on top of category_id. '[]' = none. */
  online_category_ids: string;
  /** Online store (migration v88). JSON TEXT { quickSpecs, blocks } — rich detail-page content. */
  online_content_json: string;
  status: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  sync_status: string;
  last_synced_at: string | null;
  /** Phase 2's optimistic-lock baseline — the last server value this device actually saw, cached
   * so a push can detect whether another device wrote in between. Null until this product's first
   * successful push or pull. See sync-engine.ts's CONFLICT_AWARE_ENTITIES. */
  synced_updated_at: string | null;
};

export type ProductListRow = ProductRow & {
  category_name: string | null;
  category_color: string | null;
  total_stock: number;
};

/**
 * Lists products for the tenant. Pass null for locationId to see the full tenant-wide catalog with
 * stock summed across every location.
 *
 * When locationId is provided, `requireInventoryRow` picks which of two different questions gets
 * asked:
 *  - false (default; the branch-scope auto-restriction every role's Checkout/Invoices/Quotations
 *    already relies on): "which products CAN be sold here" — tagged to this storefront OR tagged
 *    "All Storefronts" (storefront_id IS NULL), regardless of whether stock has physically been
 *    distributed here yet (total_stock is simply 0 until it has).
 *  - true (the Products tab's own explicit storefront filter): "which products are ACTUALLY STOCKED
 *    here right now" — requires a real `inventory` row at this location, the exact same membership
 *    test the Inventory Report's per-location sections use. Without this, the storefront_id-tag
 *    fallback let every untagged product count toward every storefront's total, which is why a real
 *    tenant's Products-tab-per-storefront count (600) badly overshot the Inventory Report's own
 *    count for the same storefront (300) — this brings the two back into agreement.
 */
export function findAllProductRows(
  tenantId: string,
  locationId: string | null,
  requireInventoryRow = false
): ProductListRow[] {
  const membershipClause = requireInventoryRow
    ? `(? IS NULL OR EXISTS (SELECT 1 FROM inventory ix WHERE ix.product_id = p.id AND ix.location_id = ?))`
    : `(? IS NULL OR p.storefront_id IS NULL OR p.storefront_id = ?)`;
  return getDatabase()
    .prepare(
      `
      SELECT p.*, c.name AS category_name, c.color AS category_color, COALESCE(SUM(i.quantity), 0) AS total_stock
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN inventory i ON i.product_id = p.id AND (? IS NULL OR i.location_id = ?)
      WHERE p.tenant_id = ?
        AND ${membershipClause}
      GROUP BY p.id
      ORDER BY p.name ASC
    `
    )
    .all(locationId, locationId, tenantId, locationId, locationId) as ProductListRow[];
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

/** For auto-generating the next "PROD-000001"-style SKU — only considers SKUs following that exact
 * pattern, so a tenant's pre-existing manually-entered SKUs (whatever scheme they used) are simply
 * ignored rather than confusing the counter. */
// Returns every matching SKU, not just the max — see document-number-service.ts's own comment.
export function findMaxProductSkuNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT sku FROM products WHERE tenant_id = ? AND sku LIKE 'PROD-%'")
      .all(tenantId) as Array<{ sku: string }>
  ).map((row) => row.sku);
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
        category_id, storefront_id, unit_of_measure, buying_price_cents, selling_price_cents, wholesale_price_cents,
        wholesale_min_quantity, minimum_price_cents, tax_rate, tax_type, prices_tax_inclusive, reorder_level, track_stock,
        allow_negative_stock, image_path, status, created_at, updated_at, created_by, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending')
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
      input.storefrontId,
      input.unitOfMeasure,
      input.buyingPriceCents,
      input.sellingPriceCents,
      input.wholesalePriceCents,
      input.wholesaleMinQuantity,
      input.minimumPriceCents,
      input.taxRate,
      input.taxType,
      input.pricesTaxInclusive === null ? null : input.pricesTaxInclusive ? 1 : 0,
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
        storefront_id = ?,
        unit_of_measure = ?,
        buying_price_cents = ?,
        selling_price_cents = ?,
        wholesale_price_cents = ?,
        wholesale_min_quantity = ?,
        minimum_price_cents = ?,
        tax_rate = ?,
        tax_type = ?,
        prices_tax_inclusive = ?,
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
      input.storefrontId,
      input.unitOfMeasure,
      input.buyingPriceCents,
      input.sellingPriceCents,
      input.wholesalePriceCents,
      input.wholesaleMinQuantity,
      input.minimumPriceCents,
      input.taxRate,
      input.taxType,
      input.pricesTaxInclusive === null ? null : input.pricesTaxInclusive ? 1 : 0,
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

/** Narrow update fired when a purchase is saved as "ordered" — buyingPriceCents always updates (the
 * line's own new unit cost), sellingPriceCents only when that line actually provided one,
 * minimumPriceCents is unconditionally pinned to the new buying price so a sale can never be rung up
 * below what this product now costs to restock (see sale-service.ts's own minimum-price floor check,
 * the exact validation this exists to keep satisfied). Same narrow-update shape as
 * setProductStatusRow — never touches any other product field. */
export function updatePricingFromPurchaseRow(
  id: string,
  input: { buyingPriceCents: number; sellingPriceCents: number | null }
): ProductRow {
  const now = new Date().toISOString();
  if (input.sellingPriceCents !== null) {
    getDatabase()
      .prepare(
        "UPDATE products SET buying_price_cents = ?, selling_price_cents = ?, minimum_price_cents = ?, sync_status = 'pending', updated_at = ? WHERE id = ?"
      )
      .run(input.buyingPriceCents, input.sellingPriceCents, input.buyingPriceCents, now, id);
  } else {
    getDatabase()
      .prepare("UPDATE products SET buying_price_cents = ?, minimum_price_cents = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
      .run(input.buyingPriceCents, input.buyingPriceCents, now, id);
  }

  const row = findProductRowById(id);
  if (!row) {
    throw new Error("Product not found after pricing update");
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

/** Same narrow-update shape as setProductStatusRow (one field + the sync_status/updated_at bump
 * every row needs to get picked up by the existing AFTER UPDATE sync-outbox trigger), just batched
 * across many ids in one statement instead of one row. tenant_id is re-checked here too — defense
 * in depth even though callers only ever pass ids already scoped to the caller's own product list. */
export function bulkSetTaxTypeRows(tenantId: string, productIds: string[], taxType: string): number {
  if (productIds.length === 0) return 0;
  const now = new Date().toISOString();
  const placeholders = productIds.map(() => "?").join(", ");

  const result = getDatabase()
    .prepare(`UPDATE products SET tax_type = ?, sync_status = 'pending', updated_at = ? WHERE tenant_id = ? AND id IN (${placeholders})`)
    .run(taxType, now, tenantId, ...productIds);

  return Number(result.changes);
}

/** The "Online Store" tab's own narrow mutation — deliberately separate from updateProductRow (the
 * full product form). Only the keys passed are touched; every call bumps sync_status/updated_at so
 * the existing AFTER UPDATE sync-outbox trigger carries it to the cloud, same shape as
 * setProductStatusRow. */
export function setProductOnlineRow(
  id: string,
  input: {
    publishedOnline?: boolean;
    onlineDescription?: string | null;
    onlinePriceCents?: number | null;
    onlineImageUrls?: OnlineImageRef[];
    onlineCategoryIds?: string[];
    onlineContent?: ProductOnlineContent;
  }
): ProductRow {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];

  if (input.publishedOnline !== undefined) {
    sets.push("published_online = ?");
    params.push(input.publishedOnline ? 1 : 0);
  }
  if (input.onlineDescription !== undefined) {
    sets.push("online_description = ?");
    params.push(input.onlineDescription);
  }
  if (input.onlinePriceCents !== undefined) {
    sets.push("online_price_cents = ?");
    params.push(input.onlinePriceCents);
  }
  if (input.onlineImageUrls !== undefined) {
    sets.push("online_image_urls = ?");
    params.push(
      JSON.stringify(input.onlineImageUrls.map((e) => ({ url: e.url, thumbUrl: e.thumbUrl })))
    );
  }
  if (input.onlineCategoryIds !== undefined) {
    sets.push("online_category_ids = ?");
    params.push(JSON.stringify([...new Set(input.onlineCategoryIds.filter((v) => typeof v === "string" && v))]));
  }
  if (input.onlineContent !== undefined) {
    sets.push("online_content_json = ?");
    params.push(serializeOnlineContent(input.onlineContent));
  }

  if (sets.length === 0) {
    const current = findProductRowById(id);
    if (!current) throw new Error("Product not found");
    return current;
  }

  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE products SET ${sets.join(", ")}, sync_status = 'pending', updated_at = ? WHERE id = ?`
    )
    .run(...params, now, id);

  const row = findProductRowById(id);
  if (!row) {
    throw new Error("Product not found after online-store update");
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
    storefrontId: row.storefront_id,
    unitOfMeasure: row.unit_of_measure as Product["unitOfMeasure"],
    buyingPriceCents: row.buying_price_cents,
    sellingPriceCents: row.selling_price_cents,
    wholesalePriceCents: row.wholesale_price_cents,
    wholesaleMinQuantity: row.wholesale_min_quantity,
    minimumPriceCents: row.minimum_price_cents,
    taxRate: row.tax_rate,
    taxType: row.tax_type as Product["taxType"],
    pricesTaxInclusive: row.prices_tax_inclusive === null ? null : Boolean(row.prices_tax_inclusive),
    reorderLevel: row.reorder_level,
    trackStock: Boolean(row.track_stock),
    allowNegativeStock: Boolean(row.allow_negative_stock),
    imagePath: row.image_path,
    publishedOnline: Boolean(row.published_online),
    onlineDescription: row.online_description,
    onlinePriceCents: row.online_price_cents,
    onlineImageUrls: parseOnlineImageUrls(row.online_image_urls),
    onlineCategoryIds: parseIdArray(row.online_category_ids),
    onlineContent: parseOnlineContent(row.online_content_json),
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
    categoryColor: row.category_color,
    totalStock: row.total_stock
  };
}


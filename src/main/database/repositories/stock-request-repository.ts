import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";

export type StockRequestRow = {
  id: string;
  tenant_id: string;
  request_number: string;
  storefront_id: string;
  storefront_name: string;
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  rejection_reason: string | null;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
  total_quantity_requested: number;
};

export type StockRequestItemRow = {
  id: string;
  stock_request_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity_requested: number;
  /** Frozen at the moment this item was approved and shipped — never recomputed, so a reprint months
   * later shows exactly what was true then. NULL while the request is still pending or if it was
   * rejected (nothing has shipped yet). Mirrors stock_receipt_items' own previous/new quantity pair. */
  previous_quantity: number | null;
  new_quantity: number | null;
  /** The OTHER side of the same approval — Main Store's own on-hand quantity immediately before/after
   * this item was drawn out via distributeMainStoreStockCore. NULL under the same conditions as
   * previous_quantity/new_quantity above. */
  main_store_previous_quantity: number | null;
  main_store_new_quantity: number | null;
};

const SELECT_WITH_JOINS = `
  SELECT sr.*,
    l.location_name AS storefront_name,
    (req.first_name || ' ' || req.last_name) AS requested_by_name,
    CASE WHEN sr.reviewed_by IS NOT NULL THEN (rev.first_name || ' ' || rev.last_name) ELSE NULL END AS reviewed_by_name,
    (SELECT COUNT(*) FROM stock_request_items sri WHERE sri.stock_request_id = sr.id) AS item_count,
    (SELECT COALESCE(SUM(sri.quantity_requested), 0) FROM stock_request_items sri WHERE sri.stock_request_id = sr.id) AS total_quantity_requested
  FROM stock_requests sr
  JOIN locations l ON l.id = sr.storefront_id
  JOIN employees req ON req.id = sr.requested_by
  LEFT JOIN employees rev ON rev.id = sr.reviewed_by
`;

// Returns every matching number, not just the max — see document-number-service.ts's own comment.
export function findMaxStockRequestNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT request_number FROM stock_requests WHERE tenant_id = ? AND request_number LIKE 'SR-%'")
      .all(tenantId) as Array<{ request_number: string }>
  ).map((row) => row.request_number);
}

export function findStockRequestRowById(id: string): StockRequestRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_JOINS} WHERE sr.id = ?`).get(id) as StockRequestRow | undefined;
}

/** locationId null returns every storefront's requests (Storekeeper/Super Admin); non-null scopes to
 * one storefront (Cashier/Manager, matching getCurrentBranchScope()). */
export function findAllStockRequestRows(tenantId: string, locationId: string | null): StockRequestRow[] {
  return getDatabase()
    .prepare(`${SELECT_WITH_JOINS} WHERE sr.tenant_id = ? AND (? IS NULL OR sr.storefront_id = ?) ORDER BY sr.created_at DESC`)
    .all(tenantId, locationId, locationId) as StockRequestRow[];
}

export function findStockRequestItemRows(stockRequestId: string): StockRequestItemRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT sri.id, sri.stock_request_id, sri.product_id, sri.quantity_requested, sri.previous_quantity,
        sri.new_quantity, sri.main_store_previous_quantity, sri.main_store_new_quantity, p.name AS product_name, p.sku
      FROM stock_request_items sri
      JOIN products p ON p.id = sri.product_id
      WHERE sri.stock_request_id = ?
      ORDER BY p.name
    `
    )
    .all(stockRequestId) as StockRequestItemRow[];
}

export function insertStockRequestRow(input: {
  tenantId: string;
  requestNumber: string;
  storefrontId: string;
  notes: string | null;
  requestedBy: string;
}): string {
  const id = `sreq_${randomUUID()}`;
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO stock_requests (
        id, tenant_id, request_number, storefront_id, status, notes, requested_by, requested_at,
        created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(id, input.tenantId, input.requestNumber, input.storefrontId, input.notes, input.requestedBy, now, now, now);

  return id;
}

export function insertStockRequestItemRow(input: {
  stockRequestId: string;
  productId: string;
  quantityRequested: number;
}): void {
  const id = `sreqi_${randomUUID()}`;
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      "INSERT INTO stock_request_items (id, stock_request_id, product_id, quantity_requested, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, input.stockRequestId, input.productId, input.quantityRequested, now);
}

/** Called once per item, at approval time, immediately after distributeMainStoreStockCore ships it —
 * see stock-request-service.ts's approveStockRequest for where the before/after values themselves are
 * captured. Never called for a rejected request's items (they stay NULL forever). */
export function updateStockRequestItemFulfillmentRow(
  id: string,
  input: {
    previousQuantity: number;
    newQuantity: number;
    mainStorePreviousQuantity: number;
    mainStoreNewQuantity: number;
  }
): void {
  getDatabase()
    .prepare(
      `UPDATE stock_request_items
       SET previous_quantity = ?, new_quantity = ?, main_store_previous_quantity = ?, main_store_new_quantity = ?
       WHERE id = ?`
    )
    .run(input.previousQuantity, input.newQuantity, input.mainStorePreviousQuantity, input.mainStoreNewQuantity, id);
}

export function updateStockRequestStatusRow(
  id: string,
  input: { status: "approved" | "rejected"; rejectionReason: string | null; reviewedBy: string }
): void {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      "UPDATE stock_requests SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?"
    )
    .run(input.status, input.rejectionReason, input.reviewedBy, now, now, id);
}

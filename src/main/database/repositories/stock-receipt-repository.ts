import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";

export type StockReceiptRow = {
  id: string;
  tenant_id: string;
  receipt_number: string;
  location_id: string;
  location_name: string;
  allocation_storefront_id: string | null;
  allocation_storefront_name: string | null;
  received_by: string;
  received_by_name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
  total_quantity_received: number;
  /** Derived, not stored — 1 if any of this receipt's own stock_movements rows is a transfer_in
   * (see createStockReceipt's main_store_transfer branch), 0 for the plain purchase case. Computed
   * at read time from stock_movements instead of a real column deliberately: stock_receipts is a
   * synced entity (see sync-engine.ts's STOCK_RECEIPT_HEADER_COLUMNS/PAYLOAD_BUILDERS), and adding a
   * genuinely new persisted field there means extending the cloud schema too (a live production
   * Postgres migration) for what's purely a display distinction — this way "was it a transfer" is
   * always correctly derivable from data that already exists and already syncs on its own. */
  is_transfer: number;
};

export type StockReceiptItemRow = {
  id: string;
  stock_receipt_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity_received: number;
  previous_quantity: number;
  new_quantity: number;
  main_store_previous_quantity: number | null;
  main_store_new_quantity: number | null;
};

const SELECT_WITH_JOINS = `
  SELECT sr.*,
    l.location_name AS location_name,
    CASE WHEN sr.allocation_storefront_id IS NOT NULL THEN als.location_name ELSE NULL END AS allocation_storefront_name,
    (rec.first_name || ' ' || rec.last_name) AS received_by_name,
    (SELECT COUNT(*) FROM stock_receipt_items sri WHERE sri.stock_receipt_id = sr.id) AS item_count,
    (SELECT COALESCE(SUM(sri.quantity_received), 0) FROM stock_receipt_items sri WHERE sri.stock_receipt_id = sr.id) AS total_quantity_received,
    (SELECT COUNT(*) FROM stock_movements sm WHERE sm.reference_type = 'stock_receipt' AND sm.reference_id = sr.id AND sm.movement_type = 'transfer_in') AS is_transfer
  FROM stock_receipts sr
  JOIN locations l ON l.id = sr.location_id
  LEFT JOIN locations als ON als.id = sr.allocation_storefront_id
  JOIN employees rec ON rec.id = sr.received_by
`;

// Returns every matching number, not just the max — see document-number-service.ts's own comment.
export function findMaxStockReceiptNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT receipt_number FROM stock_receipts WHERE tenant_id = ? AND receipt_number LIKE 'GRN-%'")
      .all(tenantId) as Array<{ receipt_number: string }>
  ).map((row) => row.receipt_number);
}

export function findStockReceiptRowById(id: string): StockReceiptRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_JOINS} WHERE sr.id = ?`).get(id) as StockReceiptRow | undefined;
}

/** locationId null returns every location's receipts (Storekeeper/Super Admin); non-null scopes to
 * one location (Cashier/Manager, matching getCurrentBranchScope()). */
export function findAllStockReceiptRows(tenantId: string, locationId: string | null): StockReceiptRow[] {
  return getDatabase()
    .prepare(`${SELECT_WITH_JOINS} WHERE sr.tenant_id = ? AND (? IS NULL OR sr.location_id = ?) ORDER BY sr.created_at DESC`)
    .all(tenantId, locationId, locationId) as StockReceiptRow[];
}

export function findStockReceiptItemRows(stockReceiptId: string): StockReceiptItemRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT sri.id, sri.stock_receipt_id, sri.product_id, sri.quantity_received, sri.previous_quantity,
        sri.new_quantity, sri.main_store_previous_quantity, sri.main_store_new_quantity, p.name AS product_name, p.sku
      FROM stock_receipt_items sri
      JOIN products p ON p.id = sri.product_id
      WHERE sri.stock_receipt_id = ?
      ORDER BY p.name
    `
    )
    .all(stockReceiptId) as StockReceiptItemRow[];
}

export function insertStockReceiptRow(input: {
  tenantId: string;
  receiptNumber: string;
  locationId: string;
  allocationStorefrontId: string | null;
  notes: string | null;
  receivedBy: string;
}): string {
  const id = `sreceipt_${randomUUID()}`;
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO stock_receipts (
        id, tenant_id, receipt_number, location_id, allocation_storefront_id, received_by, notes,
        created_at, updated_at, sync_status, synced_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `
    )
    .run(
      id,
      input.tenantId,
      input.receiptNumber,
      input.locationId,
      input.allocationStorefrontId,
      input.receivedBy,
      input.notes,
      now,
      now,
      now
    );

  return id;
}

export function insertStockReceiptItemRow(input: {
  stockReceiptId: string;
  productId: string;
  quantityReceived: number;
  previousQuantity: number;
  newQuantity: number;
  mainStorePreviousQuantity?: number | null;
  mainStoreNewQuantity?: number | null;
}): void {
  const id = `sreceipti_${randomUUID()}`;
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `INSERT INTO stock_receipt_items (
        id, stock_receipt_id, product_id, quantity_received, previous_quantity, new_quantity,
        main_store_previous_quantity, main_store_new_quantity, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.stockReceiptId,
      input.productId,
      input.quantityReceived,
      input.previousQuantity,
      input.newQuantity,
      input.mainStorePreviousQuantity ?? null,
      input.mainStoreNewQuantity ?? null,
      now
    );
}

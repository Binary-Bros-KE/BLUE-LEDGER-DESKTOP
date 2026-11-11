import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase, resetTestDatabase } from "./stubs/connection.ts";
import { reconcileFulfilledStockRequests } from "../src/main/database/repositories/stock-request-reconciliation.ts";

beforeEach(() => {
  resetTestDatabase();
  getDatabase().exec(`
    CREATE TABLE stock_requests (id TEXT, tenant_id TEXT, storefront_id TEXT, status TEXT, updated_at TEXT, rejection_reason TEXT, reviewed_by TEXT, reviewed_at TEXT, sync_status TEXT);
    CREATE TABLE stock_request_items (id TEXT, stock_request_id TEXT, product_id TEXT, quantity_requested INTEGER, quantity_dispatched INTEGER, previous_quantity INTEGER, new_quantity INTEGER, main_store_previous_quantity INTEGER, main_store_new_quantity INTEGER);
    CREATE TABLE stock_movements (id TEXT, tenant_id TEXT, product_id TEXT, location_id TEXT, movement_type TEXT, quantity_change INTEGER, previous_quantity INTEGER, new_quantity INTEGER, performed_by TEXT, created_at TEXT, reference_type TEXT, reference_id TEXT);
    CREATE TABLE stock_receipts (id TEXT, tenant_id TEXT, stock_request_id TEXT);
    CREATE TABLE stock_receipt_items (stock_receipt_id TEXT, product_id TEXT, quantity_received INTEGER);
    CREATE TABLE inventory (quantity INTEGER);
    INSERT INTO inventory VALUES (100);
    INSERT INTO stock_requests VALUES ('r', 'tenant', 'shop', 'pending', '2026-01-01', NULL, NULL, NULL, 'synced');
    INSERT INTO stock_request_items VALUES ('i1', 'r', 'p1', 5, NULL, NULL, NULL, NULL, NULL), ('i2', 'r', 'p2', 3, NULL, NULL, NULL, NULL, NULL);
  `);
});

function movement(
  product: string,
  quantity: number,
  refType = "stock_request_fulfillment",
  refId = "r",
  tenant = "tenant",
  shop = "shop"
): void {
  const insert = getDatabase().prepare(
    "INSERT INTO stock_movements VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  insert.run(
    product + "-out",
    tenant,
    product,
    "main",
    "transfer_out",
    -quantity,
    100,
    100 - quantity,
    "employee",
    "2026-01-02",
    refType,
    refId
  );
  insert.run(
    product + "-in",
    tenant,
    product,
    shop,
    "transfer_in",
    quantity,
    10,
    10 + quantity,
    "employee",
    "2026-01-02",
    refType,
    refId
  );
}
function status(): string {
  return (getDatabase().prepare("SELECT status FROM stock_requests").get() as { status: string })
    .status;
}

test("repairs an old fully fulfilled Pending request once without changing inventory or movements", () => {
  movement("p1", 5);
  movement("p2", 3);
  assert.equal(reconcileFulfilledStockRequests("tenant"), 1);
  assert.equal(status(), "approved");
  assert.deepEqual(
    getDatabase()
      .prepare("SELECT quantity_dispatched FROM stock_request_items ORDER BY id")
      .all()
      .map((r) => r.quantity_dispatched),
    [5, 3]
  );
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
  assert.equal(getDatabase().prepare("SELECT quantity FROM inventory").get()!.quantity, 100);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS n FROM stock_movements").get()!.n, 4);
});

test("waits for complete incoming and outgoing evidence across sync pages", () => {
  movement("p1", 5);
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
  movement("p2", 3);
  getDatabase().exec("DELETE FROM stock_movements WHERE id = 'p2-out'");
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
  assert.equal(status(), "pending");
});

test("recovers a known partial dispatch including explicit zero lines", () => {
  getDatabase().exec(
    "UPDATE stock_request_items SET quantity_dispatched = CASE WHEN product_id = 'p1' THEN 2 ELSE 0 END"
  );
  movement("p1", 2);
  assert.equal(reconcileFulfilledStockRequests("tenant"), 1);
});

test("does not guess partial dispatches or accept duplicate incoming transfers", () => {
  movement("p1", 2);
  movement("p2", 3);
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
  getDatabase().exec(
    "UPDATE stock_movements SET quantity_change = 5 WHERE id = 'p1-in'; UPDATE stock_movements SET quantity_change = -5 WHERE id = 'p1-out'; INSERT INTO stock_movements SELECT 'duplicate', tenant_id, product_id, location_id, movement_type, quantity_change, previous_quantity, new_quantity, performed_by, created_at, reference_type, reference_id FROM stock_movements WHERE id = 'p1-in'"
  );
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
});

test("unrelated receipts, other tenants and other storefronts cannot fulfil a request", () => {
  movement("p1", 5, "stock_receipt", "unlinked");
  movement("p2", 3, "stock_receipt", "unlinked");
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
  getDatabase().exec("DELETE FROM stock_movements");
  movement("p1", 5, "stock_request_fulfillment", "r", "other");
  movement("p2", 3, "stock_request_fulfillment", "r", "other");
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
  getDatabase().exec("DELETE FROM stock_movements");
  movement("p1", 5, "stock_request_fulfillment", "r", "tenant", "other-shop");
  movement("p2", 3, "stock_request_fulfillment", "r", "tenant", "other-shop");
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
});

test("an explicitly linked receipt recovers partial fulfillment only after its transfers arrive", () => {
  getDatabase().exec(
    "INSERT INTO stock_receipts VALUES ('grn','tenant','r'); INSERT INTO stock_receipt_items VALUES ('grn','p1',2)"
  );
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
  movement("p1", 2, "stock_receipt", "grn");
  assert.equal(reconcileFulfilledStockRequests("tenant"), 1);
  assert.deepEqual(
    getDatabase()
      .prepare("SELECT quantity_dispatched FROM stock_request_items ORDER BY id")
      .all()
      .map((r) => r.quantity_dispatched),
    [2, 0]
  );
});

test("rejected requests are never automatically overwritten", () => {
  movement("p1", 5);
  movement("p2", 3);
  getDatabase().exec("UPDATE stock_requests SET status = 'rejected'");
  assert.equal(reconcileFulfilledStockRequests("tenant"), 0);
  assert.equal(status(), "rejected");
});

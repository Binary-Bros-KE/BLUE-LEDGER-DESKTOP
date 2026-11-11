// Receiving through the real purchase service, on a database built by every real migration: whoever
// records purchases (a Cashier with Purchases → Create) receives them at their own storefront, and
// "Create & Receive" orders and receives in one step.
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase } from "../src/main/database/connection.ts";
import { migrateDatabase } from "../src/main/database/migrate.ts";
import { setTestSession } from "../src/main/services/auth-service.ts";
import { createPurchase, receivePurchaseGoods } from "../src/main/services/purchase-service.ts";

function insertRow(table: string, values: Record<string, string | number | null>): void {
  const db = getDatabase();
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown; type: string }>;
  const row: Record<string, string | number | null> = { ...values };
  for (const column of columns) {
    if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
    row[column.name] = /INT|REAL/i.test(column.type) ? 0 : `${table}-${column.name}-${String(values.id ?? "")}`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...Object.values(row));
}

function stockAt(locationId: string): number {
  const row = getDatabase().prepare("SELECT quantity FROM inventory WHERE product_id = 'prod-1' AND location_id = ?").get(locationId) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

const CASHIER = { purchases: ["view", "create"] };

function order(locationId: string, receiveNow = false) {
  return createPurchase({
    supplierId: "sup-local",
    locationId,
    items: [{ productId: "prod-1", orderedQuantity: 5, unitCostCents: 200, discountAmountCents: 0, taxType: "exempted" }],
    intent: "ordered",
    receiveNow
  });
}

before(() => {
  assert.deepEqual(migrateDatabase(), [], "every migration applies cleanly");
  insertRow("tenant", { id: "tenant-1", business_name: "Test Shop", client_id: "client-1" });
  insertRow("locations", { id: "loc-a", tenant_id: "tenant-1", location_name: "Branch A", location_code: "A", phone: "0700000000" });
  insertRow("locations", { id: "loc-b", tenant_id: "tenant-1", location_name: "Branch B", location_code: "B", phone: "0700000001" });
  insertRow("employees", { id: "emp-1", tenant_id: "tenant-1", first_name: "Jane", last_name: "Cashier" });
  insertRow("products", { id: "prod-1", tenant_id: "tenant-1", name: "Rice 1kg", sku: "RICE-1", selling_price_cents: 500, track_stock: 1, status: "active" });
  insertRow("suppliers", { id: "sup-local", tenant_id: "tenant-1", supplier_code: "SUP-1", business_name: "Local Wholesaler", phone_1: "0711111111", supplier_type: "local", status: "active" });
});

beforeEach(() => {
  setTestSession({ employeeId: "emp-1", branchId: "loc-a", permissions: CASHIER });
});

test("a cashier who can create purchases receives one at their own storefront", () => {
  const purchase = order("loc-a");
  const before = stockAt("loc-a");
  const received = receivePurchaseGoods(purchase.id, { items: [{ purchaseItemId: purchase.items[0]!.id, receivingQuantity: 5 }] });
  assert.equal(received.status, "received");
  assert.equal(stockAt("loc-a"), before + 5);
});

test("...but not one going to another storefront", () => {
  setTestSession({ employeeId: "emp-1", branchId: null, permissions: { purchases: ["view", "create", "edit"] } });
  const elsewhere = order("loc-b");
  setTestSession({ employeeId: "emp-1", branchId: "loc-a", permissions: CASHIER });
  assert.throws(() => receivePurchaseGoods(elsewhere.id, { items: [{ purchaseItemId: elsewhere.items[0]!.id, receivingQuantity: 5 }] }), /not found/);
});

test("a role that can only view purchases can't receive", () => {
  const purchase = order("loc-a");
  setTestSession({ employeeId: "emp-1", branchId: "loc-a", permissions: { purchases: ["view"] } });
  assert.throws(() => receivePurchaseGoods(purchase.id, { items: [{ purchaseItemId: purchase.items[0]!.id, receivingQuantity: 1 }] }), /permission/);
});

test("Create & Receive orders it and takes every line into stock, owing the supplier", () => {
  const before = stockAt("loc-a");
  const purchase = order("loc-a", true);
  assert.equal(purchase.status, "received");
  assert.equal(purchase.items[0]!.receivedQuantity, 5);
  assert.equal(purchase.receivingEvents.length, 1);
  assert.equal(stockAt("loc-a"), before + 5);
  const owed = getDatabase().prepare("SELECT balance_cents FROM suppliers WHERE id = 'sup-local'").get() as { balance_cents: number };
  assert.ok(owed.balance_cents >= 1_000, "the supplier is owed for the received goods");
});

test("Create & Receive into another storefront is refused, and nothing is saved", () => {
  const count = () => (getDatabase().prepare("SELECT COUNT(*) AS n FROM purchases").get() as { n: number }).n;
  const before = count();
  assert.throws(() => order("loc-b", true), /not found|storefront/);
  assert.equal(count(), before);
});

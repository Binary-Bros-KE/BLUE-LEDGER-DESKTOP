import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase, resetTestDatabase } from "./stubs/connection.ts";
import { findOutstandingPurchases } from "../src/main/database/repositories/supplier-report-repository.ts";
import { computePurchasePayableCents } from "../src/shared/lib/purchase.ts";

beforeEach(() => {
  resetTestDatabase();
  getDatabase().exec(`
    CREATE TABLE suppliers (id TEXT, business_name TEXT, supplier_type TEXT, phone_1 TEXT);
    CREATE TABLE purchases (id TEXT, tenant_id TEXT, supplier_id TEXT, purchase_number TEXT, status TEXT, ordered_at TEXT, created_at TEXT, grand_total_cents INTEGER, amount_paid_cents INTEGER, received_value_cents INTEGER, shipping_cost_cents INTEGER, payment_status TEXT, location_id TEXT);
    INSERT INTO suppliers VALUES ('s', 'Supplier', 'local', '');
  `);
});

function purchase(
  id: string,
  received: number,
  paid: number,
  status = "partially_received",
  paymentStatus = "unpaid",
  location = "loc"
): void {
  getDatabase()
    .prepare(
      "INSERT INTO purchases VALUES (?, 'tenant', 's', ?, ?, '2026-01-01', '2026-01-01', 100000, ?, ?, 1000, ?, ?)"
    )
    .run(id, id, status, paid, received, paymentStatus, location);
}

test("unreceived orders owe nothing, including shipping; only received unpaid goods appear", () => {
  purchase("ordered", 0, 0, "ordered");
  purchase("partial", 20000, 5000);
  purchase("settled-partial", 20000, 21000);
  purchase("cancelled", 20000, 0, "cancelled");
  purchase("draft", 20000, 0, "draft");
  const rows = findOutstandingPurchases("tenant", null);
  assert.deepEqual(
    rows.map((row) => row.purchase_id),
    ["partial"]
  );
  const row = rows[0]!;
  assert.equal(
    computePurchasePayableCents({
      receivedValueCents: row.received_value_cents,
      shippingFeeCents: row.shipping_cost_cents
    }) - row.amount_paid_cents,
    16000
  );
});

test("receipt-based debt ignores stale payment status and respects tenant/location scope", () => {
  purchase("received", 100000, 50000, "received", "paid");
  purchase("other-location", 20000, 0, "partially_received", "unpaid", "other");
  assert.deepEqual(
    findOutstandingPurchases("tenant", "loc").map((row) => row.purchase_id),
    ["received"]
  );
  assert.equal(findOutstandingPurchases("other-tenant", null).length, 0);
});

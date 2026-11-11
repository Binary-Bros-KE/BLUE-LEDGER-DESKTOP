import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase, resetTestDatabase } from "./stubs/connection.ts";
import { findPurchaseSummaryRow } from "../src/main/database/repositories/purchase-repository.ts";

beforeEach(() => {
  resetTestDatabase();
  getDatabase().exec(`
    CREATE TABLE suppliers (id TEXT, supplier_type TEXT);
    CREATE TABLE purchases (id TEXT, tenant_id TEXT, supplier_id TEXT, location_id TEXT, status TEXT, received_value_cents INTEGER, shipping_cost_cents INTEGER, amount_paid_cents INTEGER);
    INSERT INTO suppliers VALUES ('local', 'local'), ('intl', 'international');
    INSERT INTO purchases VALUES
      ('l1', 'tenant', 'local', 'loc', 'received', 10000, 0, 4000),
      ('l2', 'tenant', 'local', 'loc', 'ordered', 0, 0, 0),
      ('i1', 'tenant', 'intl', 'loc', 'received', 50000, 1000, 0);
  `);
});

test("the Local and International tabs each count only their own purchases", () => {
  const local = findPurchaseSummaryRow("tenant", null, "local");
  assert.equal(local.total_purchases, 2);
  assert.equal(local.received_count, 1);
  assert.equal(local.outstanding_supplier_payments_cents, 6000);

  const international = findPurchaseSummaryRow("tenant", null, "international");
  assert.equal(international.total_purchases, 1);
  assert.equal(international.outstanding_supplier_payments_cents, 51000);

  assert.equal(findPurchaseSummaryRow("tenant", null, null).total_purchases, 3);
});

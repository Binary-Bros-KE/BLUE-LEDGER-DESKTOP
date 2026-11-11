import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase, resetTestDatabase } from "./stubs/connection.ts";
import { migrateDatabase } from "../src/main/database/migrate.ts";
import { setTestSession } from "./stubs/auth-service.ts";
import { createStockReceipt } from "../src/main/services/stock-receipt-service.ts";
import { approveStockRequest } from "../src/main/services/stock-request-service.ts";

function insert(table: string, values: Record<string, string | number | null>): void {
  const db = getDatabase();
  const columns = db.prepare("PRAGMA table_info(" + table + ")").all() as Array<{
    name: string;
    notnull: number;
    dflt_value: unknown;
    type: string;
  }>;
  const row = { ...values };
  for (const col of columns)
    if (!(col.name in row) && col.notnull && col.dflt_value === null)
      row[col.name] = /INT|REAL/i.test(col.type) ? 0 : table + "-" + col.name + "-" + values.id;
  const names = Object.keys(row);
  db.prepare(
    "INSERT INTO " +
      table +
      " (" +
      names.join(",") +
      ") VALUES (" +
      names.map(() => "?").join(",") +
      ")"
  ).run(...Object.values(row));
}
function quantity(location: string): number {
  return (
    getDatabase()
      .prepare("SELECT quantity FROM inventory WHERE product_id = 'p1' AND location_id = ?")
      .get(location) as { quantity: number }
  ).quantity;
}
function input(extra = {}) {
  return {
    destination: "main_store_transfer",
    locationId: "shop",
    stockRequestId: "r",
    items: [{ productId: "p1", quantityReceived: 2 }],
    ...extra
  };
}

beforeEach(() => {
  resetTestDatabase();
  assert.deepEqual(migrateDatabase(), []);
  insert("tenant", { id: "tenant", business_name: "Test", client_id: "client" });
  insert("locations", {
    id: "main",
    tenant_id: "tenant",
    location_name: "Main",
    location_type: "distribution_center",
    status: "active"
  });
  insert("locations", {
    id: "shop",
    tenant_id: "tenant",
    location_name: "Shop",
    location_type: "retail_store",
    status: "active"
  });
  insert("employees", {
    id: "emp",
    tenant_id: "tenant",
    first_name: "Test",
    last_name: "Employee"
  });
  for (const id of ["p1", "p2"]) {
    insert("products", { id, tenant_id: "tenant", name: id, track_stock: 1, status: "active" });
    insert("inventory", {
      id: "inv-" + id + "-main",
      tenant_id: "tenant",
      product_id: id,
      location_id: "main",
      quantity: 100
    });
    insert("inventory", {
      id: "inv-" + id + "-shop",
      tenant_id: "tenant",
      product_id: id,
      location_id: "shop",
      quantity: 0
    });
  }
  insert("stock_requests", {
    id: "r",
    tenant_id: "tenant",
    request_number: "SR-1",
    storefront_id: "shop",
    status: "pending",
    requested_by: "emp",
    requested_at: "2026-01-01",
    updated_at: "2026-01-01"
  });
  insert("stock_request_items", {
    id: "i1",
    stock_request_id: "r",
    product_id: "p1",
    quantity_requested: 5
  });
  insert("stock_request_items", {
    id: "i2",
    stock_request_id: "r",
    product_id: "p2",
    quantity_requested: 3
  });
  setTestSession({
    employeeId: "emp",
    branchId: null,
    permissions: {
      inventory: ["view", "edit"],
      stock_transfers: ["create"],
      stock_requests: ["view", "approve"],
      main_store: ["view", "edit"]
    }
  });
});

test("linked receipt transfers once, persists its link, and approves partial/zero request lines", async () => {
  const receipt = await createStockReceipt(input());
  assert.equal(receipt.stockRequestId, "r");
  assert.equal(receipt.sourceType, "transfer");
  assert.equal(quantity("main"), 98);
  assert.equal(quantity("shop"), 2);
  assert.equal(
    getDatabase().prepare("SELECT status FROM stock_requests WHERE id = 'r'").get()!.status,
    "approved"
  );
  assert.deepEqual(
    getDatabase()
      .prepare("SELECT quantity_dispatched FROM stock_request_items ORDER BY id")
      .all()
      .map((r) => r.quantity_dispatched),
    [2, 0]
  );
  await assert.rejects(createStockReceipt(input()), /already been reviewed/);
  assert.equal(quantity("main"), 98);
  assert.equal(quantity("shop"), 2);
});

test("unlinked receipts never close a request merely because the products match", async () => {
  await createStockReceipt(input({ stockRequestId: null }));
  assert.equal(
    getDatabase().prepare("SELECT status FROM stock_requests WHERE id = 'r'").get()!.status,
    "pending"
  );
});

test("over-dispatch and invalid destinations fail without stock or receipt side effects", async () => {
  await assert.rejects(
    createStockReceipt(input({ items: [{ productId: "p1", quantityReceived: 6 }] })),
    /not exceed/
  );
  await assert.rejects(
    createStockReceipt(input({ destination: "storefront" })),
    /Main Store transfer/
  );
  assert.equal(quantity("main"), 100);
  assert.equal(quantity("shop"), 0);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) n FROM stock_receipts").get()!.n, 0);
});

test("linking requires approval permissions", async () => {
  setTestSession({
    employeeId: "emp",
    branchId: null,
    permissions: { inventory: ["edit"], stock_transfers: ["create"] }
  });
  await assert.rejects(createStockReceipt(input()), /permission/);
  assert.equal(quantity("main"), 100);
});

test("approval cannot transfer again while a linked receipt already exists", async () => {
  const receipt = await createStockReceipt(input());
  getDatabase().prepare("UPDATE stock_requests SET status = 'pending';").run();
  // A partial sync with the receipt present and movements temporarily absent must still block retry.
  getDatabase().prepare("DELETE FROM stock_movements WHERE reference_id = ?").run(receipt.id);
  await assert.rejects(
    approveStockRequest("r", {
      items: [
        { itemId: "i1", quantityDispatched: 2 },
        { itemId: "i2", quantityDispatched: 0 }
      ],
      note: null
    }),
    /recorded stock transfer/
  );
  assert.equal(quantity("main"), 98);
  assert.equal(quantity("shop"), 2);
});

test("linked receiving rolls back all stock and metadata when a later product is short", async () => {
  getDatabase().exec(
    "UPDATE inventory SET quantity = 0 WHERE location_id = 'main' AND product_id = 'p2'"
  );
  await assert.rejects(
    createStockReceipt(
      input({
        items: [
          { productId: "p1", quantityReceived: 2 },
          { productId: "p2", quantityReceived: 3 }
        ]
      })
    ),
    /Not enough stock/
  );
  assert.equal(quantity("main"), 100);
  assert.equal(quantity("shop"), 0);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) n FROM stock_receipts").get()!.n, 0);
  assert.equal(
    getDatabase().prepare("SELECT status FROM stock_requests WHERE id = 'r'").get()!.status,
    "pending"
  );
});

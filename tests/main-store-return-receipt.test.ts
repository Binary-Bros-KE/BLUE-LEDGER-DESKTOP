import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase, resetTestDatabase } from "./stubs/connection.ts";
import { migrateDatabase } from "../src/main/database/migrate.ts";
import { setTestSession } from "./stubs/auth-service.ts";
import { createStockReceipt } from "../src/main/services/stock-receipt-service.ts";

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
    "INSERT INTO " + table + " (" + names.join(",") + ") VALUES (" + names.map(() => "?").join(",") + ")"
  ).run(...Object.values(row));
}
function quantity(product: string, location: string): number {
  return (
    getDatabase()
      .prepare("SELECT quantity FROM inventory WHERE product_id = ? AND location_id = ?")
      .get(product, location) as { quantity: number }
  ).quantity;
}
function earmarked(product: string, storefront: string): number {
  const row = getDatabase()
    .prepare("SELECT quantity FROM main_store_allocations WHERE product_id = ? AND storefront_id = ?")
    .get(product, storefront) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}
function session(branchId: string | null): void {
  setTestSession({
    employeeId: "emp",
    branchId,
    permissions: { inventory: ["view", "edit"], stock_transfers: ["create"], main_store: ["view", "edit"] }
  });
}

beforeEach(() => {
  resetTestDatabase();
  assert.deepEqual(migrateDatabase(), []);
  insert("tenant", { id: "tenant", business_name: "Test", client_id: "client" });
  insert("locations", { id: "main", tenant_id: "tenant", location_name: "Main", location_type: "distribution_center", status: "active" });
  insert("locations", { id: "shop", tenant_id: "tenant", location_name: "Shop", location_type: "retail_store", status: "active" });
  insert("locations", { id: "shop2", tenant_id: "tenant", location_name: "Shop 2", location_type: "retail_store", status: "active" });
  insert("employees", { id: "emp", tenant_id: "tenant", first_name: "Test", last_name: "Employee" });
  for (const id of ["p1", "p2"]) {
    insert("products", { id, tenant_id: "tenant", name: id, track_stock: 1, status: "active" });
    insert("inventory", { id: "inv-" + id + "-main", tenant_id: "tenant", product_id: id, location_id: "main", quantity: 10 });
    insert("inventory", { id: "inv-" + id + "-shop", tenant_id: "tenant", product_id: id, location_id: "shop", quantity: 20 });
  }
  session(null);
});

test("sends a batch from a storefront back to Main Store, earmarked for that storefront, with a receipt of record", async () => {
  const receipt = await createStockReceipt({
    destination: "main_store_return",
    fromLocationId: "shop",
    notes: "Back to the warehouse",
    items: [
      { productId: "p1", quantityReceived: 5 },
      { productId: "p2", quantityReceived: 20 }
    ]
  });

  assert.deepEqual([quantity("p1", "shop"), quantity("p1", "main")], [15, 15]);
  assert.deepEqual([quantity("p2", "shop"), quantity("p2", "main")], [0, 30]);
  assert.deepEqual([earmarked("p1", "shop"), earmarked("p2", "shop")], [5, 20]);

  assert.equal(receipt.locationId, "main");
  assert.equal(receipt.sourceType, "location_transfer");
  assert.equal(receipt.transferFromLocationName, "Shop");
  const p1 = receipt.items.find((item) => item.productId === "p1")!;
  assert.deepEqual(
    [p1.previousQuantity, p1.newQuantity, p1.mainStorePreviousQuantity, p1.mainStoreNewQuantity],
    [10, 15, 20, 15],
    "Main Store before/after, then the sending storefront's"
  );
});

test("refuses more than the storefront holds, and changes nothing", async () => {
  await assert.rejects(() =>
    createStockReceipt({
      destination: "main_store_return",
      fromLocationId: "shop",
      items: [
        { productId: "p1", quantityReceived: 5 },
        { productId: "p2", quantityReceived: 21 }
      ]
    })
  );
  assert.deepEqual([quantity("p1", "shop"), quantity("p1", "main"), quantity("p2", "shop")], [20, 10, 20]);
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS n FROM stock_receipts").get()!.n, 0);
});

test("a storefront-scoped employee can only send their own storefront's stock", async () => {
  session("shop2");
  await assert.rejects(
    () => createStockReceipt({ destination: "main_store_return", fromLocationId: "shop", items: [{ productId: "p1", quantityReceived: 1 }] }),
    /your own storefront/
  );
  assert.equal(quantity("p1", "shop"), 20);
});

test("Main Store can't be the source", async () => {
  await assert.rejects(
    () => createStockReceipt({ destination: "main_store_return", fromLocationId: "main", items: [{ productId: "p1", quantityReceived: 1 }] }),
    /Source storefront not found/
  );
});

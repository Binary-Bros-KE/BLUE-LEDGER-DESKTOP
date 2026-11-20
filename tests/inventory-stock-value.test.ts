// Inventory Report stock value per location, Main Store included, on a database built by every real migration.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase } from "../src/main/database/connection.ts";
import { migrateDatabase } from "../src/main/database/migrate.ts";
import { setTestSession } from "../src/main/services/auth-service.ts";
import { getInventoryReportData } from "../src/main/services/inventory-report-service.ts";

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

before(() => {
  assert.deepEqual(migrateDatabase(), [], "every migration applies cleanly");
  insertRow("tenant", { id: "tenant-1", business_name: "Test Shop", client_id: "client-1" });
  insertRow("locations", { id: "store", tenant_id: "tenant-1", location_name: "Main Store", location_code: "MS", location_type: "distribution_center", status: "active", phone: "0700000000" });
  insertRow("locations", { id: "shop-a", tenant_id: "tenant-1", location_name: "Shop A", location_code: "A", location_type: "storefront", status: "active", phone: "0700000001" });
  insertRow("locations", { id: "shop-b", tenant_id: "tenant-1", location_name: "Shop B", location_code: "B", location_type: "storefront", status: "active", phone: "0700000002" });
  insertRow("products", { id: "rice", tenant_id: "tenant-1", name: "Rice", sku: "RICE", buying_price_cents: 10_000, selling_price_cents: 13_000, track_stock: 1, status: "active" });
  insertRow("products", { id: "oil", tenant_id: "tenant-1", name: "Oil", sku: "OIL", buying_price_cents: 20_000, selling_price_cents: 25_000, track_stock: 1, status: "active" });
  insertRow("inventory", { id: "i1", tenant_id: "tenant-1", product_id: "rice", location_id: "store", quantity: 100 });
  insertRow("inventory", { id: "i2", tenant_id: "tenant-1", product_id: "oil", location_id: "store", quantity: 10 });
  insertRow("inventory", { id: "i3", tenant_id: "tenant-1", product_id: "rice", location_id: "shop-a", quantity: 20 });
  insertRow("inventory", { id: "i4", tenant_id: "tenant-1", product_id: "oil", location_id: "shop-b", quantity: -3 });
  setTestSession({ employeeId: "emp-1", branchId: null, permissions: { reports: ["view"] } });
});

test("stock value per location, Main Store first, negative stock counts as none", () => {
  const data = getInventoryReportData({});
  // Store: 100 x 100 + 10 x 200 = 12,000. Shop A: 20 x 100 = 2,000. Shop B: -3 oil = 0.
  assert.equal(data.overview.totalStockValueCents, 1_400_000);
  assert.equal(data.overview.totalRetailValueCents, 100 * 13_000 + 10 * 25_000 + 20 * 13_000);
  assert.deepEqual(
    data.locationValueBreakdown.map((entry) => [entry.locationName, entry.isMainStore, entry.valueCents, entry.totalUnits]),
    [
      ["Main Store", true, 1_200_000, 110],
      ["Shop A", false, 200_000, 20],
      ["Shop B", false, 0, 0]
    ]
  );
  const store = data.locationValueBreakdown[0]!;
  assert.equal(store.retailValueCents, 100 * 13_000 + 10 * 25_000);
  assert.equal(store.percentOfTotal, 85.7);
  const storeSection = data.sections.find((section) => section.isMainStore)!;
  assert.equal(storeSection.stockValueCents, store.valueCents, "matches the Main Store card's own Stock Value");
});

test("a branch-scoped manager sees only their own location's value", () => {
  setTestSession({ employeeId: "emp-2", branchId: "shop-a", permissions: { reports: ["view"] } });
  const data = getInventoryReportData({});
  assert.deepEqual(data.locationValueBreakdown.map((entry) => entry.locationName), ["Shop A"]);
  assert.equal(data.overview.totalStockValueCents, 200_000);
});

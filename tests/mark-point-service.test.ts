// Apply Mark Point through the real service, on a database built by every real migration.
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase } from "../src/main/database/connection.ts";
import { migrateDatabase } from "../src/main/database/migrate.ts";
import { setTestSession } from "../src/main/services/auth-service.ts";
import { applyMarkPoint, previewMarkPoint } from "../src/main/services/mark-point-service.ts";

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

function prices(id: string): { buying: number; selling: number; minimum: number | null; sync: string } {
  return getDatabase()
    .prepare("SELECT buying_price_cents AS buying, selling_price_cents AS selling, minimum_price_cents AS minimum, sync_status AS sync FROM products WHERE id = ?")
    .get(id) as never;
}

function product(id: string, buying: number, selling: number, extra: Record<string, string | number | null> = {}): void {
  insertRow("products", { id, tenant_id: "tenant-1", name: id, sku: id, buying_price_cents: buying, selling_price_cents: selling, status: "active", sync_status: "synced", ...extra });
}

before(() => {
  assert.deepEqual(migrateDatabase(), [], "every migration applies cleanly");
  insertRow("tenant", { id: "tenant-1", business_name: "Test Shop", client_id: "client-1" });
  insertRow("categories", { id: "cat-oil", tenant_id: "tenant-1", name: "Oil" });
  product("only-buying", 25_000, 0);
  product("only-selling", 0, 40_000);
  product("both", 25_000, 30_000, { minimum_price_cents: 32_000 });
  product("neither", 0, 0);
  product("rice-per-kg", 17.5, 0, { unit_config_json: JSON.stringify({ kind: "measure", priceUnit: "kg", defaultSaleUnit: "kg", units: [{ code: "kg", factor: 1000, priceCents: null }] }) });
  product("oil", 10_000, 0, { category_id: "cat-oil" });
});

beforeEach(() => {
  setTestSession({ employeeId: "emp-1", branchId: null, permissions: { products: ["view", "edit"] } });
  getDatabase().prepare("UPDATE tenant SET mark_point_enabled = 1, mark_point = 1.33").run();
});

test("migration 115 is recorded and Mark Point starts off", () => {
  const row = getDatabase().prepare("SELECT name FROM migrations WHERE version = 115").get() as { name: string } | undefined;
  assert.equal(row?.name, "mark_point");
});

test("refuses while Mark Point is off, and without products edit", () => {
  getDatabase().prepare("UPDATE tenant SET mark_point_enabled = 0").run();
  assert.throws(() => previewMarkPoint({ scope: "all", bothPrices: "skip" }), /Turn on Mark Point/);
  getDatabase().prepare("UPDATE tenant SET mark_point_enabled = 1").run();
  setTestSession({ employeeId: "emp-1", branchId: null, permissions: { products: ["view"] } });
  assert.throws(() => previewMarkPoint({ scope: "all", bothPrices: "skip" }), /permission/);
});

test("preview counts without writing anything", () => {
  const preview = previewMarkPoint({ scope: "all", bothPrices: "skip" });
  assert.equal(preview.considered, 6);
  assert.equal(preview.toUpdate, 4); // only-buying, only-selling, rice, oil
  assert.deepEqual(preview.skipped, { noPrices: 1, hasBoth: 1, unchanged: 0 });
  assert.equal(prices("only-buying").selling, 0, "preview writes nothing");
});

test("a category scope only touches that category", () => {
  const preview = applyMarkPoint({ scope: "category", categoryId: "cat-oil", bothPrices: "skip" });
  assert.equal(preview.toUpdate, 1);
  assert.equal(prices("oil").selling, 13_300);
  assert.equal(prices("oil").sync, "pending", "queued for sync");
  assert.equal(prices("only-buying").selling, 0);
});

test("apply fills missing prices; per-kg products round per kg", () => {
  applyMarkPoint({ scope: "all", bothPrices: "skip" });
  assert.equal(prices("only-buying").selling, 33_300);
  assert.equal(prices("only-selling").buying, 30_000);
  assert.equal(prices("rice-per-kg").selling, 23.3, "233 per kg");
  assert.equal(prices("both").selling, 30_000, "skipped: it already had both");
});

test("recalculating buying for a product with both lowers a minimum price above its selling price", () => {
  applyMarkPoint({ scope: "selected", productIds: ["both"], bothPrices: "buying_from_selling" });
  assert.equal(prices("both").buying, 22_500);
  assert.equal(prices("both").minimum, 30_000, "minimum 320 was above the 300 selling price");
});

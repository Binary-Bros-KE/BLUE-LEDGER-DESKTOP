// A customer's optional company, on a database built by every real migration.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { getDatabase } from "../src/main/database/connection.ts";
import { migrateDatabase } from "../src/main/database/migrate.ts";
import { insertCustomerRow, mapCustomerRow, updateCustomerRow } from "../src/main/database/repositories/customer-repository.ts";
import { customerInputSchema } from "../src/shared/schemas/customer.ts";

function insertRow(table: string, values: Record<string, string | number | null>): void {
  const db = getDatabase();
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number; dflt_value: unknown; type: string }>;
  const row: Record<string, string | number | null> = { ...values };
  for (const column of columns) {
    if (column.name in row || !column.notnull || column.dflt_value !== null) continue;
    row[column.name] = /INT|REAL/i.test(column.type) ? 0 : `${table}-${column.name}`;
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...Object.values(row));
}

before(() => {
  assert.deepEqual(migrateDatabase(), [], "every migration applies cleanly");
  insertRow("tenant", { id: "tenant-1", business_name: "Test Shop", client_id: "client-1" });
});

test("migration 114 is recorded", () => {
  const row = getDatabase().prepare("SELECT name FROM migrations WHERE version = 114").get() as { name: string } | undefined;
  assert.equal(row?.name, "customer_company");
});

test("company is optional, saved, edited and cleared", () => {
  const withCompany = customerInputSchema.parse({ name: "Mary Wanjiru", phone: "0712345678", customerType: "retail", companyName: "  Eakha Company Ltd " });
  const created = mapCustomerRow(insertCustomerRow({ ...withCompany, id: "cust-1", tenantId: "tenant-1", customerCode: "CUST-1", locationId: null }));
  assert.equal(created.companyName, "Eakha Company Ltd");

  const renamed = mapCustomerRow(updateCustomerRow("cust-1", { ...withCompany, companyName: "Alfa Sounds" }));
  assert.equal(renamed.companyName, "Alfa Sounds");

  const without = customerInputSchema.parse({ name: "John Otieno", phone: "0722000000", customerType: "retail" });
  assert.equal(without.companyName, null);
  const cleared = customerInputSchema.parse({ ...withCompany, companyName: "" });
  assert.equal(mapCustomerRow(updateCustomerRow("cust-1", cleared)).companyName, null, "a blank company clears it");
});

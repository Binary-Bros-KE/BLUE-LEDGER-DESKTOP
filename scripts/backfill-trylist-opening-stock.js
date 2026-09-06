#!/usr/bin/env node
/**
 * One-time, one-tenant fix: TRYLIST SOLUTIONS LTD's product import (2026-09-05) never had its
 * "Stock Quantity" column mapped, so every one of the 768 imported products landed with zero
 * inventory and zero stock_movements rows — confirmed live against this exact database before
 * writing this script. This restores the real opening-stock quantities from the ORIGINAL import
 * spreadsheet (products.csv, same directory as this script — copy it here before running), matched
 * to existing products by exact product name, exactly the way createProduct's own opening-stock
 * path would (applyValidatedStockMovement / inventory-service.ts): one 'opening_stock'
 * stock_movements row + one inventory row per matched product, at the storefront location the user
 * chose (NOT Main Store) — see this script's own LOCATION_NAME.
 *
 * Per explicit user instruction: this is a one-time DATA fix only — no application code changes.
 *
 * SAFETY:
 *   - Defaults to a DRY RUN — prints exactly what it would insert and touches nothing.
 *     Pass --apply to actually write.
 *   - --apply takes a timestamped backup of the whole database file first, and does every insert
 *     inside one transaction (rolled back whole on any error).
 *   - Idempotent by construction: a product that already has ANY inventory row for the target
 *     location (quantity != 0, or a row exists at all) is skipped and reported, never double-applied
 *     — safe to re-run after a partial success or to preview again before committing.
 *   - A plain INSERT into stock_movements fires the existing trg_stock_movements_sync_ai trigger
 *     automatically, so each restored quantity queues for push on the next sync cycle exactly like a
 *     normal opening-stock entry would. inventory itself is never synced (by design — see
 *     migrate.ts's own comment on that table), so no separate queuing is needed for it.
 *
 * USAGE:
 *   node scripts/backfill-trylist-opening-stock.js                # dry run (default)
 *   node scripts/backfill-trylist-opening-stock.js --apply         # actually write
 *   node scripts/backfill-trylist-opening-stock.js --db <path>     # override the DB path
 *   node scripts/backfill-trylist-opening-stock.js --csv <path>    # override the CSV path
 */

const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const APPLY = process.argv.includes("--apply");
const dbArgIndex = process.argv.indexOf("--db");
const DB_PATH =
  dbArgIndex !== -1 && process.argv[dbArgIndex + 1]
    ? process.argv[dbArgIndex + 1]
    : path.join(os.homedir(), "AppData", "Roaming", "blue-ledger-desktop", "data", "blue-ledger.sqlite");
const csvArgIndex = process.argv.indexOf("--csv");
const CSV_PATH = csvArgIndex !== -1 && process.argv[csvArgIndex + 1] ? process.argv[csvArgIndex + 1] : path.join(__dirname, "products.csv");

// The storefront the user confirmed the physical stock actually sits at — never Main Store (a
// distribution-center concept, not where this shop's stock lives day to day).
const LOCATION_NAME = "TRYLIST SOLUTIONS";
const TENANT_NAME_EXPECTED = "TRYLIST SOLUTIONS LTD";

// Minimal RFC4180 CSV parser — good enough for this one file (handles quoted fields with embedded
// commas/quotes, e.g. `"CEILING SPEAKERS 115A  6"" 10W 0"`). No dependency needed for a one-time script.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

function backupDatabase(dbPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.pre-trylist-stock-backfill-${stamp}.bak`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH} — copy the original import spreadsheet there first (or pass --csv <path>).`);
    process.exit(1);
  }

  console.log(`Database: ${DB_PATH}`);
  console.log(`CSV: ${CSV_PATH}`);
  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (no changes will be made)"}`);
  console.log("");

  const db = new DatabaseSync(DB_PATH);

  const tenant = db.prepare("SELECT id, business_name FROM tenant LIMIT 1").get();
  if (!tenant) {
    console.error("No tenant row found — is this a real Blue Ledger database?");
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.business_name} (${tenant.id})`);
  if (tenant.business_name !== TENANT_NAME_EXPECTED) {
    console.error(
      `REFUSING TO RUN: this database's tenant is "${tenant.business_name}", not the expected "${TENANT_NAME_EXPECTED}". ` +
        `This script is scoped to one specific tenant's one-time data fix — pass --db to point at the right file if this is intentional.`
    );
    process.exit(1);
  }

  const location = db
    .prepare("SELECT id, location_name FROM locations WHERE tenant_id = ? AND location_name = ?")
    .get(tenant.id, LOCATION_NAME);
  if (!location) {
    console.error(`No location named "${LOCATION_NAME}" found for this tenant.`);
    process.exit(1);
  }
  console.log(`Target location: ${location.location_name} (${location.id})`);

  const employee = db.prepare("SELECT id, first_name, last_name FROM employees WHERE tenant_id = ? LIMIT 1").get(tenant.id);
  const performedBy = employee ? employee.id : null;
  console.log(`Performed by: ${employee ? `${employee.first_name} ${employee.last_name}` : "(none found — will record as null)"}`);
  console.log("");

  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const csvRows = parseCsv(csvText);
  const header = csvRows[0].map((h) => h.trim().toLowerCase());
  const nameCol = header.indexOf("product");
  const stockCol = header.indexOf("total stock");
  if (nameCol === -1 || stockCol === -1) {
    console.error(`CSV header missing "Product" and/or "Total Stock" columns. Found: ${header.join(", ")}`);
    process.exit(1);
  }

  const csvEntries = csvRows
    .slice(1)
    .map((r) => ({ name: (r[nameCol] || "").trim(), stock: parseInt((r[stockCol] || "0").replace(/,/g, ""), 10) }))
    .filter((e) => e.name.length > 0);

  const products = db.prepare("SELECT id, name FROM products WHERE tenant_id = ?").all(tenant.id);
  const productByName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));

  const plan = []; // { productId, name, quantity }
  const zeroInCsv = [];
  const notFoundInDb = [];
  const alreadyHasInventory = [];
  const duplicateCsvNames = [];
  const seenCsvNames = new Set();

  for (const entry of csvEntries) {
    const key = entry.name.toLowerCase();
    if (seenCsvNames.has(key)) {
      duplicateCsvNames.push(entry.name);
      continue;
    }
    seenCsvNames.add(key);

    if (!Number.isFinite(entry.stock) || entry.stock <= 0) {
      zeroInCsv.push(entry.name);
      continue;
    }

    const product = productByName.get(key);
    if (!product) {
      notFoundInDb.push(entry.name);
      continue;
    }

    const existingInventory = db
      .prepare("SELECT quantity FROM inventory WHERE product_id = ? AND location_id = ?")
      .get(product.id, location.id);
    if (existingInventory) {
      alreadyHasInventory.push({ name: entry.name, quantity: existingInventory.quantity });
      continue;
    }

    plan.push({ productId: product.id, name: entry.name, quantity: entry.stock });
  }

  console.log(`CSV rows: ${csvEntries.length}`);
  console.log(`To restore (opening_stock movement + inventory row): ${plan.length}`);
  console.log(`CSV rows with zero/blank stock (nothing to do, correct as-is): ${zeroInCsv.length}`);
  console.log(`CSV product names not found among this tenant's products (skipped): ${notFoundInDb.length}`);
  for (const name of notFoundInDb) console.log(`  - ${name}`);
  console.log(`Duplicate product names within the CSV itself (only first occurrence considered): ${duplicateCsvNames.length}`);
  for (const name of duplicateCsvNames) console.log(`  - ${name}`);
  console.log(`Products that already have an inventory row for this location (skipped, not overwritten): ${alreadyHasInventory.length}`);
  for (const item of alreadyHasInventory) console.log(`  - ${item.name} (current qty: ${item.quantity})`);
  console.log("");

  const dbProductNames = new Set(products.map((p) => p.name.trim().toLowerCase()));
  const csvNameSet = new Set(csvEntries.map((e) => e.name.trim().toLowerCase()));
  const productsNotInCsvAtAll = products.filter((p) => !csvNameSet.has(p.name.trim().toLowerCase()));
  console.log(`Products in the DB with no matching CSV row at all (left at zero stock, not this script's concern): ${productsNotInCsvAtAll.length}`);
  console.log("");

  if (plan.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (!APPLY) {
    console.log("First 10 planned entries (of the full list above):");
    for (const item of plan.slice(0, 10)) console.log(`  ${item.name}: +${item.quantity}`);
    console.log("");
    console.log("Dry run only — pass --apply to actually write these opening-stock quantities.");
    return;
  }

  const backupPath = backupDatabase(DB_PATH);
  console.log(`Backed up database to: ${backupPath}`);

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, tenant_id, product_id, location_id, movement_type, quantity_change,
        reference_type, reference_id, performed_by, notes, allocation_storefront_id, allocation_explicit,
        previous_quantity, new_quantity, created_at, sync_status
      )
      VALUES (?, ?, ?, ?, 'opening_stock', ?, 'import_correction', ?, ?, ?, NULL, 0, 0, ?, ?, 'pending')
    `);
    const insertInventory = db.prepare(`
      INSERT INTO inventory (id, tenant_id, product_id, location_id, quantity, reserved_quantity, updated_at, sync_status)
      VALUES (?, ?, ?, ?, ?, 0, ?, 'pending')
    `);

    for (const item of plan) {
      insertMovement.run(
        `movement_${randomUUID()}`,
        tenant.id,
        item.productId,
        location.id,
        item.quantity,
        item.productId,
        performedBy,
        "One-time backfill: opening stock restored from the original product import spreadsheet " +
          "(the Stock Quantity column was not mapped during the initial import on 2026-09-05).",
        item.quantity,
        now
      );
      insertInventory.run(`inventory_${randomUUID()}`, tenant.id, item.productId, location.id, item.quantity, now);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error(`Database update failed, rolled back: ${err.message}`);
    process.exit(1);
  }

  console.log(`Restored opening stock for ${plan.length} products at ${location.location_name}.`);
  console.log("These stock_movements rows are now queued in sync_outbox and will push on the next sync cycle.");
}

main();

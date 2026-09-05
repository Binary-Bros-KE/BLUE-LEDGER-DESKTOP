#!/usr/bin/env node
/**
 * One-time backfill: renames every existing product image / employee photo / storefront logo from
 * its old random pickAndStore filename to be named after its OWNING entity's own id instead (see
 * finalizeProductImagePath/finalizeEmployeePhotoPath/finalizeLocationLogoPath, image-service.ts —
 * this script replicates that exact rename algorithm directly against the SQLite file, no Electron
 * needed), then bumps updated_at on each touched row so it re-queues for push on the next sync
 * cycle. Existing rows only pick this up naturally the next time each one is individually
 * edited/saved — this script does every row at once instead of waiting for that.
 *
 * IMPORTANT: this only does anything useful on a machine where BOTH halves already exist together —
 * a product whose image_path already points at a REAL file present in this device's own
 * images/<category>/ folder. Run it on whichever device originally had the images set (the one
 * where a person actually picked each photo/logo through the app), not a different device that
 * merely synced the product/employee/location ROWS without ever having the files themselves.
 *
 * SAFETY:
 *   - Defaults to a DRY RUN — prints exactly what it would rename/update and touches nothing.
 *     Pass --apply to actually write.
 *   - --apply takes a timestamped backup of the whole database file first, and does every row
 *     update inside one transaction (rolled back whole on any error). File renames on disk happen
 *     outside that transaction (the filesystem has no equivalent), but are individually safe: each
 *     rename only touches ONE file, and a source file that's missing/unreadable is skipped and
 *     reported rather than aborting the whole run.
 *   - Idempotent by construction: a row already named after its own id is skipped every time (same
 *     as finalize()'s own no-op check), so re-running after a partial success only touches what's
 *     still outstanding.
 *
 * USAGE (run from the machine that actually has the real image files, against its own userData):
 *   node scripts/backfill-image-paths-to-entity-id.js                # dry run (default)
 *   node scripts/backfill-image-paths-to-entity-id.js --apply        # actually rename + update
 *   node scripts/backfill-image-paths-to-entity-id.js --db <path>    # override the DB path
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const APPLY = process.argv.includes("--apply");
const dbArgIndex = process.argv.indexOf("--db");
const DB_PATH =
  dbArgIndex !== -1 && process.argv[dbArgIndex + 1]
    ? process.argv[dbArgIndex + 1]
    : path.join(os.homedir(), "AppData", "Roaming", "blue-ledger-desktop", "data", "blue-ledger.sqlite");
// The images/ folder is a sibling of data/ under the same userData root — see image-service.ts's
// own createManagedImageStore (join(app.getPath("userData"), relativeDir)).
const USER_DATA_DIR = path.dirname(path.dirname(DB_PATH));

const CATEGORIES = [
  { table: "products", idColumn: "id", pathColumn: "image_path", relativeDir: "images/products", label: "product image" },
  { table: "employees", idColumn: "id", pathColumn: "photo_path", relativeDir: "images/employees", label: "employee photo" },
  { table: "locations", idColumn: "id", pathColumn: "logo_path", relativeDir: "images/locations", label: "storefront logo" }
];

function backupDatabase(dbPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.pre-image-path-backfill-${stamp}.bak`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function toPosixRelative(relativeDir, filename) {
  return `${relativeDir}/${filename}`.split("\\").join("/");
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  console.log(`Database: ${DB_PATH}`);
  console.log(`User data root: ${USER_DATA_DIR}`);
  console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (no changes will be made)"}`);
  console.log("");

  const db = new DatabaseSync(DB_PATH);

  const tenant = db.prepare("SELECT id, business_name FROM tenant LIMIT 1").get();
  if (!tenant) {
    console.error("No tenant row found — is this a real Blue Ledger database?");
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.business_name} (${tenant.id})`);
  console.log("");

  const plan = []; // { table, idColumn, id, currentPath, desiredPath, currentAbs, desiredAbs, label }
  const alreadyCorrect = [];
  const missingFile = [];
  const legacyAbsolute = [];
  const noImage = { products: 0, employees: 0, locations: 0 };

  for (const category of CATEGORIES) {
    const rows = db
      .prepare(`SELECT ${category.idColumn} AS id, ${category.pathColumn} AS current_path FROM ${category.table} WHERE tenant_id = ?`)
      .all(tenant.id);

    for (const row of rows) {
      if (!row.current_path) {
        noImage[category.table] += 1;
        continue;
      }
      if (path.isAbsolute(row.current_path)) {
        legacyAbsolute.push({ ...category, id: row.id, currentPath: row.current_path });
        continue;
      }

      const ext = path.extname(row.current_path);
      const desiredPath = toPosixRelative(category.relativeDir, `${row.id}${ext}`);
      if (row.current_path === desiredPath) {
        alreadyCorrect.push({ ...category, id: row.id, currentPath: row.current_path });
        continue;
      }

      const currentAbs = path.join(USER_DATA_DIR, row.current_path);
      const desiredAbs = path.join(USER_DATA_DIR, desiredPath);
      if (!fs.existsSync(currentAbs)) {
        missingFile.push({ ...category, id: row.id, currentPath: row.current_path, currentAbs });
        continue;
      }

      plan.push({ ...category, id: row.id, currentPath: row.current_path, desiredPath, currentAbs, desiredAbs });
    }
  }

  console.log(`To rename + re-sync: ${plan.length}`);
  for (const item of plan) {
    console.log(`  [${item.label}] ${item.id}: ${item.currentPath} -> ${item.desiredPath}`);
  }
  console.log("");
  console.log(`Already correctly named (skipped): ${alreadyCorrect.length}`);
  console.log(`Legacy absolute path, left untouched (skipped): ${legacyAbsolute.length}`);
  for (const item of legacyAbsolute) {
    console.log(`  [${item.label}] ${item.id}: ${item.currentPath}`);
  }
  console.log(`Path set but file missing on THIS device (skipped, not an error): ${missingFile.length}`);
  for (const item of missingFile) {
    console.log(`  [${item.label}] ${item.id}: ${item.currentPath} (expected at ${item.currentAbs})`);
  }
  console.log(`No image at all: ${noImage.products} products, ${noImage.employees} employees, ${noImage.locations} locations`);
  console.log("");

  if (!APPLY) {
    console.log("Dry run only — pass --apply to actually rename files and update the database.");
    return;
  }

  if (plan.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const backupPath = backupDatabase(DB_PATH);
  console.log(`Backed up database to: ${backupPath}`);

  // File renames happen first, outside the DB transaction (see this script's own SAFETY note) — a
  // rename failure for one item just skips that one item's DB update below, rather than aborting.
  const renamed = [];
  for (const item of plan) {
    try {
      fs.mkdirSync(path.dirname(item.desiredAbs), { recursive: true });
      fs.rmSync(item.desiredAbs, { force: true }); // clear any stale file already at the target name
      fs.renameSync(item.currentAbs, item.desiredAbs);
      renamed.push(item);
    } catch (err) {
      console.error(`  FAILED to rename [${item.label}] ${item.id}: ${err.message}`);
    }
  }

  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of renamed) {
      db.prepare(`UPDATE ${item.table} SET ${item.pathColumn} = ?, updated_at = ? WHERE id = ?`).run(item.desiredPath, now, item.id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error(`Database update failed, rolled back: ${err.message}`);
    process.exit(1);
  }

  console.log(`Renamed + updated ${renamed.length} of ${plan.length} planned items.`);
  console.log("These rows are now queued in sync_outbox and will push on the next sync cycle.");
}

main();

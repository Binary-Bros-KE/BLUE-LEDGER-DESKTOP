#!/usr/bin/env node
/**
 * One-time backfill: adds a supplier_balance_entries row (entry_type "purchase_ordered") for any
 * Purchase that was never tracked by the live supplier-balance feature — i.e. every Purchase
 * predates the code that calls recordSupplierBalanceEntry (or, more precisely, every Purchase with
 * no supplier_balance_entries row already referencing it).
 *
 * WHY THIS WASN'T DONE AT FEATURE-SHIP TIME (see migrate.ts's own migration-78 comment): auto-summing
 * this app's already-recorded Purchases risks DOUBLE-COUNTING against a supplier's own
 * "manual_adjustment" carry-over entry — a client typing "I owe supplier X KES 2,406,300 as at
 * 01/09/2026" almost always already accounts for every Purchase this app recorded before that date.
 * Confirmed live on the ADIA HOME APPLIANCES tenant: HILALIUM & SONS had exactly 2 untracked
 * Purchases, both dated the day BEFORE their carry-over's own "as at" date — backfilling them would
 * have overstated the client's real debt by ~KES 423,600.
 *
 * THE RULE THIS SCRIPT APPLIES (confirmed with the user, 2026-09-03): for a Purchase to be
 * backfilled, it must be:
 *   1. Not "draft" or "cancelled" (a draft never affected balance; a cancelled purchase's lifetime
 *      balance impact always nets to exactly 0 — see cancelPurchase's own comment in
 *      purchase-service.ts — so it needs neither inclusion nor exclusion logic).
 *   2. Not already referenced by a supplier_balance_entries row (reference_type='purchase' AND
 *      reference_id=<purchase id>) — that would mean the live feature already tracked it.
 *   3. Dated (ordered_at, falling back to created_at) AFTER that supplier's own earliest
 *      manual_adjustment entry, if one exists. A Purchase on or before that date is treated as
 *      already folded into the carry-over figure and is skipped, not backfilled. A supplier with NO
 *      manual_adjustment entry at all has no such exclusion — every one of its untracked Purchases
 *      gets backfilled.
 * The backfilled amount is (grand_total_cents - amount_paid_cents) — the OUTSTANDING remainder, not
 * the full order value, exactly matching what the live "purchase_ordered" + any "payment" entries
 * would net out to if the purchase had gone through the real feature.
 *
 * SAFETY:
 *   - Defaults to a DRY RUN — prints exactly what it would do and touches nothing. Pass --apply to
 *     actually write.
 *   - --apply takes a timestamped backup of the whole database file first, and does every write
 *     inside one BEGIN IMMEDIATE / COMMIT transaction (rolled back whole on any error).
 *   - Inserts through the exact same INSERT statement shape as
 *     supplier-balance-repository.ts's insertBalanceEntryRow, so the table's own
 *     trg_supplier_balance_entries_sync_ai trigger fires normally and the new entry is queued for
 *     push like any other — no separate "make it sync" step needed. suppliers.balance_cents is
 *     adjusted the same way adjustSupplierBalanceCents does (a plain local UPDATE, never itself
 *     synced — see that function's own comment).
 *   - Idempotent by construction: re-running finds every Purchase this script already backfilled now
 *     has a matching entry, and skips it.
 *
 * USAGE (run from the DESKTOP app's own machine, against its real userData SQLite file):
 *   node scripts/backfill-supplier-balance-from-purchases.js                  # dry run (default)
 *   node scripts/backfill-supplier-balance-from-purchases.js --apply         # actually write
 *   node scripts/backfill-supplier-balance-from-purchases.js --db <path>     # override the DB path
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
// Overrides the "skip if on/before the supplier's carry-over" rule for specific purchase numbers only
// — for the confirmed case where the client has actually checked and the carry-over figure does NOT
// include a particular purchase after all, so it genuinely needs backfilling despite the date overlap.
// Every other safety check (not draft/cancelled, not already tracked, not already fully paid) still
// applies in full — this only lifts the date-heuristic, and only for purchase numbers named here.
const forceArgIndex = process.argv.indexOf("--force");
const FORCE_PURCHASE_NUMBERS = new Set(
  forceArgIndex !== -1 && process.argv[forceArgIndex + 1] ? process.argv[forceArgIndex + 1].split(",").map((s) => s.trim()) : []
);

function money(cents) {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function backupDatabase(dbPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.pre-supplier-balance-backfill-${stamp}.bak`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  console.log(`Database: ${DB_PATH}`);
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

  // Earliest manual_adjustment (carry-over / correction) per supplier — the cutoff rule 3 above.
  const carryoverBySupplier = new Map();
  for (const row of db
    .prepare(
      "SELECT supplier_id, MIN(created_at) AS first_at FROM supplier_balance_entries WHERE entry_type = 'manual_adjustment' GROUP BY supplier_id"
    )
    .all()) {
    carryoverBySupplier.set(row.supplier_id, row.first_at);
  }

  const candidates = db
    .prepare(
      `
      SELECT p.id, p.purchase_number, p.supplier_id, s.business_name AS supplier_name,
             p.status, p.grand_total_cents, p.amount_paid_cents, p.ordered_at, p.created_at
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.tenant_id = ?
        AND p.status NOT IN ('draft', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM supplier_balance_entries e
          WHERE e.reference_type = 'purchase' AND e.reference_id = p.id
        )
      ORDER BY s.business_name, p.created_at
    `
    )
    .all(tenant.id);

  const toBackfill = [];
  const skipped = [];
  const forced = [];

  for (const p of candidates) {
    const outstandingCents = p.grand_total_cents - p.amount_paid_cents;
    const purchaseDate = p.ordered_at || p.created_at;
    const carryoverAt = carryoverBySupplier.get(p.supplier_id) ?? null;
    const isForced = FORCE_PURCHASE_NUMBERS.has(p.purchase_number);

    if (carryoverAt !== null && purchaseDate <= carryoverAt && !isForced) {
      skipped.push({ p, reason: `predates ${p.supplier_name}'s carry-over (${carryoverAt}) — assumed already included` });
      continue;
    }
    if (isForced && carryoverAt !== null && purchaseDate <= carryoverAt) {
      forced.push(p);
    }
    if (outstandingCents <= 0) {
      skipped.push({ p, reason: "already fully paid — nothing owed, nothing to backfill" });
      continue;
    }
    toBackfill.push({ p, outstandingCents });
  }

  const alreadyTracked = db
    .prepare(
      `
      SELECT COUNT(*) AS n FROM purchases p
      WHERE p.tenant_id = ? AND p.status NOT IN ('draft', 'cancelled')
        AND EXISTS (SELECT 1 FROM supplier_balance_entries e WHERE e.reference_type = 'purchase' AND e.reference_id = p.id)
    `
    )
    .get(tenant.id).n;

  console.log(`Purchases already tracked by the live feature: ${alreadyTracked}`);
  console.log(`Untracked candidates examined (not draft/cancelled): ${candidates.length}`);
  console.log(`  -> to backfill: ${toBackfill.length}`);
  console.log(`  -> skipped: ${skipped.length}`);
  console.log("");

  if (forced.length > 0) {
    console.log(`FORCED (--force overrode the carry-over-date rule for these, per explicit confirmation they're NOT already in the carry-over):`);
    for (const p of forced) {
      console.log(`  ${p.purchase_number} | ${p.supplier_name}`);
    }
    console.log("");
  }

  if (skipped.length > 0) {
    console.log("SKIPPED:");
    for (const { p, reason } of skipped) {
      console.log(`  ${p.purchase_number} | ${p.supplier_name} | ${money(p.grand_total_cents - p.amount_paid_cents)} outstanding | ${reason}`);
    }
    console.log("");
  }

  if (toBackfill.length === 0) {
    console.log("Nothing to backfill. No changes needed.");
    db.close();
    return;
  }

  console.log("TO BACKFILL:");
  const bySupplier = new Map();
  for (const { p, outstandingCents } of toBackfill) {
    console.log(`  ${p.purchase_number} | ${p.supplier_name} | ordered ${p.ordered_at ?? p.created_at} | +${money(outstandingCents)}`);
    bySupplier.set(p.supplier_id, (bySupplier.get(p.supplier_id) ?? 0) + outstandingCents);
  }
  console.log("");
  console.log("Per-supplier total to add:");
  for (const [supplierId, totalCents] of bySupplier) {
    const name = toBackfill.find((r) => r.p.supplier_id === supplierId).p.supplier_name;
    console.log(`  ${name}: +${money(totalCents)}`);
  }
  console.log("");

  if (!APPLY) {
    console.log("Dry run only — re-run with --apply to actually write these entries.");
    db.close();
    return;
  }

  const backupPath = backupDatabase(DB_PATH);
  console.log(`Backed up database to: ${backupPath}`);

  const now = new Date().toISOString();
  try {
    db.exec("BEGIN IMMEDIATE;");
    const insertEntry = db.prepare(`
      INSERT INTO supplier_balance_entries (
        id, tenant_id, supplier_id, entry_type, amount_cents, reference_type, reference_id, notes, performed_by, created_at
      ) VALUES (?, ?, ?, 'purchase_ordered', ?, 'purchase', ?, ?, NULL, ?)
    `);
    const adjustBalance = db.prepare("UPDATE suppliers SET balance_cents = balance_cents + ? WHERE id = ?");

    for (const { p, outstandingCents } of toBackfill) {
      const id = `supplier_balance_${randomUUID()}`;
      const notes = FORCE_PURCHASE_NUMBERS.has(p.purchase_number)
        ? `Backfilled ${now.slice(0, 10)}: purchase ${p.purchase_number}, confirmed with the client NOT already included in the carry-over balance despite predating it.`
        : `Backfilled ${now.slice(0, 10)}: purchase ${p.purchase_number} recorded before supplier balance tracking began for this supplier.`;
      insertEntry.run(id, tenant.id, p.supplier_id, outstandingCents, p.id, notes, now);
      adjustBalance.run(outstandingCents, p.supplier_id);
    }
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error("Failed — rolled back, database unchanged. Backup is still at", backupPath);
    throw err;
  }

  console.log(`Done. Inserted ${toBackfill.length} entries across ${bySupplier.size} supplier(s).`);
  console.log("Each new entry fired the normal sync trigger and is now queued to push on the next sync cycle.");

  db.close();
}

main();

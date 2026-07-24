/**
 * One-off verification script for the bulk Import feature — NOT part of the normal app, temporary
 * scaffolding deleted once verified. Only runs when bootstrap.ts sees BLUE_LEDGER_VERIFY_IMPORT=1,
 * against whatever DB BLUE_LEDGER_DATA_DIR points at (a SCRATCH COPY of the real DB — see that env
 * var's own doc comment in main/index.ts; never point this at the live file). Exercises
 * previewImport/commitImport directly through the real service layer via setSessionForSeeding,
 * covering: a new row (create), a row matching an existing SKU (update), a bad category name, an
 * ambiguous category name (seeded here), a missing required field, an in-file duplicate SKU, and a
 * second commit of the same fixture to confirm idempotency (create -> update, not a crash).
 */
import * as categoryRepository from "@main/database/repositories/category-repository";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import { setSessionForSeeding } from "@main/services/auth-service";
import { createCategory } from "@main/services/category-service";
import { commitImport, previewImport } from "@main/services/import-service";
import { getCurrentTenant } from "@main/services/tenant-service";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  console.log(`  ok: ${message} (${JSON.stringify(actual)})`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

const HEADERS = ["sku", "name", "category", "buying", "selling"];

function row(sku: string, name: string, category: string, buying: string, selling: string): Record<string, string> {
  return { sku, name, category, buying, selling };
}

const COLUMN_MAPPING = {
  sku: "sku",
  name: "name",
  category: "category",
  buyingPriceCents: "buying",
  sellingPriceCents: "selling"
};

export async function verifyImport(): Promise<void> {
  const { tenantId } = getCurrentTenant();

  const systemEmployee = employeeRepository.findEmployeeByCodeRow(tenantId, "SYSTEM");
  if (!systemEmployee) throw new Error("verify-import: SYSTEM employee not found in this DB copy");
  setSessionForSeeding(systemEmployee.id);
  console.log("[verify-import] Signed in as SYSTEM for a fully-permissioned session.");

  const existingProducts = productRepository.findAllProductRows(tenantId, null);
  const existingSku = existingProducts[0]?.sku;
  if (!existingSku) throw new Error("verify-import: no existing products in this DB copy to test update against");
  console.log(`[verify-import] Will test 'update' against real existing SKU: ${existingSku}`);

  // Seed an ambiguous category name: same name, two different parents.
  const parentA = createCategory({ name: "VerifyParentA", description: null, color: "#123456", sortOrder: 0, parentId: null });
  const parentB = createCategory({ name: "VerifyParentB", description: null, color: "#123456", sortOrder: 0, parentId: null });
  createCategory({ name: "VerifyAmbiguousXYZ", description: null, color: "#123456", sortOrder: 0, parentId: parentA.id });
  createCategory({ name: "VerifyAmbiguousXYZ", description: null, color: "#123456", sortOrder: 0, parentId: parentB.id });

  const ambiguousMatches = categoryRepository.findCategoryRowsByName(tenantId, "VerifyAmbiguousXYZ");
  assertEqual(ambiguousMatches.length, 2, "findCategoryRowsByName returns both same-named categories under different parents");
  const nonexistentMatches = categoryRepository.findCategoryRowsByName(tenantId, "ZZZ-Does-Not-Exist");
  assertEqual(nonexistentMatches.length, 0, "findCategoryRowsByName returns nothing for a name that doesn't exist");

  console.log("[verify-import] Building fixture (7 rows: create, update, bad category, ambiguous category, missing name, duplicate pair)...");

  const rows: Array<Record<string, string>> = [
    row("VERIFY-NEW-001", "Verify New Product", "", "100", "150"),
    row(existingSku, "Verify Updated Name", "", "200", "250"),
    row("VERIFY-BADCAT-001", "Verify Bad Category", "ZZZ-Does-Not-Exist", "100", "150"),
    row("VERIFY-AMBIG-001", "Verify Ambiguous Category", "VerifyAmbiguousXYZ", "100", "150"),
    row("VERIFY-MISSNAME-001", "", "", "100", "150"),
    row("VERIFY-DUP-001", "Verify Duplicate A", "", "100", "150"),
    row("VERIFY-DUP-001", "Verify Duplicate B", "", "100", "150")
  ];

  const previewRequest = { entityType: "products" as const, rows, columnMapping: COLUMN_MAPPING, moneyInCents: false };
  const preview1 = previewImport(previewRequest);

  assertEqual(preview1.mappingErrors.length, 0, "no mapping errors (all required fields mapped)");
  assertEqual(preview1.summary.toCreate, 2, "preview #1: 2 rows classify as create (new + first of duplicate pair)");
  assertEqual(preview1.summary.toUpdate, 1, "preview #1: 1 row classifies as update (existing SKU)");
  assertEqual(preview1.summary.invalid, 4, "preview #1: 4 rows classify as error");

  const badCategoryRow = preview1.rows.find((r) => r.rowNumber === 3)!;
  assert(badCategoryRow.errors.some((e) => e.includes("was not found")), "bad category row errors with 'was not found'");

  const ambiguousRow = preview1.rows.find((r) => r.rowNumber === 4)!;
  assert(ambiguousRow.errors.some((e) => e.includes("matches") && e.includes("categories")), "ambiguous category row errors with 'matches N categories'");

  const missingNameRow = preview1.rows.find((r) => r.rowNumber === 5)!;
  assert(missingNameRow.errors.some((e) => e.includes("required")), "missing name row errors with 'is required'");

  const dupSecondRow = preview1.rows.find((r) => r.rowNumber === 7)!;
  assert(dupSecondRow.errors.some((e) => e.includes("Duplicate")), "second duplicate-SKU row errors with 'Duplicate'");
  const dupFirstRow = preview1.rows.find((r) => r.rowNumber === 6)!;
  assertEqual(dupFirstRow.action, "create", "first occurrence of the duplicate SKU stays classified as create");

  console.log("[verify-import] Committing fixture #1...");
  const commit1 = commitImport(previewRequest);
  assertEqual(commit1.created, 2, "commit #1: 2 created");
  assertEqual(commit1.updated, 1, "commit #1: 1 updated");
  assertEqual(commit1.skipped, 4, "commit #1: 4 skipped");
  assertEqual(commit1.failed, 0, "commit #1: 0 failed");
  assertEqual(commit1.errors.length, 4, "commit #1: 4 error entries reported");

  const createdRow = productRepository.findProductBySkuRow(tenantId, "VERIFY-NEW-001");
  assert(!!createdRow, "VERIFY-NEW-001 actually exists in the DB after commit");
  const updatedRow = productRepository.findProductBySkuRow(tenantId, existingSku);
  assertEqual(updatedRow?.name, "Verify Updated Name", "existing SKU's name was actually updated");
  const badCategoryProduct = productRepository.findProductBySkuRow(tenantId, "VERIFY-BADCAT-001");
  assert(!badCategoryProduct, "bad-category row produced NO database write");
  const missingNameProduct = productRepository.findProductBySkuRow(tenantId, "VERIFY-MISSNAME-001");
  assert(!missingNameProduct, "missing-name row produced NO database write");

  console.log("[verify-import] Re-running the SAME fixture (idempotency check)...");
  const preview2 = previewImport(previewRequest);
  assertEqual(preview2.summary.toCreate, 0, "preview #2: 0 rows now classify as create (already imported)");
  assertEqual(preview2.summary.toUpdate, 3, "preview #2: previously-created rows now classify as update");
  assertEqual(preview2.summary.invalid, 4, "preview #2: the same 4 rows still classify as error");

  const commit2 = commitImport(previewRequest);
  assertEqual(commit2.created, 0, "commit #2: 0 created (idempotent)");
  assertEqual(commit2.updated, 3, "commit #2: 3 updated, no duplicate-SKU crash");
  assertEqual(commit2.failed, 0, "commit #2: 0 failed");

  console.log("[verify-import] ALL CHECKS PASSED.");
}

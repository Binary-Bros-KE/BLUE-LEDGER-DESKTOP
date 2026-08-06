import { randomUUID } from "node:crypto";
import * as expenseCategoryRepository from "@main/database/repositories/expense-category-repository";
import { requirePermission, requireSignedIn } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { expenseCategoryInputSchema } from "@shared/schemas/expense-category";
import type { ExpenseCategory, ExpenseCategoryStatus } from "@shared/types/expense-category";

const DEFAULT_EXPENSE_CATEGORIES = ["Utilities", "Transport", "Marketing", "Salary", "Repairs", "Miscellaneous"];

/**
 * Seeds the default expense categories the first time a tenant has none at all. Called once from
 * app bootstrap (before anyone is signed in), mirroring the default-payment-methods seed —
 * listExpenseCategories() is permission-gated, so seeding can't live there without a chicken-and-egg
 * deadlock on a brand new install.
 */
export function ensureDefaultExpenseCategories(tenantId: string): void {
  const existing = expenseCategoryRepository.findAllExpenseCategoryRows(tenantId);
  if (existing.length > 0) return;

  for (const name of DEFAULT_EXPENSE_CATEGORIES) {
    expenseCategoryRepository.insertExpenseCategoryRow({
      id: `expense_category_${randomUUID()}`,
      tenantId,
      name,
      description: null
    });
  }
}

/** Used by internal auto-booking flows (e.g. the delivery-cost expense created alongside a sale/
 * invoice) that need a category to exist but have no user in the loop to pick or create one —
 * unlike createExpenseCategory, this never throws on a name collision, it just returns the
 * existing row. Case-insensitive, matching the table's own unique index. */
export function findOrCreateExpenseCategoryByName(tenantId: string, name: string): ExpenseCategory {
  const existing = expenseCategoryRepository.findExpenseCategoryByNameRow(tenantId, name);
  if (existing) return expenseCategoryRepository.mapExpenseCategoryRow(existing);

  const row = expenseCategoryRepository.insertExpenseCategoryRow({
    id: `expense_category_${randomUUID()}`,
    tenantId,
    name,
    description: null
  });
  return expenseCategoryRepository.mapExpenseCategoryRow(row);
}

function assertUniqueName(tenantId: string, name: string, excludeId?: string): void {
  if (expenseCategoryRepository.findExpenseCategoryByNameRow(tenantId, name, excludeId)) {
    throw new Error(`A category named "${name}" already exists`);
  }
}

/** Every signed-in employee can read the list — choosing a category is part of recording an expense,
 * which is already gated by its own permission. Managing categories (create/edit/status) below
 * remains gated behind the "expense_categories" permission. */
export function listExpenseCategories(): ExpenseCategory[] {
  requireSignedIn();
  const { tenantId } = getCurrentTenant();
  return expenseCategoryRepository
    .findAllExpenseCategoryRows(tenantId)
    .map(expenseCategoryRepository.mapExpenseCategoryRow);
}

export function createExpenseCategory(input: unknown): ExpenseCategory {
  requirePermission("expense_categories", "create");
  const parsed = expenseCategoryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  assertUniqueName(tenantId, parsed.name);

  const row = expenseCategoryRepository.insertExpenseCategoryRow({
    ...parsed,
    id: `expense_category_${randomUUID()}`,
    tenantId
  });
  return expenseCategoryRepository.mapExpenseCategoryRow(row);
}

export function updateExpenseCategory(id: string, input: unknown): ExpenseCategory {
  requirePermission("expense_categories", "edit");
  const parsed = expenseCategoryInputSchema.parse(input);
  const existing = expenseCategoryRepository.findExpenseCategoryRowById(id);
  if (!existing) {
    throw new Error("Expense category not found");
  }

  assertUniqueName(existing.tenant_id, parsed.name, id);

  const row = expenseCategoryRepository.updateExpenseCategoryRow(id, parsed);
  return expenseCategoryRepository.mapExpenseCategoryRow(row);
}

/** Categories are never permanently deleted — expenses reference them by id, so only their
 * visibility toggles. Inactive categories drop out of selection lists but existing expenses keep
 * displaying their category name normally. */
export function setExpenseCategoryStatus(id: string, status: ExpenseCategoryStatus): ExpenseCategory {
  requirePermission("expense_categories", "edit");
  const row = expenseCategoryRepository.setExpenseCategoryStatusRow(id, status);
  return expenseCategoryRepository.mapExpenseCategoryRow(row);
}

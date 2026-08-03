import { randomUUID } from "node:crypto";
import * as expenseCategoryRepository from "@main/database/repositories/expense-category-repository";
import * as expenseRepository from "@main/database/repositories/expense-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { deleteManagedExpenseAttachment } from "@main/services/image-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { expenseInputSchema, type ExpenseInput } from "@shared/schemas/expense";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import type { Expense, ExpenseSummary } from "@shared/types/expense";

function generateExpenseNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "EXP",
    digits: 6,
    existingNumbers: expenseRepository.findMaxExpenseNumberRow(tenantId)
  });
}

// Exported for local-purchase-service.ts to reuse verbatim — same table, same validation rules,
// just a different `kind` and permission module gating who can call in.
export function assertCategoryExists(tenantId: string, categoryId: string): void {
  const row = expenseCategoryRepository.findExpenseCategoryRowById(categoryId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Expense category not found");
  }
}

export function assertStorefrontBelongsToTenant(tenantId: string, storefrontId: string): void {
  const row = locationRepository.findLocationRowById(storefrontId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Selected storefront was not found");
  }
}

/** A branch-scoped caller (a Manager) can only ever record or edit an expense against THEIR OWN
 * storefront — never a different one. Only Super Admin (no branch assigned) can pick freely. */
export function assertExpenseStorefrontAssignmentAllowed(storefrontId: string, branchScope: string | null): void {
  if (!branchScope) return;
  if (storefrontId !== branchScope) {
    throw new Error("You can only record expenses for your own storefront");
  }
}

export function assertValidPaymentMethod(tenantId: string, input: ExpenseInput): void {
  const method = paymentMethodRepository.findPaymentMethodRowById(input.paymentMethodId);
  if (!method || method.tenant_id !== tenantId) {
    throw new Error("Payment method not found");
  }
  if (!method.is_active) {
    throw new Error(`"${method.name}" is not active`);
  }
  if (method.requires_reference && !input.reference) {
    throw new Error(`${method.name} requires a transaction/reference number`);
  }
}

/**
 * Retroactively assigns a real storefront to any expense created before "General/Head Office" (a
 * null storefront) was removed — picked randomly per row, since there's no way to know after the
 * fact which storefront actually incurred it. New expenses can no longer be created without one
 * (expenseInputSchema requires it). Safe every boot: a no-op once no expense has a null storefront.
 */
export function ensureExpensesHaveStorefront(tenantId: string): void {
  const ids = expenseRepository.findExpenseIdsWithoutStorefront(tenantId);
  if (ids.length === 0) return;

  const storefronts = locationRepository
    .findAllLocationRows(tenantId)
    .filter((row) => isStorefrontType(row.location_type as LocationType) && row.status === "active");
  if (storefronts.length === 0) return;

  for (const id of ids) {
    const randomStorefront = storefronts[Math.floor(Math.random() * storefronts.length)];
    if (!randomStorefront) continue;
    expenseRepository.setExpenseStorefrontRow(id, randomStorefront.id);
  }
}

function getExpenseDetail(id: string): Expense {
  const row = expenseRepository.findExpenseDetailRowById(id);
  if (!row) {
    throw new Error("Expense not found");
  }
  return expenseRepository.mapExpenseDetailRow(row);
}

/** Tenant-wide by default; branch-scoped to the caller's assigned location like Sales/Purchases. */
export function listExpenses(): Expense[] {
  requirePermission("expenses", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  // Unfiltered (null kind) deliberately — whoever holds "expenses" needs full financial visibility,
  // including local purchases, not just formal ones. Local Purchases' own view is the narrow one.
  return expenseRepository
    .findAllExpenseDetailRows(tenantId, locationId, null)
    .map(expenseRepository.mapExpenseDetailRow);
}

export function getExpenseSummary(): ExpenseSummary {
  requirePermission("expenses", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  const totals = expenseRepository.findExpenseSummaryRow(tenantId, locationId, null);
  const byCategory = expenseRepository
    .findExpenseCategoryBreakdownRows(tenantId, locationId, null)
    .map(expenseRepository.mapExpenseCategoryBreakdownRow);

  return {
    todayCents: totals.today_cents,
    thisMonthCents: totals.this_month_cents,
    totalCents: totals.total_cents,
    byCategory
  };
}

export function getExpense(id: string): Expense {
  requirePermission("expenses", "view");
  const expense = getExpenseDetail(id);
  assertExpenseStorefrontAssignmentAllowed(expense.storefrontId, getCurrentBranchScope());
  return expense;
}

export function createExpense(input: unknown): Expense {
  requirePermission("expenses", "create");
  const parsed: ExpenseInput = expenseInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();

  assertCategoryExists(tenantId, parsed.categoryId);
  assertStorefrontBelongsToTenant(tenantId, parsed.storefrontId);
  assertExpenseStorefrontAssignmentAllowed(parsed.storefrontId, getCurrentBranchScope());
  assertValidPaymentMethod(tenantId, parsed);

  const row = expenseRepository.insertExpenseRow({
    ...parsed,
    id: `expense_${randomUUID()}`,
    tenantId,
    kind: "general",
    expenseNumber: generateExpenseNumber(tenantId),
    createdBy: employeeId
  });
  return getExpenseDetail(row.id);
}

function requireEditableExpense(id: string, tenantId: string): expenseRepository.ExpenseRow {
  const row = expenseRepository.findExpenseRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Expense not found");
  }
  if (row.status === "archived") {
    throw new Error("Archived expenses can't be edited — restore it first");
  }
  return row;
}

export function updateExpense(id: string, input: unknown): Expense {
  requirePermission("expenses", "edit");
  const parsed: ExpenseInput = expenseInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const existing = requireEditableExpense(id, tenantId);
  const branchScope = getCurrentBranchScope();
  assertExpenseStorefrontAssignmentAllowed(existing.storefront_id as string, branchScope);

  assertCategoryExists(tenantId, parsed.categoryId);
  assertStorefrontBelongsToTenant(tenantId, parsed.storefrontId);
  assertExpenseStorefrontAssignmentAllowed(parsed.storefrontId, branchScope);
  assertValidPaymentMethod(tenantId, parsed);

  if (existing.attachment_path && existing.attachment_path !== parsed.attachmentPath) {
    deleteManagedExpenseAttachment(existing.attachment_path);
  }

  const row = expenseRepository.updateExpenseRow(id, parsed);
  return getExpenseDetail(row.id);
}

/** The soft-delete path — hides the expense from normal views while keeping the financial record
 * intact for audit. Use this once an expense has been synced or might be referenced elsewhere. */
export function archiveExpense(id: string): Expense {
  requirePermission("expenses", "delete");
  assertExpenseStorefrontAssignmentAllowed(getExpenseDetail(id).storefrontId, getCurrentBranchScope());
  const row = expenseRepository.setExpenseStatusRow(id, "archived");
  return getExpenseDetail(row.id);
}

export function restoreExpense(id: string): Expense {
  requirePermission("expenses", "edit");
  assertExpenseStorefrontAssignmentAllowed(getExpenseDetail(id).storefrontId, getCurrentBranchScope());
  const row = expenseRepository.setExpenseStatusRow(id, "active");
  return getExpenseDetail(row.id);
}

/** Permanent deletion is only allowed for expenses that have never synced — once a record has gone
 * to sync (or later, once accounting modules can reference it), archiving is the only option so the
 * financial trail is never silently erased. */
export function deleteExpense(id: string): { id: string } {
  requirePermission("expenses", "delete");
  const { tenantId } = getCurrentTenant();
  const row = expenseRepository.findExpenseRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Expense not found");
  }
  assertExpenseStorefrontAssignmentAllowed(row.storefront_id as string, getCurrentBranchScope());
  if (row.sync_status !== "pending") {
    throw new Error("This expense has already been synchronized — archive it instead of deleting");
  }

  if (row.attachment_path) {
    deleteManagedExpenseAttachment(row.attachment_path);
  }
  expenseRepository.deleteExpenseRow(id);
  return { id };
}

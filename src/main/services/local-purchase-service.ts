import { randomUUID } from "node:crypto";
import * as expenseRepository from "@main/database/repositories/expense-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { deleteManagedExpenseAttachment } from "@main/services/image-service";
import {
  assertCategoryExists,
  assertExpenseStorefrontAssignmentAllowed,
  assertStorefrontBelongsToTenant,
  assertValidPaymentMethod
} from "@main/services/expense-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { expenseInputSchema, type ExpenseInput } from "@shared/schemas/expense";
import type { Expense, ExpenseSummary } from "@shared/types/expense";

/**
 * "Local Purchases" — the small day-to-day buys (tape, delivery bags, a pen) a cashier is usually
 * the one sent out for. Deliberately reuses the exact same `expenses` table, repository, and
 * validation rules as formal expenses (see expense-service.ts) rather than a whole parallel entity
 * — the only things that differ are the "local_purchases" permission module (so a cashier granted
 * this never automatically gets "expenses" itself) and the `kind` column every query here filters
 * on. That filter is what actually enforces the separation — a cashier has no code path here that
 * can ever return, or act on, a 'general' expense row, not just a hidden UI section.
 */

function generateLocalPurchaseNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "LP",
    digits: 6,
    existingNumbers: expenseRepository.findMaxLocalPurchaseNumberRow(tenantId)
  });
}

function getLocalPurchaseDetail(id: string): Expense {
  const row = expenseRepository.findExpenseDetailRowById(id);
  if (!row || row.kind !== "local_purchase") {
    throw new Error("Local purchase not found");
  }
  return expenseRepository.mapExpenseDetailRow(row);
}

/** Tenant-wide by default; branch-scoped to the caller's assigned location like Expenses/Sales. */
export function listLocalPurchases(): Expense[] {
  requirePermission("local_purchases", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return expenseRepository
    .findAllExpenseDetailRows(tenantId, locationId, "local_purchase")
    .map(expenseRepository.mapExpenseDetailRow);
}

export function getLocalPurchaseSummary(): ExpenseSummary {
  requirePermission("local_purchases", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  const totals = expenseRepository.findExpenseSummaryRow(tenantId, locationId, "local_purchase");
  const byCategory = expenseRepository
    .findExpenseCategoryBreakdownRows(tenantId, locationId, "local_purchase")
    .map(expenseRepository.mapExpenseCategoryBreakdownRow);

  return {
    todayCents: totals.today_cents,
    thisMonthCents: totals.this_month_cents,
    totalCents: totals.total_cents,
    byCategory
  };
}

export function getLocalPurchase(id: string): Expense {
  requirePermission("local_purchases", "view");
  const purchase = getLocalPurchaseDetail(id);
  assertExpenseStorefrontAssignmentAllowed(purchase.storefrontId, getCurrentBranchScope());
  return purchase;
}

export function createLocalPurchase(input: unknown): Expense {
  requirePermission("local_purchases", "create");
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
    kind: "local_purchase",
    expenseNumber: generateLocalPurchaseNumber(tenantId),
    createdBy: employeeId
  });
  return getLocalPurchaseDetail(row.id);
}

function requireEditableLocalPurchase(id: string, tenantId: string): expenseRepository.ExpenseRow {
  const row = expenseRepository.findExpenseRowById(id);
  if (!row || row.tenant_id !== tenantId || row.kind !== "local_purchase") {
    throw new Error("Local purchase not found");
  }
  if (row.status === "archived") {
    throw new Error("Archived local purchases can't be edited — restore it first");
  }
  return row;
}

export function updateLocalPurchase(id: string, input: unknown): Expense {
  requirePermission("local_purchases", "edit");
  const parsed: ExpenseInput = expenseInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const existing = requireEditableLocalPurchase(id, tenantId);
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
  return getLocalPurchaseDetail(row.id);
}

/** The soft-delete path — hides the local purchase from normal views while keeping the financial
 * record intact for audit. Use this once a local purchase has been synced or might be referenced
 * elsewhere — same reasoning as archiveExpense. */
export function archiveLocalPurchase(id: string): Expense {
  requirePermission("local_purchases", "delete");
  assertExpenseStorefrontAssignmentAllowed(getLocalPurchaseDetail(id).storefrontId, getCurrentBranchScope());
  const row = expenseRepository.setExpenseStatusRow(id, "archived");
  return getLocalPurchaseDetail(row.id);
}

export function restoreLocalPurchase(id: string): Expense {
  requirePermission("local_purchases", "edit");
  assertExpenseStorefrontAssignmentAllowed(getLocalPurchaseDetail(id).storefrontId, getCurrentBranchScope());
  const row = expenseRepository.setExpenseStatusRow(id, "active");
  return getLocalPurchaseDetail(row.id);
}

/** Permanent deletion is only allowed for a local purchase that has never synced — once it's gone
 * to sync, archiving is the only option so the financial trail (and the cloud copy — this sync
 * system has no delete propagation) is never silently orphaned. Same reasoning as deleteExpense. */
export function deleteLocalPurchase(id: string): { id: string } {
  requirePermission("local_purchases", "delete");
  const { tenantId } = getCurrentTenant();
  const row = expenseRepository.findExpenseRowById(id);
  if (!row || row.tenant_id !== tenantId || row.kind !== "local_purchase") {
    throw new Error("Local purchase not found");
  }
  assertExpenseStorefrontAssignmentAllowed(row.storefront_id as string, getCurrentBranchScope());
  if (row.sync_status !== "pending") {
    throw new Error("This local purchase has already been synchronized — archive it instead of deleting");
  }

  if (row.attachment_path) {
    deleteManagedExpenseAttachment(row.attachment_path);
  }
  expenseRepository.deleteExpenseRow(id);
  return { id };
}

import { randomUUID } from "node:crypto";
import * as expenseCategoryRepository from "@main/database/repositories/expense-category-repository";
import * as expenseRepository from "@main/database/repositories/expense-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as riderRepository from "@main/database/repositories/rider-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { findOrCreateExpenseCategoryByName } from "@main/services/expense-category-service";
import { deleteManagedExpenseAttachment } from "@main/services/image-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import type { DeliveryInput } from "@shared/schemas/charges";
import { expenseInputSchema, type ExpenseInput } from "@shared/schemas/expense";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import type { Expense, ExpenseSummary } from "@shared/types/expense";

/** Name of the auto-created category used by createDeliveryCostExpenseIfNeeded — deliberately a
 * plain constant, not tenant-configurable, matching the client's own naming ask verbatim. */
const DELIVERY_COST_CATEGORY_NAME = "Delivery Costs";

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

/** Encodes exactly what the client asked for into the expense's own description field (expenses
 * have no separate "notes" field — description is the closest, free-text, 1000-char one) so the
 * delivery cost record is self-explanatory on its own, without needing to cross-reference the
 * originating sale/invoice: which document it came from, who the customer was, and the delivery's
 * own recipient/address/rider — the same fields a staff member would want if reviewing this expense
 * weeks later with no other context open. */
function buildDeliveryExpenseDescription(params: {
  documentNumber: string | null;
  customerName: string | null;
  delivery: DeliveryInput;
}): string {
  const lines: string[] = [];
  if (params.documentNumber) lines.push(`Sale: ${params.documentNumber}`);
  lines.push(`Customer: ${params.customerName ?? "Walk-in Customer"}`);
  lines.push(`Delivered To: ${params.delivery.recipientName}`);
  const addressParts = [params.delivery.physicalAddress, params.delivery.town, params.delivery.country].filter(
    (part): part is string => Boolean(part)
  );
  if (addressParts.length > 0) lines.push(`Address: ${addressParts.join(", ")}`);
  if (params.delivery.riderId) {
    const rider = riderRepository.findRiderRowById(params.delivery.riderId);
    if (rider) lines.push(`Rider: ${rider.name}`);
  }
  if (params.delivery.notes) lines.push(`Notes: ${params.delivery.notes}`);
  return lines.join("\n");
}

/** Falls back to the tenant's own "Cash" payment method — matching how a delivery cost (paid to a
 * rider or courier, out of pocket) is almost always actually settled in practice — then to whatever
 * active payment method exists at all, for the cases createDeliveryCostExpenseIfNeeded now has no
 * document payment to go on (an invoice with no payment yet, a quotation-to-invoice conversion,
 * duplicateInvoice). Every tenant has "Cash" seeded by ensureDefaultPaymentMethods at bootstrap, so
 * the final `null` (genuinely no payment method exists at all) should never actually happen in
 * practice — it's there only so this can never throw. */
function resolveDeliveryExpensePaymentMethodId(tenantId: string, paymentMethodId: string | null): string | null {
  if (paymentMethodId) return paymentMethodId;
  const cash = paymentMethodRepository.findPaymentMethodByCodeRow(tenantId, "CASH");
  if (cash && cash.is_active) return cash.id;
  const anyActive = paymentMethodRepository.findAllPaymentMethodRows(tenantId).find((row) => row.is_active);
  return anyActive?.id ?? null;
}

/**
 * Auto-books the seller's own delivery cost as a real, auditable "Delivery Costs" expense the
 * moment a sale/invoice/quotation-conversion with a delivery is created (or a delivery is attached
 * afterward) — a client-requested alternative to the old behavior of folding delivery cost into a
 * flat, uncategorized "hidden cost" figure on the Sales Report (see report-service.ts's own comment
 * on totalExpensesCents, which no longer counts delivery cost separately to avoid double-deducting
 * it now that it lands here instead). Bypasses requirePermission/getCurrentEmployeeId deliberately —
 * this runs as a side effect of a sale/invoice a cashier just created inside its own transaction, not
 * a standalone user action, so it must not fail just because that cashier individually lacks
 * "expenses:create".
 *
 * Books UNCONDITIONALLY once there's a cost, regardless of the invoice's own payment status — a
 * deliberate client decision: recording a delivery cost means money has already gone out (to a
 * rider, a courier, fuel) the moment it's recorded, whether or not the CUSTOMER has paid the invoice
 * yet. (The delivery FEE charged to the customer is a separate figure that's already folded into the
 * document's own total — nothing to do here.) When the document itself has no payment method to
 * point to (an invoice with no initial payment, a quotation converting straight to invoice, a
 * duplicated invoice), falls back via resolveDeliveryExpensePaymentMethodId instead of skipping.
 *
 * Only genuinely skipped when there's no cost at all. Never called for a delivery still attached to
 * a QUOTATION (as opposed to a sale/invoice) — nothing has actually shipped yet at that stage; the
 * cost only becomes a real expense once/if the quotation converts (see persistCartExtras and
 * quotation-service.ts's buildConversionCart, which is what carries the delivery over into the
 * resulting sale/invoice and triggers this).
 */
export function createDeliveryCostExpenseIfNeeded(params: {
  tenantId: string;
  documentNumber: string | null;
  customerName: string | null;
  delivery: DeliveryInput;
  locationId: string;
  employeeId: string;
  paymentMethodId: string | null;
  date: string;
}): void {
  if (params.delivery.costCents <= 0) return;
  const paymentMethodId = resolveDeliveryExpensePaymentMethodId(params.tenantId, params.paymentMethodId);
  if (!paymentMethodId) return;

  const category = findOrCreateExpenseCategoryByName(params.tenantId, DELIVERY_COST_CATEGORY_NAME);

  expenseRepository.insertExpenseRow({
    id: `expense_${randomUUID()}`,
    tenantId: params.tenantId,
    kind: "general",
    expenseNumber: generateExpenseNumber(params.tenantId),
    createdBy: params.employeeId,
    expenseDate: params.date.slice(0, 10),
    categoryId: category.id,
    amountCents: params.delivery.costCents,
    paidBy: null,
    paymentMethodId,
    storefrontId: params.locationId,
    reference: null,
    description: buildDeliveryExpenseDescription(params),
    attachmentPath: null
  });
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

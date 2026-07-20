import { addDays, addMonths, addQuarters, addWeeks, addYears } from "date-fns";
import * as recurringBillRepository from "@main/database/repositories/recurring-bill-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, getCurrentEmployeeName, requirePermission } from "@main/services/auth-service";
import { createExpense } from "@main/services/expense-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import {
  recurringBillInputSchema,
  recurringBillMarkPaidInputSchema,
  type RecurringBillInput
} from "@shared/schemas/recurring-bill";
import type { Expense } from "@shared/types/expense";
import type { RecurringBill, RecurringBillCycle, RecurringBillReminderStatus, RecurringBillStatus } from "@shared/types/recurring-bill";

function advanceDateByCycle(dateIso: string, cycle: RecurringBillCycle): string {
  const date = new Date(dateIso);
  const next =
    cycle === "daily"
      ? addDays(date, 1)
      : cycle === "weekly"
        ? addWeeks(date, 1)
        : cycle === "monthly"
          ? addMonths(date, 1)
          : cycle === "quarterly"
            ? addQuarters(date, 1)
            : addYears(date, 1);
  return next.toISOString().slice(0, 10);
}

function reminderStatusFor(nextDueDate: string): { reminderStatus: RecurringBillReminderStatus; daysUntilDue: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDueDate);
  due.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const reminderStatus: RecurringBillReminderStatus = daysUntilDue < 0 ? "overdue" : daysUntilDue <= 7 ? "due_soon" : "upcoming";
  return { reminderStatus, daysUntilDue };
}

/** A branch-scoped caller (a Manager) can only ever schedule, edit, push, mark paid, or delete a
 * recurring bill for THEIR OWN storefront — never a different one. Only Super Admin (no branch
 * assigned) can act across branches. */
function assertBillStorefrontAssignmentAllowed(storefrontId: string | null, branchScope: string | null): void {
  if (!branchScope) return;
  if (storefrontId !== branchScope) {
    throw new Error("You can only manage recurring bills for your own storefront");
  }
}

function mapRow(row: recurringBillRepository.RecurringBillRow): RecurringBill {
  const { reminderStatus, daysUntilDue } = reminderStatusFor(row.next_due_date);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    // The columns stay nullable at the SQL level for bills created before category/storefront
    // became required, but the create/edit form no longer allows leaving either blank.
    categoryId: row.category_id as string,
    categoryName: row.category_name as string,
    storefrontId: row.storefront_id as string,
    storefrontName: row.storefront_name as string,
    amountCents: row.amount_cents,
    cycle: row.cycle,
    startDate: row.start_date,
    nextDueDate: row.next_due_date,
    status: row.status,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reminderStatus,
    daysUntilDue
  };
}

/** Recurring bills live on the "expenses" permission resource — they're an expense-management
 * concern through and through (always shown on the Expenses tab, always a Manager/Storekeeper/Super
 * Admin activity), so reusing it avoids a whole new permission module for what's fundamentally a
 * reminder layer over the same audience that already manages expenses. */
export function listRecurringBills(): RecurringBill[] {
  requirePermission("expenses", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return recurringBillRepository.findAllRecurringBillRows(tenantId, locationId).map(mapRow);
}

export function getRecurringBill(id: string): RecurringBill {
  requirePermission("expenses", "view");
  const row = recurringBillRepository.findRecurringBillRowById(id);
  if (!row) {
    throw new Error("Recurring bill not found");
  }
  assertBillStorefrontAssignmentAllowed(row.storefront_id, getCurrentBranchScope());
  return mapRow(row);
}

/** Just a scheduling record — creating one never touches the expenses table or generates any real
 * transaction. The admin is expected to record the actual payment as a normal Expense when it's
 * actually paid, then use advanceRecurringBill() to roll the reminder forward. */
export function createRecurringBill(input: unknown): RecurringBill {
  requirePermission("expenses", "create");
  const parsed: RecurringBillInput = recurringBillInputSchema.parse(input);
  assertBillStorefrontAssignmentAllowed(parsed.storefrontId, getCurrentBranchScope());
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();

  const id = recurringBillRepository.insertRecurringBillRow({
    tenantId,
    name: parsed.name,
    categoryId: parsed.categoryId,
    storefrontId: parsed.storefrontId,
    amountCents: parsed.amountCents,
    cycle: parsed.cycle,
    startDate: parsed.startDate,
    nextDueDate: parsed.startDate,
    notes: parsed.notes,
    createdBy: employeeId
  });

  const row = recurringBillRepository.findRecurringBillRowById(id);
  if (!row) {
    throw new Error("Failed to create recurring bill");
  }
  return mapRow(row);
}

export function updateRecurringBill(id: string, input: unknown): RecurringBill {
  requirePermission("expenses", "edit");
  const parsed: RecurringBillInput = recurringBillInputSchema.parse(input);
  const existing = recurringBillRepository.findRecurringBillRowById(id);
  if (!existing) {
    throw new Error("Recurring bill not found");
  }
  const branchScope = getCurrentBranchScope();
  assertBillStorefrontAssignmentAllowed(existing.storefront_id, branchScope);
  assertBillStorefrontAssignmentAllowed(parsed.storefrontId, branchScope);

  recurringBillRepository.updateRecurringBillRow(id, {
    name: parsed.name,
    categoryId: parsed.categoryId,
    storefrontId: parsed.storefrontId,
    amountCents: parsed.amountCents,
    cycle: parsed.cycle,
    startDate: parsed.startDate,
    notes: parsed.notes
  });

  const row = recurringBillRepository.findRecurringBillRowById(id);
  if (!row) {
    throw new Error("Recurring bill not found");
  }
  return mapRow(row);
}

export function setRecurringBillStatus(id: string, status: RecurringBillStatus): RecurringBill {
  requirePermission("expenses", "edit");
  const existing = recurringBillRepository.findRecurringBillRowById(id);
  if (!existing) {
    throw new Error("Recurring bill not found");
  }
  assertBillStorefrontAssignmentAllowed(existing.storefront_id, getCurrentBranchScope());

  recurringBillRepository.updateRecurringBillStatusRow(id, status);
  const row = recurringBillRepository.findRecurringBillRowById(id);
  if (!row) {
    throw new Error("Recurring bill not found");
  }
  return mapRow(row);
}

/** "Push to Next Cycle" without recording a payment — for the rare case a reminder gets acknowledged
 * (or needs clearing) without actually having been paid. Advances from the bill's OWN current due
 * date (not from today), so acknowledging it a few days late doesn't compress the following cycle.
 * When it WAS actually paid, use markRecurringBillPaid() instead — see that for why. */
export function advanceRecurringBill(id: string): RecurringBill {
  requirePermission("expenses", "edit");
  const row = recurringBillRepository.findRecurringBillRowById(id);
  if (!row) {
    throw new Error("Recurring bill not found");
  }
  assertBillStorefrontAssignmentAllowed(row.storefront_id, getCurrentBranchScope());
  const nextDueDate = advanceDateByCycle(row.next_due_date, row.cycle);
  recurringBillRepository.updateRecurringBillNextDueDateRow(id, nextDueDate);

  const updated = recurringBillRepository.findRecurringBillRowById(id);
  if (!updated) {
    throw new Error("Recurring bill not found");
  }
  return mapRow(updated);
}

/** The normal way a recurring bill gets handled: records the payment as a real Expense (so it shows
 * up in Expenses/reports like any other spend) AND rolls the reminder forward in one step — there's
 * no reason to make the admin re-key a payment they just told us they made. Requires the bill to
 * already have a category and storefront assigned (the same requirements every Expense has). */
export function markRecurringBillPaid(id: string, input: unknown): { bill: RecurringBill; expense: Expense } {
  requirePermission("expenses", "edit");
  const parsed = recurringBillMarkPaidInputSchema.parse(input);
  const row = recurringBillRepository.findRecurringBillRowById(id);
  if (!row) {
    throw new Error("Recurring bill not found");
  }
  if (!row.category_id || !row.storefront_id) {
    throw new Error("Edit this recurring bill and set a category and storefront before marking it paid");
  }
  assertBillStorefrontAssignmentAllowed(row.storefront_id, getCurrentBranchScope());

  const expense = createExpense({
    expenseDate: new Date().toISOString().slice(0, 10),
    categoryId: row.category_id,
    amountCents: row.amount_cents,
    paidBy: getCurrentEmployeeName(),
    paymentMethodId: parsed.paymentMethodId,
    storefrontId: row.storefront_id,
    reference: parsed.reference,
    description: `Recurring bill: ${row.name}`,
    attachmentPath: null
  });

  const nextDueDate = advanceDateByCycle(row.next_due_date, row.cycle);
  recurringBillRepository.updateRecurringBillNextDueDateRow(id, nextDueDate);

  const updated = recurringBillRepository.findRecurringBillRowById(id);
  if (!updated) {
    throw new Error("Recurring bill not found");
  }
  return { bill: mapRow(updated), expense };
}

export function deleteRecurringBill(id: string): void {
  requirePermission("expenses", "delete");
  const existing = recurringBillRepository.findRecurringBillRowById(id);
  if (!existing) {
    throw new Error("Recurring bill not found");
  }
  assertBillStorefrontAssignmentAllowed(existing.storefront_id, getCurrentBranchScope());
  recurringBillRepository.deleteRecurringBillRow(id);
}

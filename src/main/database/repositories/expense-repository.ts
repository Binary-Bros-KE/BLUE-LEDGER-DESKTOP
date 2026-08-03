import { getDatabase } from "@main/database/connection";
import type { ExpenseInput } from "@shared/schemas/expense";
import type {
  Expense,
  ExpenseCategoryBreakdown,
  ExpenseKind,
  ExpenseStatus,
  ExpenseSyncStatus,
  RecurrenceFrequency
} from "@shared/types/expense";

export type ExpenseRow = {
  id: string;
  tenant_id: string;
  kind: string;
  expense_number: string;
  expense_date: string;
  category_id: string;
  amount_cents: number;
  paid_by: string | null;
  payment_method_id: string;
  storefront_id: string | null;
  reference: string | null;
  description: string | null;
  attachment_path: string | null;
  status: string;
  is_recurring: number;
  recurrence_frequency: string | null;
  next_due_date: string | null;
  last_reminder_sent: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

export type ExpenseDetailRow = ExpenseRow & {
  category_name: string;
  payment_method_name: string;
  storefront_name: string | null;
  created_by_name: string | null;
};

/**
 * Every expense, newest first. Pass null for locationId to see every branch's expenses (e.g. a
 * super-admin with no assigned branch); otherwise general expenses with no storefront (head-office
 * costs) are always included alongside the caller's own branch, the same way storefront-less
 * products are visible everywhere.
 *
 * Pass null for kind to see every row regardless of kind (the Expenses tab's own view — a
 * manager/admin needs full financial visibility across both formal expenses AND local purchases);
 * pass a specific kind to filter to just that (Local Purchases' own view, which must never leak a
 * 'general' row to whoever's calling it).
 */
export function findAllExpenseDetailRows(
  tenantId: string,
  locationId: string | null,
  kind: ExpenseKind | null
): ExpenseDetailRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        e.*,
        ec.name AS category_name,
        pm.name AS payment_method_name,
        l.location_name AS storefront_name,
        (emp.first_name || ' ' || emp.last_name) AS created_by_name
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
      JOIN payment_methods pm ON pm.id = e.payment_method_id
      LEFT JOIN locations l ON l.id = e.storefront_id
      LEFT JOIN employees emp ON emp.id = e.created_by
      WHERE e.tenant_id = ? AND (? IS NULL OR e.storefront_id = ? OR e.storefront_id IS NULL)
        AND (? IS NULL OR e.kind = ?)
      ORDER BY e.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId, kind, kind) as ExpenseDetailRow[];
}

export type ExpenseSummaryRow = {
  today_cents: number;
  this_month_cents: number;
  total_cents: number;
};

export function findExpenseSummaryRow(
  tenantId: string,
  locationId: string | null,
  kind: ExpenseKind | null
): ExpenseSummaryRow {
  return getDatabase()
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN date(expense_date) = date('now') THEN amount_cents ELSE 0 END), 0) AS today_cents,
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', expense_date) = strftime('%Y-%m', 'now') THEN amount_cents ELSE 0 END), 0) AS this_month_cents,
        COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM expenses
      WHERE tenant_id = ? AND status = 'active' AND (? IS NULL OR storefront_id = ? OR storefront_id IS NULL)
        AND (? IS NULL OR kind = ?)
    `
    )
    .get(tenantId, locationId, locationId, kind, kind) as ExpenseSummaryRow;
}

export type ExpenseCategoryBreakdownRow = {
  category_id: string;
  category_name: string;
  total_cents: number;
};

export function findExpenseCategoryBreakdownRows(
  tenantId: string,
  locationId: string | null,
  kind: ExpenseKind | null
): ExpenseCategoryBreakdownRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT ec.id AS category_id, ec.name AS category_name, COALESCE(SUM(e.amount_cents), 0) AS total_cents
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
      WHERE e.tenant_id = ? AND e.status = 'active' AND (? IS NULL OR e.storefront_id = ? OR e.storefront_id IS NULL)
        AND (? IS NULL OR e.kind = ?)
      GROUP BY ec.id, ec.name
      ORDER BY total_cents DESC
    `
    )
    .all(tenantId, locationId, locationId, kind, kind) as ExpenseCategoryBreakdownRow[];
}

export function mapExpenseCategoryBreakdownRow(row: ExpenseCategoryBreakdownRow): ExpenseCategoryBreakdown {
  return {
    categoryId: row.category_id,
    categoryName: row.category_name,
    totalCents: row.total_cents
  };
}

// Returns every matching number, not just the max — see document-number-service.ts's own comment.
export function findMaxExpenseNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT expense_number FROM expenses WHERE tenant_id = ? AND expense_number LIKE 'EXP-%'")
      .all(tenantId) as Array<{ expense_number: string }>
  ).map((row) => row.expense_number);
}

/** Local purchases share the same expense_number column but their own "LP-" prefix/namespace, so a
 * quick glance at the number alone already tells a formal expense apart from a local purchase. */
export function findMaxLocalPurchaseNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT expense_number FROM expenses WHERE tenant_id = ? AND expense_number LIKE 'LP-%'")
      .all(tenantId) as Array<{ expense_number: string }>
  ).map((row) => row.expense_number);
}

export function findExpenseRowById(id: string): ExpenseRow | undefined {
  return getDatabase().prepare("SELECT * FROM expenses WHERE id = ?").get(id) as ExpenseRow | undefined;
}

export function findExpenseDetailRowById(id: string): ExpenseDetailRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT
        e.*,
        ec.name AS category_name,
        pm.name AS payment_method_name,
        l.location_name AS storefront_name,
        (emp.first_name || ' ' || emp.last_name) AS created_by_name
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
      JOIN payment_methods pm ON pm.id = e.payment_method_id
      LEFT JOIN locations l ON l.id = e.storefront_id
      LEFT JOIN employees emp ON emp.id = e.created_by
      WHERE e.id = ?
    `
    )
    .get(id) as ExpenseDetailRow | undefined;
}

export function insertExpenseRow(
  input: ExpenseInput & {
    id: string;
    tenantId: string;
    kind: ExpenseKind;
    expenseNumber: string;
    createdBy: string | null;
  }
): ExpenseRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO expenses (
        id, tenant_id, kind, expense_number, expense_date, category_id, amount_cents, paid_by,
        payment_method_id, storefront_id, reference, description, attachment_path, status,
        created_by, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.kind,
      input.expenseNumber,
      input.expenseDate,
      input.categoryId,
      input.amountCents,
      input.paidBy,
      input.paymentMethodId,
      input.storefrontId,
      input.reference,
      input.description,
      input.attachmentPath,
      input.createdBy,
      now,
      now
    );

  const row = findExpenseRowById(input.id);
  if (!row) {
    throw new Error("Failed to create expense record");
  }
  return row;
}

export function updateExpenseRow(id: string, input: ExpenseInput): ExpenseRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE expenses SET
        expense_date = ?,
        category_id = ?,
        amount_cents = ?,
        paid_by = ?,
        payment_method_id = ?,
        storefront_id = ?,
        reference = ?,
        description = ?,
        attachment_path = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.expenseDate,
      input.categoryId,
      input.amountCents,
      input.paidBy,
      input.paymentMethodId,
      input.storefrontId,
      input.reference,
      input.description,
      input.attachmentPath,
      now,
      id
    );

  const row = findExpenseRowById(id);
  if (!row) {
    throw new Error("Expense not found after update");
  }
  return row;
}

export function setExpenseStatusRow(id: string, status: ExpenseStatus): ExpenseRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE expenses SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findExpenseRowById(id);
  if (!row) {
    throw new Error("Expense not found after status update");
  }
  return row;
}

export function deleteExpenseRow(id: string): void {
  getDatabase().prepare("DELETE FROM expenses WHERE id = ?").run(id);
}

/** Ids of every expense left over from before "General/Head Office" (a null storefront) was removed. */
export function findExpenseIdsWithoutStorefront(tenantId: string): string[] {
  const rows = getDatabase()
    .prepare("SELECT id FROM expenses WHERE tenant_id = ? AND storefront_id IS NULL")
    .all(tenantId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function setExpenseStorefrontRow(id: string, storefrontId: string): void {
  getDatabase().prepare("UPDATE expenses SET storefront_id = ? WHERE id = ?").run(storefrontId, id);
}

export function mapExpenseDetailRow(row: ExpenseDetailRow): Expense {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as ExpenseKind,
    expenseNumber: row.expense_number,
    expenseDate: row.expense_date,
    categoryId: row.category_id,
    categoryName: row.category_name,
    amountCents: row.amount_cents,
    paidBy: row.paid_by,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name,
    // The column stays nullable at the SQL level, but application code never writes a null anymore
    // (expenseInputSchema requires it) and ensureExpensesHaveStorefront() backfilled every old row —
    // so by the time anything reads an expense, this is always a real storefront.
    storefrontId: row.storefront_id as string,
    storefrontName: row.storefront_name as string,
    reference: row.reference,
    description: row.description,
    attachmentPath: row.attachment_path,
    status: row.status as ExpenseStatus,
    isRecurring: Boolean(row.is_recurring),
    recurrenceFrequency: row.recurrence_frequency as RecurrenceFrequency | null,
    nextDueDate: row.next_due_date,
    lastReminderSent: row.last_reminder_sent,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as ExpenseSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

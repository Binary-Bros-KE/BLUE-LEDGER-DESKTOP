import { getDatabase } from "@main/database/connection";
import type { ExpenseCategoryInput } from "@shared/schemas/expense-category";
import type { ExpenseCategory, ExpenseCategoryStatus, ExpenseCategorySyncStatus } from "@shared/types/expense-category";

export type ExpenseCategoryRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

/** Active categories first, then alphabetical within each group. */
export function findAllExpenseCategoryRows(tenantId: string): ExpenseCategoryRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT * FROM expense_categories
      WHERE tenant_id = ?
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, name COLLATE NOCASE ASC
    `
    )
    .all(tenantId) as ExpenseCategoryRow[];
}

export function findExpenseCategoryRowById(id: string): ExpenseCategoryRow | undefined {
  return getDatabase().prepare("SELECT * FROM expense_categories WHERE id = ?").get(id) as
    | ExpenseCategoryRow
    | undefined;
}

export function findExpenseCategoryByNameRow(
  tenantId: string,
  name: string,
  excludeId?: string
): ExpenseCategoryRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, name, excludeId] : [tenantId, name];
  return getDatabase()
    .prepare(`SELECT * FROM expense_categories WHERE tenant_id = ? AND lower(name) = lower(?) ${excludeClause}`)
    .get(...params) as ExpenseCategoryRow | undefined;
}

export function insertExpenseCategoryRow(
  input: ExpenseCategoryInput & { id: string; tenantId: string }
): ExpenseCategoryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO expense_categories (id, tenant_id, name, description, status, created_at, updated_at, sync_status)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 'pending')
    `
    )
    .run(input.id, input.tenantId, input.name, input.description, now, now);

  const row = findExpenseCategoryRowById(input.id);
  if (!row) {
    throw new Error("Failed to create expense category record");
  }
  return row;
}

export function updateExpenseCategoryRow(id: string, input: ExpenseCategoryInput): ExpenseCategoryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE expense_categories SET
        name = ?,
        description = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(input.name, input.description, now, id);

  const row = findExpenseCategoryRowById(id);
  if (!row) {
    throw new Error("Expense category not found after update");
  }
  return row;
}

export function setExpenseCategoryStatusRow(id: string, status: ExpenseCategoryStatus): ExpenseCategoryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE expense_categories SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findExpenseCategoryRowById(id);
  if (!row) {
    throw new Error("Expense category not found after status update");
  }
  return row;
}

export function mapExpenseCategoryRow(row: ExpenseCategoryRow): ExpenseCategory {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    status: row.status as ExpenseCategoryStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as ExpenseCategorySyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

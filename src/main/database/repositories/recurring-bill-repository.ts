import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";

export type RecurringBillRow = {
  id: string;
  tenant_id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  storefront_id: string | null;
  storefront_name: string | null;
  amount_cents: number;
  cycle: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
  start_date: string;
  next_due_date: string;
  status: "active" | "paused";
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_WITH_JOINS = `
  SELECT rb.*,
    ec.name AS category_name,
    l.location_name AS storefront_name,
    CASE WHEN rb.created_by IS NOT NULL THEN (e.first_name || ' ' || e.last_name) ELSE NULL END AS created_by_name
  FROM recurring_bills rb
  LEFT JOIN expense_categories ec ON ec.id = rb.category_id
  LEFT JOIN locations l ON l.id = rb.storefront_id
  LEFT JOIN employees e ON e.id = rb.created_by
`;

/** Pass locationId to narrow to one branch's own bills (a branch-scoped Manager's view); null sees
 * every branch (Super Admin), matching how listExpenses() already scopes. */
export function findAllRecurringBillRows(tenantId: string, locationId: string | null): RecurringBillRow[] {
  return getDatabase()
    .prepare(
      `${SELECT_WITH_JOINS} WHERE rb.tenant_id = ? AND (? IS NULL OR rb.storefront_id = ?) ORDER BY rb.next_due_date ASC`
    )
    .all(tenantId, locationId, locationId) as RecurringBillRow[];
}

export function findRecurringBillRowById(id: string): RecurringBillRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_JOINS} WHERE rb.id = ?`).get(id) as RecurringBillRow | undefined;
}

export function insertRecurringBillRow(input: {
  tenantId: string;
  name: string;
  categoryId: string | null;
  storefrontId: string | null;
  amountCents: number;
  cycle: string;
  startDate: string;
  nextDueDate: string;
  notes: string | null;
  createdBy: string | null;
}): string {
  const id = `rbill_${randomUUID()}`;
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO recurring_bills (
        id, tenant_id, name, category_id, storefront_id, amount_cents, cycle, start_date,
        next_due_date, status, notes, created_by, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      id,
      input.tenantId,
      input.name,
      input.categoryId,
      input.storefrontId,
      input.amountCents,
      input.cycle,
      input.startDate,
      input.nextDueDate,
      input.notes,
      input.createdBy,
      now,
      now
    );

  return id;
}

export function updateRecurringBillRow(
  id: string,
  input: {
    name: string;
    categoryId: string | null;
    storefrontId: string | null;
    amountCents: number;
    cycle: string;
    startDate: string;
    notes: string | null;
  }
): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `
      UPDATE recurring_bills
      SET name = ?, category_id = ?, storefront_id = ?, amount_cents = ?, cycle = ?, start_date = ?,
        notes = ?, updated_at = ?, sync_status = 'pending'
      WHERE id = ?
    `
    )
    .run(input.name, input.categoryId, input.storefrontId, input.amountCents, input.cycle, input.startDate, input.notes, now, id);
}

export function updateRecurringBillStatusRow(id: string, status: "active" | "paused"): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE recurring_bills SET status = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?")
    .run(status, now, id);
}

export function updateRecurringBillNextDueDateRow(id: string, nextDueDate: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE recurring_bills SET next_due_date = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?")
    .run(nextDueDate, now, id);
}

export function deleteRecurringBillRow(id: string): void {
  getDatabase().prepare("DELETE FROM recurring_bills WHERE id = ?").run(id);
}

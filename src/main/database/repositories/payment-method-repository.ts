import { getDatabase } from "@main/database/connection";
import type { PaymentMethodInput } from "@shared/schemas/payment-method";
import type { PaymentMethod, PaymentMethodSyncStatus } from "@shared/types/payment-method";

export type PaymentMethodRow = {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  description: string | null;
  is_system_method: number;
  is_active: number;
  requires_reference: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

export function findAllPaymentMethodRows(tenantId: string): PaymentMethodRow[] {
  return getDatabase()
    .prepare(
      "SELECT * FROM payment_methods WHERE tenant_id = ? ORDER BY sort_order ASC, name ASC"
    )
    .all(tenantId) as PaymentMethodRow[];
}

export function findPaymentMethodRowById(id: string): PaymentMethodRow | undefined {
  return getDatabase().prepare("SELECT * FROM payment_methods WHERE id = ?").get(id) as
    | PaymentMethodRow
    | undefined;
}

export function findPaymentMethodByCodeRow(
  tenantId: string,
  code: string,
  excludeId?: string
): PaymentMethodRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, code, excludeId] : [tenantId, code];
  return getDatabase()
    .prepare(`SELECT * FROM payment_methods WHERE tenant_id = ? AND lower(code) = lower(?) ${excludeClause}`)
    .get(...params) as PaymentMethodRow | undefined;
}

export function findPaymentMethodByNameRow(
  tenantId: string,
  name: string,
  excludeId?: string
): PaymentMethodRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, name, excludeId] : [tenantId, name];
  return getDatabase()
    .prepare(`SELECT * FROM payment_methods WHERE tenant_id = ? AND lower(name) = lower(?) ${excludeClause}`)
    .get(...params) as PaymentMethodRow | undefined;
}

export function insertPaymentMethodRow(
  input: PaymentMethodInput & { id: string; tenantId: string; isSystemMethod: boolean }
): PaymentMethodRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO payment_methods (
        id, tenant_id, name, code, description, is_system_method, is_active,
        requires_reference, sort_order, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.name,
      input.code,
      input.description,
      input.isSystemMethod ? 1 : 0,
      input.isActive ? 1 : 0,
      input.requiresReference ? 1 : 0,
      input.sortOrder,
      now,
      now
    );

  const row = findPaymentMethodRowById(input.id);
  if (!row) {
    throw new Error("Failed to create payment method record");
  }
  return row;
}

export function updatePaymentMethodRow(id: string, input: PaymentMethodInput): PaymentMethodRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE payment_methods SET
        name = ?,
        code = ?,
        description = ?,
        is_active = ?,
        requires_reference = ?,
        sort_order = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.name,
      input.code,
      input.description,
      input.isActive ? 1 : 0,
      input.requiresReference ? 1 : 0,
      input.sortOrder,
      now,
      id
    );

  const row = findPaymentMethodRowById(id);
  if (!row) {
    throw new Error("Payment method not found after update");
  }
  return row;
}

export function setPaymentMethodActiveRow(id: string, isActive: boolean): PaymentMethodRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      "UPDATE payment_methods SET is_active = ?, sync_status = 'pending', updated_at = ? WHERE id = ?"
    )
    .run(isActive ? 1 : 0, now, id);

  const row = findPaymentMethodRowById(id);
  if (!row) {
    throw new Error("Payment method not found after status update");
  }
  return row;
}

export function deletePaymentMethodRow(id: string): void {
  getDatabase().prepare("DELETE FROM payment_methods WHERE id = ?").run(id);
}

export function mapPaymentMethodRow(row: PaymentMethodRow): PaymentMethod {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    code: row.code,
    description: row.description,
    isSystemMethod: Boolean(row.is_system_method),
    isActive: Boolean(row.is_active),
    requiresReference: Boolean(row.requires_reference),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as PaymentMethodSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

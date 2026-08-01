import { getDatabase } from "@main/database/connection";
import type { CustomerInput } from "@shared/schemas/customer";
import type { Customer, CustomerStatus, CustomerSyncStatus } from "@shared/types/customer";

export type CustomerRow = {
  id: string;
  tenant_id: string;
  customer_code: string;
  customer_type: string;
  name: string;
  phone: string;
  email: string | null;
  kra_pin: string | null;
  physical_address: string | null;
  credit_limit_cents: number | null;
  current_balance_cents: number;
  notes: string | null;
  status: string;
  location_id: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

/**
 * Lists customers for the tenant. When locationId is provided, includes only customers created at
 * that branch plus "shared" customers with no branch (legacy records from before branch-tagging, or
 * ones created by a super-admin). Pass null to see every customer regardless of branch.
 */
export function findAllCustomerRows(tenantId: string, locationId: string | null): CustomerRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT * FROM customers
      WHERE tenant_id = ?
        AND (? IS NULL OR location_id IS NULL OR location_id = ?)
      ORDER BY name ASC
    `
    )
    .all(tenantId, locationId, locationId) as CustomerRow[];
}

export function findCustomerRowById(id: string): CustomerRow | undefined {
  return getDatabase().prepare("SELECT * FROM customers WHERE id = ?").get(id) as
    | CustomerRow
    | undefined;
}

export function findCustomerByPhoneRow(
  tenantId: string,
  phone: string,
  excludeId?: string
): CustomerRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, phone, excludeId] : [tenantId, phone];
  return getDatabase()
    .prepare(`SELECT * FROM customers WHERE tenant_id = ? AND phone = ? ${excludeClause}`)
    .get(...params) as CustomerRow | undefined;
}

export function findMaxCustomerCodeRow(tenantId: string): string | null {
  const row = getDatabase()
    .prepare(
      "SELECT MAX(customer_code) as maxCode FROM customers WHERE tenant_id = ? AND customer_code LIKE 'CUST-%'"
    )
    .get(tenantId) as { maxCode: string | null };
  return row.maxCode;
}

export function insertCustomerRow(
  input: CustomerInput & { id: string; tenantId: string; customerCode: string; locationId: string | null }
): CustomerRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO customers (
        id, tenant_id, customer_code, customer_type, name, phone, email, kra_pin,
        physical_address, credit_limit_cents, current_balance_cents, notes,
        status, location_id, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.customerCode,
      input.customerType,
      input.name,
      input.phone,
      input.email,
      input.kraPin,
      input.physicalAddress,
      input.creditLimitCents,
      input.notes,
      input.locationId,
      now,
      now
    );

  const row = findCustomerRowById(input.id);
  if (!row) {
    throw new Error("Failed to create customer record");
  }
  return row;
}

export function updateCustomerRow(id: string, input: CustomerInput): CustomerRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE customers SET
        customer_type = ?,
        name = ?,
        phone = ?,
        email = ?,
        kra_pin = ?,
        physical_address = ?,
        credit_limit_cents = ?,
        notes = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.customerType,
      input.name,
      input.phone,
      input.email,
      input.kraPin,
      input.physicalAddress,
      input.creditLimitCents,
      input.notes,
      now,
      id
    );

  const row = findCustomerRowById(id);
  if (!row) {
    throw new Error("Customer not found after update");
  }
  return row;
}

export function setCustomerStatusRow(id: string, status: CustomerStatus): CustomerRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE customers SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findCustomerRowById(id);
  if (!row) {
    throw new Error("Customer not found after status update");
  }
  return row;
}

export function mapCustomerRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerCode: row.customer_code,
    customerType: row.customer_type as Customer["customerType"],
    name: row.name,
    phone: row.phone,
    email: row.email,
    kraPin: row.kra_pin,
    physicalAddress: row.physical_address,
    creditLimitCents: row.credit_limit_cents,
    currentBalanceCents: row.current_balance_cents,
    notes: row.notes,
    status: row.status as CustomerStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as CustomerSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

import { getDatabase } from "@main/database/connection";
import type { SupplierInput } from "@shared/schemas/supplier";
import type { Supplier, SupplierPaymentOption, SupplierStatus, SupplierSyncStatus } from "@shared/types/supplier";

export type SupplierRow = {
  id: string;
  tenant_id: string;
  supplier_code: string;
  business_name: string;
  contact_person: string | null;
  phone_1: string;
  phone_2: string | null;
  email: string | null;
  kra_pin: string | null;
  website: string | null;
  country: string | null;
  county: string | null;
  town: string | null;
  physical_address: string | null;
  payment_option: string;
  mpesa_name: string | null;
  mpesa_number: string | null;
  mpesa_alternative_number: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  credit_limit_cents: number | null;
  status: string;
  notes: string | null;
  balance_cents: number;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

/** Active suppliers first, inactive ones sorted to the bottom — then alphabetical within each group. */
export function findAllSupplierRows(tenantId: string): SupplierRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT * FROM suppliers
      WHERE tenant_id = ?
      ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, business_name COLLATE NOCASE ASC
    `
    )
    .all(tenantId) as SupplierRow[];
}

export function findSupplierRowById(id: string): SupplierRow | undefined {
  return getDatabase().prepare("SELECT * FROM suppliers WHERE id = ?").get(id) as SupplierRow | undefined;
}

export function findSupplierByBusinessNameRow(
  tenantId: string,
  businessName: string,
  excludeId?: string
): SupplierRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId ? [tenantId, businessName, excludeId] : [tenantId, businessName];
  return getDatabase()
    .prepare(`SELECT * FROM suppliers WHERE tenant_id = ? AND lower(business_name) = lower(?) ${excludeClause}`)
    .get(...params) as SupplierRow | undefined;
}

/** ALL existing supplier codes for this tenant — see generateDocumentNumber's own doc comment for
 * why this can't be a plain SQL MAX() once codes are device-tagged (lexicographic string
 * comparison would pick the wrong one once tagged and untagged codes are mixed). */
export function findMaxSupplierCodeRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT supplier_code FROM suppliers WHERE tenant_id = ? AND supplier_code LIKE 'SUP-%'")
      .all(tenantId) as Array<{ supplier_code: string }>
  ).map((row) => row.supplier_code);
}

export function insertSupplierRow(
  input: SupplierInput & { id: string; tenantId: string; supplierCode: string }
): SupplierRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO suppliers (
        id, tenant_id, supplier_code, business_name, contact_person, phone_1, phone_2, email, kra_pin, website,
        country, county, town, physical_address, payment_option, mpesa_name, mpesa_number,
        mpesa_alternative_number, bank_name, bank_account_name, bank_account_number,
        credit_limit_cents, status, notes, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.supplierCode,
      input.businessName,
      input.contactPerson,
      input.phone1,
      input.phone2,
      input.email,
      input.kraPin,
      input.website,
      input.country,
      input.county,
      input.town,
      input.physicalAddress,
      input.paymentOption,
      input.mpesaName,
      input.mpesaNumber,
      input.mpesaAlternativeNumber,
      input.bankName,
      input.bankAccountName,
      input.bankAccountNumber,
      input.creditLimitCents,
      input.notes,
      now,
      now
    );

  const row = findSupplierRowById(input.id);
  if (!row) {
    throw new Error("Failed to create supplier record");
  }
  return row;
}

export function updateSupplierRow(id: string, input: SupplierInput): SupplierRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE suppliers SET
        business_name = ?,
        contact_person = ?,
        phone_1 = ?,
        phone_2 = ?,
        email = ?,
        kra_pin = ?,
        website = ?,
        country = ?,
        county = ?,
        town = ?,
        physical_address = ?,
        payment_option = ?,
        mpesa_name = ?,
        mpesa_number = ?,
        mpesa_alternative_number = ?,
        bank_name = ?,
        bank_account_name = ?,
        bank_account_number = ?,
        credit_limit_cents = ?,
        notes = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.businessName,
      input.contactPerson,
      input.phone1,
      input.phone2,
      input.email,
      input.kraPin,
      input.website,
      input.country,
      input.county,
      input.town,
      input.physicalAddress,
      input.paymentOption,
      input.mpesaName,
      input.mpesaNumber,
      input.mpesaAlternativeNumber,
      input.bankName,
      input.bankAccountName,
      input.bankAccountNumber,
      input.creditLimitCents,
      input.notes,
      now,
      id
    );

  const row = findSupplierRowById(id);
  if (!row) {
    throw new Error("Supplier not found after update");
  }
  return row;
}

export function setSupplierStatusRow(id: string, status: SupplierStatus): SupplierRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE suppliers SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findSupplierRowById(id);
  if (!row) {
    throw new Error("Supplier not found after status update");
  }
  return row;
}

export function mapSupplierRow(row: SupplierRow): Supplier {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    supplierCode: row.supplier_code,
    businessName: row.business_name,
    contactPerson: row.contact_person,
    phone1: row.phone_1,
    phone2: row.phone_2,
    email: row.email,
    kraPin: row.kra_pin,
    website: row.website,
    country: row.country,
    county: row.county,
    town: row.town,
    physicalAddress: row.physical_address,
    paymentOption: row.payment_option as SupplierPaymentOption,
    mpesaName: row.mpesa_name,
    mpesaNumber: row.mpesa_number,
    mpesaAlternativeNumber: row.mpesa_alternative_number,
    bankName: row.bank_name,
    bankAccountName: row.bank_account_name,
    bankAccountNumber: row.bank_account_number,
    creditLimitCents: row.credit_limit_cents,
    status: row.status as SupplierStatus,
    notes: row.notes,
    balanceCents: row.balance_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as SupplierSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

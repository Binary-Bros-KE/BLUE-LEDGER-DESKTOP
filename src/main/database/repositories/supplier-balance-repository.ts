import { getDatabase } from "@main/database/connection";
import type { SupplierBalanceEntry, SupplierBalanceEntryType } from "@shared/types/supplier-balance";

export type SupplierBalanceEntryRow = {
  id: string;
  tenant_id: string;
  supplier_id: string;
  entry_type: string;
  amount_cents: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  performed_by: string | null;
  created_at: string;
  sync_status: string;
  last_synced_at: string | null;
};

export function insertBalanceEntryRow(input: {
  id: string;
  tenantId: string;
  supplierId: string;
  entryType: SupplierBalanceEntryType;
  amountCents: number;
  referenceType: "purchase" | null;
  referenceId: string | null;
  notes: string | null;
  performedBy: string | null;
}): SupplierBalanceEntryRow {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `
      INSERT INTO supplier_balance_entries (
        id, tenant_id, supplier_id, entry_type, amount_cents, reference_type, reference_id, notes, performed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.supplierId,
      input.entryType,
      input.amountCents,
      input.referenceType,
      input.referenceId,
      input.notes,
      input.performedBy,
      now
    );

  const row = getDatabase().prepare("SELECT * FROM supplier_balance_entries WHERE id = ?").get(input.id) as
    | SupplierBalanceEntryRow
    | undefined;
  if (!row) {
    throw new Error("Failed to record supplier balance entry");
  }
  return row;
}

export function findBalanceEntryRowById(id: string): SupplierBalanceEntryRow | undefined {
  return getDatabase().prepare("SELECT * FROM supplier_balance_entries WHERE id = ?").get(id) as
    | SupplierBalanceEntryRow
    | undefined;
}

/** Most recent first — matches every other ledger/history view in this app (e.g. StockMovement's own
 * feed). */
export function findBalanceEntryRowsForSupplier(supplierId: string, limit = 200): SupplierBalanceEntryRow[] {
  return getDatabase()
    .prepare("SELECT * FROM supplier_balance_entries WHERE supplier_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(supplierId, limit) as SupplierBalanceEntryRow[];
}

/** The ONLY place suppliers.balance_cents is ever written — a raw, targeted UPDATE that deliberately
 * touches neither updated_at nor sync_status, so it never fires trg_suppliers_sync_au and never gets
 * pushed as part of the supplier row. See supplier-balance-service.ts's own doc comment for why this
 * column has to stay purely local. */
export function adjustSupplierBalanceCents(supplierId: string, deltaCents: number): void {
  getDatabase()
    .prepare("UPDATE suppliers SET balance_cents = balance_cents + ? WHERE id = ?")
    .run(deltaCents, supplierId);
}

export function mapBalanceEntryRow(
  row: SupplierBalanceEntryRow,
  performedByName: string | null
): SupplierBalanceEntry {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    entryType: row.entry_type as SupplierBalanceEntryType,
    amountCents: row.amount_cents,
    referenceType: row.reference_type as "purchase" | null,
    referenceId: row.reference_id,
    notes: row.notes,
    performedBy: row.performed_by,
    performedByName,
    createdAt: row.created_at
  };
}

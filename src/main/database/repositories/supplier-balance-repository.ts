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

/** The incremental writer for suppliers.balance_cents — a raw, targeted UPDATE that deliberately
 * touches neither updated_at nor sync_status, so it never fires trg_suppliers_sync_au and never gets
 * pushed as part of the supplier row. See supplier-balance-service.ts's own doc comment for why this
 * column has to stay purely local. See reconcileAllSupplierBalances below for the OTHER writer. */
export function adjustSupplierBalanceCents(supplierId: string, deltaCents: number): void {
  getDatabase()
    .prepare("UPDATE suppliers SET balance_cents = balance_cents + ? WHERE id = ?")
    .run(deltaCents, supplierId);
}

/**
 * The second, self-healing writer for suppliers.balance_cents — recomputes EVERY supplier's balance
 * directly from ground truth (purchases.received_value_cents - amount_paid_cents, plus any genuine
 * non-purchase manual_adjustment entry, reference_id IS NULL) and overwrites the cache outright. Run
 * on every boot and at the end of every sync cycle (see bootstrap.ts / sync-engine.ts) — cheap (one
 * aggregate UPDATE) and 100% safe to run unconditionally, on any device, at any time, since it never
 * touches anything synced.
 *
 * Why this exists on top of adjustSupplierBalanceCents's incremental maintenance: migration 93 (the
 * 2026-09-22 emergency fix) proved that a per-entry incremental cache can't be trusted to stay correct
 * forever in a multi-device system — applySupplierBalanceEntryPulledRow (sync-engine.ts) applies
 * *any* newly-pulled ledger row as a delta, including a correction entry inserted by some OTHER
 * device's own one-time fix, silently re-breaking a device that was already correct. Rather than
 * trying to make every possible future correction "safe" to pull, this makes the DISPLAYED number
 * self-heal on its own: adjustSupplierBalanceCents still keeps it responsive within a session (so
 * recording a payment updates the screen instantly, no restart needed), but this recompute bounds how
 * long any drift — from this bug, a future one, or anything else — can last to about one sync cycle,
 * on every device, forever. No future corrective migration should ever be needed for this again.
 */
export function reconcileAllSupplierBalances(tenantId: string): void {
  getDatabase()
    .prepare(
      `
      UPDATE suppliers SET balance_cents = (
        COALESCE((
          SELECT SUM(p.received_value_cents - p.amount_paid_cents)
          FROM purchases p WHERE p.supplier_id = suppliers.id
        ), 0)
        + COALESCE((
          SELECT SUM(sbe.amount_cents) FROM supplier_balance_entries sbe
          WHERE sbe.supplier_id = suppliers.id AND sbe.reference_id IS NULL
        ), 0)
      )
      WHERE suppliers.tenant_id = ?
    `
    )
    .run(tenantId);
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

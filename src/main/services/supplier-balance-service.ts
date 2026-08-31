import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as supplierBalanceRepository from "@main/database/repositories/supplier-balance-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { supplierBalanceAdjustSchema } from "@shared/schemas/supplier-balance";
import type { SupplierBalanceEntry, SupplierBalanceEntryType } from "@shared/types/supplier-balance";

/**
 * What a supplier is owed ("stuff ordered, not yet paid") — a running total, explicitly requested to
 * be maintained incrementally rather than recomputed by summing Purchases on every read: exactly the
 * "sum the whole ledger live" mistake this business's own mobile stock reads had, fixed the same day
 * this feature was requested (see the SERVER inventory-balance migration this directly mirrors).
 *
 * Two-table shape, same as stock_movements/inventory: supplier_balance_entries is the real, synced,
 * append-only source of truth (every entry independently insertable — two devices recording a
 * purchase/payment for the same supplier at the same moment just both land, no conflict possible);
 * suppliers.balance_cents is a purely LOCAL cache, incremented here in the SAME transaction as the
 * entry insert, and re-derived the same way on pull (see sync-engine.ts's
 * applySupplierBalanceEntryPulledRow). It is NEVER synced itself — 'suppliers' is a
 * CONFLICT_AWARE_ENTITIES member, so a bare synced balance field would risk the exact lost-update
 * drift main_store_allocations had (see DESKTOP migration 77) the moment two devices each recorded a
 * purchase/payment for the same supplier before syncing.
 */
export function recordSupplierBalanceEntry(params: {
  tenantId: string;
  supplierId: string;
  entryType: SupplierBalanceEntryType;
  amountCents: number;
  referenceType: "purchase" | null;
  referenceId: string | null;
  notes: string | null;
  performedBy: string | null;
}): void {
  if (params.amountCents === 0) return;

  supplierBalanceRepository.insertBalanceEntryRow({
    id: `supplier_balance_${randomUUID()}`,
    tenantId: params.tenantId,
    supplierId: params.supplierId,
    entryType: params.entryType,
    amountCents: params.amountCents,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    notes: params.notes,
    performedBy: params.performedBy
  });
  supplierBalanceRepository.adjustSupplierBalanceCents(params.supplierId, params.amountCents);
}

function resolveEmployeeName(employeeId: string | null): string | null {
  if (!employeeId) return null;
  const row = employeeRepository.findEmployeeRowById(employeeId);
  return row ? `${row.first_name} ${row.last_name}` : null;
}

/** The one person-facing entry point onto this ledger — covers both "record balance carried forward
 * from the old system" and any later correction (see supplierBalanceAdjustSchema's own doc comment).
 * Every other entry type (purchase_ordered/purchase_cancelled/payment) is written automatically by
 * purchase-service.ts; this is the only one a person creates directly. */
export function adjustSupplierBalance(supplierId: string, input: unknown): SupplierBalanceEntry {
  requirePermission("suppliers", "edit");
  const parsed = supplierBalanceAdjustSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();

  const supplier = supplierRepository.findSupplierRowById(supplierId);
  if (!supplier || supplier.tenant_id !== tenantId) {
    throw new Error("Supplier not found");
  }

  let entryId = "";
  runInTransaction(() => {
    recordSupplierBalanceEntry({
      tenantId,
      supplierId,
      entryType: "manual_adjustment",
      amountCents: parsed.amountCents,
      referenceType: null,
      referenceId: null,
      notes: parsed.notes,
      performedBy: employeeId
    });
    const rows = supplierBalanceRepository.findBalanceEntryRowsForSupplier(supplierId, 1);
    entryId = rows[0]?.id ?? "";
  });

  const row = supplierBalanceRepository.findBalanceEntryRowById(entryId);
  if (!row) {
    throw new Error("Failed to record balance adjustment");
  }
  return supplierBalanceRepository.mapBalanceEntryRow(row, resolveEmployeeName(row.performed_by));
}

/** The supplier's own balance history — powers a "Balance History" section on its detail view /
 * statement. Most recent first. */
export function listSupplierBalanceEntries(supplierId: string): SupplierBalanceEntry[] {
  requirePermission("suppliers", "view");
  return supplierBalanceRepository
    .findBalanceEntryRowsForSupplier(supplierId)
    .map((row) => supplierBalanceRepository.mapBalanceEntryRow(row, resolveEmployeeName(row.performed_by)));
}

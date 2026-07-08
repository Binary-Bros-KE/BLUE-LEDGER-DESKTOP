import { getDatabase } from "@main/database/connection";
import type { SaleVoid, SaleVoidStatus, SaleVoidSyncStatus } from "@shared/types/sale-void";

export type SaleVoidRow = {
  id: string;
  tenant_id: string;
  sale_id: string;
  status: string;
  reason: string;
  notes: string | null;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
};

export type SaleVoidDetailRow = SaleVoidRow & {
  receipt_number: string | null;
  sale_grand_total_cents: number;
  requested_by_name: string;
  approved_by_name: string | null;
};

/** Pass null for locationId to see every branch's voids (e.g. a super-admin with no assigned branch). */
export function findAllSaleVoidRows(tenantId: string, locationId: string | null): SaleVoidDetailRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        v.*,
        s.receipt_number AS receipt_number,
        s.grand_total_cents AS sale_grand_total_cents,
        (req.first_name || ' ' || req.last_name) AS requested_by_name,
        CASE WHEN app.id IS NULL THEN NULL ELSE (app.first_name || ' ' || app.last_name) END AS approved_by_name
      FROM sale_voids v
      JOIN sales s ON s.id = v.sale_id
      JOIN employees req ON req.id = v.requested_by
      LEFT JOIN employees app ON app.id = v.approved_by
      WHERE v.tenant_id = ?
        AND (? IS NULL OR s.location_id = ?)
      ORDER BY v.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId) as SaleVoidDetailRow[];
}

export function findSaleVoidRowById(id: string): SaleVoidRow | undefined {
  return getDatabase().prepare("SELECT * FROM sale_voids WHERE id = ?").get(id) as
    | SaleVoidRow
    | undefined;
}

export function findSaleVoidDetailRowById(id: string): SaleVoidDetailRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT
        v.*,
        s.receipt_number AS receipt_number,
        s.grand_total_cents AS sale_grand_total_cents,
        (req.first_name || ' ' || req.last_name) AS requested_by_name,
        CASE WHEN app.id IS NULL THEN NULL ELSE (app.first_name || ' ' || app.last_name) END AS approved_by_name
      FROM sale_voids v
      JOIN sales s ON s.id = v.sale_id
      JOIN employees req ON req.id = v.requested_by
      LEFT JOIN employees app ON app.id = v.approved_by
      WHERE v.id = ?
    `
    )
    .get(id) as SaleVoidDetailRow | undefined;
}

export function findPendingSaleVoidForSaleRow(saleId: string): SaleVoidRow | undefined {
  return getDatabase()
    .prepare("SELECT * FROM sale_voids WHERE sale_id = ? AND status = 'pending_approval'")
    .get(saleId) as SaleVoidRow | undefined;
}

export function insertSaleVoidRow(input: {
  id: string;
  tenantId: string;
  saleId: string;
  reason: string;
  notes: string | null;
  requestedBy: string;
}): SaleVoidRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO sale_voids (
        id, tenant_id, sale_id, status, reason, notes, requested_by, requested_at, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(input.id, input.tenantId, input.saleId, input.reason, input.notes, input.requestedBy, now, now, now);

  const row = findSaleVoidRowById(input.id);
  if (!row) {
    throw new Error("Failed to create void request");
  }
  return row;
}

/** Appends the approver's notes to the requester's original notes rather than overwriting them. */
function mergeApprovalNotes(existing: string | null, approvalNotes: string | null): string | null {
  if (!approvalNotes) return existing;
  return existing ? `${existing}\n\nApprover: ${approvalNotes}` : `Approver: ${approvalNotes}`;
}

export function updateSaleVoidStatusRow(
  id: string,
  status: SaleVoidStatus,
  approvedBy: string,
  notes: string | null
): SaleVoidRow {
  const now = new Date().toISOString();
  const existing = findSaleVoidRowById(id);
  const mergedNotes = mergeApprovalNotes(existing?.notes ?? null, notes);

  getDatabase()
    .prepare(
      `
      UPDATE sale_voids SET
        status = ?,
        approved_by = ?,
        approved_at = ?,
        notes = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(status, approvedBy, now, mergedNotes, now, id);

  const row = findSaleVoidRowById(id);
  if (!row) {
    throw new Error("Void request not found after update");
  }
  return row;
}

export function mapSaleVoidDetailRow(row: SaleVoidDetailRow): SaleVoid {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    saleId: row.sale_id,
    receiptNumber: row.receipt_number,
    saleGrandTotalCents: row.sale_grand_total_cents,
    status: row.status as SaleVoidStatus,
    reason: row.reason,
    notes: row.notes,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at,
    approvedBy: row.approved_by,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as SaleVoidSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

import { getDatabase } from "@main/database/connection";
import type { InvoiceCancellation, InvoiceCancellationStatus, InvoiceCancellationSyncStatus } from "@shared/types/invoice-cancellation";

export type InvoiceCancellationRow = {
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
  synced_updated_at: string | null;
};

export type InvoiceCancellationDetailRow = InvoiceCancellationRow & {
  invoice_number: string | null;
  sale_grand_total_cents: number;
  location_id: string;
  location_name: string;
  requested_by_name: string;
  approved_by_name: string | null;
};

const DETAIL_SELECT = `
  SELECT
    ic.*,
    s.invoice_number AS invoice_number,
    s.grand_total_cents AS sale_grand_total_cents,
    s.location_id AS location_id,
    l.location_name AS location_name,
    (req.first_name || ' ' || req.last_name) AS requested_by_name,
    CASE WHEN app.id IS NULL THEN NULL ELSE (app.first_name || ' ' || app.last_name) END AS approved_by_name
  FROM invoice_cancellations ic
  JOIN sales s ON s.id = ic.sale_id
  JOIN locations l ON l.id = s.location_id
  JOIN employees req ON req.id = ic.requested_by
  LEFT JOIN employees app ON app.id = ic.approved_by
`;

/** Pass null for locationId to see every branch's requests (e.g. a super-admin with no assigned branch). */
export function findAllInvoiceCancellationRows(tenantId: string, locationId: string | null): InvoiceCancellationDetailRow[] {
  return getDatabase()
    .prepare(
      `${DETAIL_SELECT}
      WHERE ic.tenant_id = ?
        AND (? IS NULL OR s.location_id = ?)
      ORDER BY ic.created_at DESC`
    )
    .all(tenantId, locationId, locationId) as InvoiceCancellationDetailRow[];
}

export function findInvoiceCancellationRowById(id: string): InvoiceCancellationRow | undefined {
  return getDatabase().prepare("SELECT * FROM invoice_cancellations WHERE id = ?").get(id) as
    | InvoiceCancellationRow
    | undefined;
}

export function findInvoiceCancellationDetailRowById(id: string): InvoiceCancellationDetailRow | undefined {
  return getDatabase().prepare(`${DETAIL_SELECT} WHERE ic.id = ?`).get(id) as InvoiceCancellationDetailRow | undefined;
}

export function findPendingInvoiceCancellationForSaleRow(saleId: string): InvoiceCancellationRow | undefined {
  return getDatabase()
    .prepare("SELECT * FROM invoice_cancellations WHERE sale_id = ? AND status = 'pending_approval'")
    .get(saleId) as InvoiceCancellationRow | undefined;
}

/** Always inserted 'pending_approval' — the caller (invoice-cancellation-service.ts) immediately
 * transitions it to 'approved' via updateInvoiceCancellationStatusRow for the direct-cancel path, so
 * both routes end up going through the exact same status-transition (and its sync re-enqueue), not
 * two different insert shapes for what's ultimately the same lifecycle. */
export function insertInvoiceCancellationRow(input: {
  id: string;
  tenantId: string;
  saleId: string;
  reason: string;
  notes: string | null;
  requestedBy: string;
}): InvoiceCancellationRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO invoice_cancellations (
        id, tenant_id, sale_id, status, reason, notes, requested_by, requested_at, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(input.id, input.tenantId, input.saleId, input.reason, input.notes, input.requestedBy, now, now, now);

  const row = findInvoiceCancellationRowById(input.id);
  if (!row) {
    throw new Error("Failed to create cancellation request");
  }
  return row;
}

/** Appends the approver's notes to the requester's original notes rather than overwriting them —
 * same convention as sale-void-repository.ts's own mergeApprovalNotes. */
function mergeApprovalNotes(existing: string | null, approvalNotes: string | null): string | null {
  if (!approvalNotes) return existing;
  return existing ? `${existing}\n\nApprover: ${approvalNotes}` : `Approver: ${approvalNotes}`;
}

export function updateInvoiceCancellationStatusRow(
  id: string,
  status: InvoiceCancellationStatus,
  approvedBy: string,
  notes: string | null
): InvoiceCancellationRow {
  const now = new Date().toISOString();
  const existing = findInvoiceCancellationRowById(id);
  const mergedNotes = mergeApprovalNotes(existing?.notes ?? null, notes);

  getDatabase()
    .prepare(
      `
      UPDATE invoice_cancellations SET
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

  const row = findInvoiceCancellationRowById(id);
  if (!row) {
    throw new Error("Cancellation request not found after update");
  }
  return row;
}

export function mapInvoiceCancellationDetailRow(row: InvoiceCancellationDetailRow): InvoiceCancellation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    saleId: row.sale_id,
    invoiceNumber: row.invoice_number,
    saleGrandTotalCents: row.sale_grand_total_cents,
    locationId: row.location_id,
    locationName: row.location_name,
    status: row.status as InvoiceCancellationStatus,
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
    syncStatus: row.sync_status as InvoiceCancellationSyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

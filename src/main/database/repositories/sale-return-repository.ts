import { getDatabase } from "@main/database/connection";
import type { SaleReturn, SaleReturnItem, SaleReturnStatus, SaleReturnSyncStatus } from "@shared/types/sale-return";

export type SaleReturnRow = {
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

export type SaleReturnDetailRow = SaleReturnRow & {
  receipt_number: string | null;
  location_id: string;
  location_name: string;
  requested_by_name: string;
  approved_by_name: string | null;
};

export type SaleReturnItemRow = {
  id: string;
  sale_return_id: string;
  sale_item_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  created_at: string;
};

export type SaleReturnItemDetailRow = SaleReturnItemRow & {
  product_name: string;
};

/** Pass null for locationId to see every branch's returns (e.g. a super-admin with no assigned branch). */
export function findAllSaleReturnRows(tenantId: string, locationId: string | null): SaleReturnDetailRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        r.*,
        s.receipt_number AS receipt_number,
        s.location_id AS location_id,
        l.location_name AS location_name,
        (req.first_name || ' ' || req.last_name) AS requested_by_name,
        CASE WHEN app.id IS NULL THEN NULL ELSE (app.first_name || ' ' || app.last_name) END AS approved_by_name
      FROM sale_returns r
      JOIN sales s ON s.id = r.sale_id
      JOIN locations l ON l.id = s.location_id
      JOIN employees req ON req.id = r.requested_by
      LEFT JOIN employees app ON app.id = r.approved_by
      WHERE r.tenant_id = ?
        AND (? IS NULL OR s.location_id = ?)
      ORDER BY r.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId) as SaleReturnDetailRow[];
}

export function findSaleReturnRowById(id: string): SaleReturnRow | undefined {
  return getDatabase().prepare("SELECT * FROM sale_returns WHERE id = ?").get(id) as
    | SaleReturnRow
    | undefined;
}

export function findSaleReturnDetailRowById(id: string): SaleReturnDetailRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT
        r.*,
        s.receipt_number AS receipt_number,
        s.location_id AS location_id,
        l.location_name AS location_name,
        (req.first_name || ' ' || req.last_name) AS requested_by_name,
        CASE WHEN app.id IS NULL THEN NULL ELSE (app.first_name || ' ' || app.last_name) END AS approved_by_name
      FROM sale_returns r
      JOIN sales s ON s.id = r.sale_id
      JOIN locations l ON l.id = s.location_id
      JOIN employees req ON req.id = r.requested_by
      LEFT JOIN employees app ON app.id = r.approved_by
      WHERE r.id = ?
    `
    )
    .get(id) as SaleReturnDetailRow | undefined;
}

export function findSaleReturnItemDetailRows(saleReturnId: string): SaleReturnItemDetailRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT ri.*, p.name AS product_name
      FROM sale_return_items ri
      JOIN products p ON p.id = ri.product_id
      WHERE ri.sale_return_id = ?
      ORDER BY ri.created_at ASC
    `
    )
    .all(saleReturnId) as SaleReturnItemDetailRow[];
}

/** Total quantity already returned (and approved) for a given sale item — bounds how much more can be requested. */
export function findApprovedReturnedQuantityForSaleItem(saleItemId: string): number {
  const row = getDatabase()
    .prepare(
      `
      SELECT COALESCE(SUM(ri.quantity), 0) as total
      FROM sale_return_items ri
      JOIN sale_returns r ON r.id = ri.sale_return_id
      WHERE ri.sale_item_id = ? AND r.status = 'approved'
    `
    )
    .get(saleItemId) as { total: number };
  return row.total;
}

export function insertSaleReturnRow(input: {
  id: string;
  tenantId: string;
  saleId: string;
  reason: string;
  notes: string | null;
  requestedBy: string;
}): SaleReturnRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO sale_returns (
        id, tenant_id, sale_id, status, reason, notes, requested_by, requested_at, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(input.id, input.tenantId, input.saleId, input.reason, input.notes, input.requestedBy, now, now, now);

  const row = findSaleReturnRowById(input.id);
  if (!row) {
    throw new Error("Failed to create return request");
  }
  return row;
}

export function insertSaleReturnItemRow(input: {
  id: string;
  saleReturnId: string;
  saleItemId: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}): SaleReturnItemRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO sale_return_items (
        id, sale_return_id, sale_item_id, product_id, quantity, unit_price_cents, line_total_cents, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.id,
      input.saleReturnId,
      input.saleItemId,
      input.productId,
      input.quantity,
      input.unitPriceCents,
      input.lineTotalCents,
      now
    );

  const row = getDatabase().prepare("SELECT * FROM sale_return_items WHERE id = ?").get(input.id) as
    | SaleReturnItemRow
    | undefined;
  if (!row) {
    throw new Error("Failed to create return item record");
  }
  return row;
}

/** Appends the approver's notes to the requester's original notes rather than overwriting them. */
function mergeApprovalNotes(existing: string | null, approvalNotes: string | null): string | null {
  if (!approvalNotes) return existing;
  return existing ? `${existing}\n\nApprover: ${approvalNotes}` : `Approver: ${approvalNotes}`;
}

export function updateSaleReturnStatusRow(
  id: string,
  status: SaleReturnStatus,
  approvedBy: string,
  notes: string | null
): SaleReturnRow {
  const now = new Date().toISOString();
  const existing = findSaleReturnRowById(id);
  const mergedNotes = mergeApprovalNotes(existing?.notes ?? null, notes);

  getDatabase()
    .prepare(
      `
      UPDATE sale_returns SET
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

  const row = findSaleReturnRowById(id);
  if (!row) {
    throw new Error("Return request not found after update");
  }
  return row;
}

export function mapSaleReturnItemDetailRow(row: SaleReturnItemDetailRow): SaleReturnItem {
  return {
    id: row.id,
    saleReturnId: row.sale_return_id,
    saleItemId: row.sale_item_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    lineTotalCents: row.line_total_cents,
    createdAt: row.created_at
  };
}

export function mapSaleReturnDetailRow(row: SaleReturnDetailRow, items: SaleReturnItem[]): SaleReturn {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    saleId: row.sale_id,
    receiptNumber: row.receipt_number,
    locationId: row.location_id,
    locationName: row.location_name,
    status: row.status as SaleReturnStatus,
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
    syncStatus: row.sync_status as SaleReturnSyncStatus,
    lastSyncedAt: row.last_synced_at,
    items
  };
}

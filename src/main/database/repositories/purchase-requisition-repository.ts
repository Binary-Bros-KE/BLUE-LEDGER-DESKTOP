import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";
import type { PurchaseStatus } from "@shared/types/purchase";
import type { PurchaseRequisitionStatus } from "@shared/types/purchase-requisition";

export type PurchaseRequisitionRow = {
  id: string;
  tenant_id: string;
  requisition_number: string;
  storefront_id: string;
  storefront_name: string;
  status: PurchaseRequisitionStatus;
  notes: string | null;
  rejection_reason: string | null;
  purchase_id: string | null;
  purchase_number: string | null;
  purchase_status: PurchaseStatus | null;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
  total_quantity_requested: number;
  unlinked_item_count: number;
};

export type PurchaseRequisitionItemRow = {
  id: string;
  purchase_requisition_id: string;
  product_id: string | null;
  item_name: string;
  product_name: string | null;
  sku: string | null;
  quantity_requested: number;
  notes: string | null;
};

// LEFT JOIN on purchases: the linked purchase may not have arrived on this device yet (sync order),
// in which case purchase_number/purchase_status are simply null until it does.
const SELECT_WITH_JOINS = `
  SELECT pr.*,
    l.location_name AS storefront_name,
    (req.first_name || ' ' || req.last_name) AS requested_by_name,
    CASE WHEN pr.reviewed_by IS NOT NULL THEN (rev.first_name || ' ' || rev.last_name) ELSE NULL END AS reviewed_by_name,
    p.purchase_number AS purchase_number,
    p.status AS purchase_status,
    (SELECT COUNT(*) FROM purchase_requisition_items pri WHERE pri.purchase_requisition_id = pr.id) AS item_count,
    (SELECT COALESCE(SUM(pri.quantity_requested), 0) FROM purchase_requisition_items pri WHERE pri.purchase_requisition_id = pr.id) AS total_quantity_requested,
    (SELECT COUNT(*) FROM purchase_requisition_items pri WHERE pri.purchase_requisition_id = pr.id AND pri.product_id IS NULL) AS unlinked_item_count
  FROM purchase_requisitions pr
  JOIN locations l ON l.id = pr.storefront_id
  JOIN employees req ON req.id = pr.requested_by
  LEFT JOIN employees rev ON rev.id = pr.reviewed_by
  LEFT JOIN purchases p ON p.id = pr.purchase_id
`;

// Returns every matching number, not just the max — see document-number-service.ts's own comment.
export function findRequisitionNumberRows(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT requisition_number FROM purchase_requisitions WHERE tenant_id = ? AND requisition_number LIKE 'REQ-%'")
      .all(tenantId) as Array<{ requisition_number: string }>
  ).map((row) => row.requisition_number);
}

export function findRequisitionRowById(id: string): PurchaseRequisitionRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_JOINS} WHERE pr.id = ?`).get(id) as PurchaseRequisitionRow | undefined;
}

/** locationId null = every storefront's (unassigned Super Admin); non-null = one storefront, matching
 * getCurrentBranchScope() — same convention as stock-request-repository.ts. */
export function findAllRequisitionRows(tenantId: string, locationId: string | null): PurchaseRequisitionRow[] {
  return getDatabase()
    .prepare(`${SELECT_WITH_JOINS} WHERE pr.tenant_id = ? AND (? IS NULL OR pr.storefront_id = ?) ORDER BY pr.created_at DESC`)
    .all(tenantId, locationId, locationId) as PurchaseRequisitionRow[];
}

export function findRequisitionItemRows(requisitionId: string): PurchaseRequisitionItemRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT pri.id, pri.purchase_requisition_id, pri.product_id, pri.item_name, pri.quantity_requested, pri.notes,
        p.name AS product_name, p.sku
      FROM purchase_requisition_items pri
      LEFT JOIN products p ON p.id = pri.product_id
      WHERE pri.purchase_requisition_id = ?
      ORDER BY pri.created_at ASC, pri.id ASC
    `
    )
    .all(requisitionId) as PurchaseRequisitionItemRow[];
}

export function insertRequisitionRow(input: {
  tenantId: string;
  requisitionNumber: string;
  storefrontId: string;
  notes: string | null;
  requestedBy: string;
}): string {
  const id = `preq_${randomUUID()}`;
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO purchase_requisitions (
        id, tenant_id, requisition_number, storefront_id, status, notes, requested_by, requested_at,
        created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(id, input.tenantId, input.requisitionNumber, input.storefrontId, input.notes, input.requestedBy, now, now, now);

  return id;
}

export function insertRequisitionItemRow(input: {
  requisitionId: string;
  productId: string | null;
  itemName: string;
  quantityRequested: number;
  notes: string | null;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO purchase_requisition_items (id, purchase_requisition_id, product_id, item_name, quantity_requested, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `preqi_${randomUUID()}`,
      input.requisitionId,
      input.productId,
      input.itemName,
      input.quantityRequested,
      input.notes,
      new Date().toISOString()
    );
}

/** Items carry no sync trigger of their own on UPDATE — bumping the header's updated_at in the same
 * call is what re-pushes the requisition (trg_purchase_requisitions_sync_au). */
export function updateRequisitionItemProductRow(requisitionId: string, itemId: string, productId: string): void {
  const db = getDatabase();
  db.prepare("UPDATE purchase_requisition_items SET product_id = ? WHERE id = ? AND purchase_requisition_id = ?").run(
    productId,
    itemId,
    requisitionId
  );
  db.prepare("UPDATE purchase_requisitions SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), requisitionId);
}

export function updateRequisitionDecisionRow(
  id: string,
  input: {
    status: Exclude<PurchaseRequisitionStatus, "pending">;
    rejectionReason: string | null;
    purchaseId: string | null;
    reviewedBy: string;
  }
): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE purchase_requisitions
       SET status = ?, rejection_reason = ?, purchase_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(input.status, input.rejectionReason, input.purchaseId, input.reviewedBy, now, now, id);
}

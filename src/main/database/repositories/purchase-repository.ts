import { getDatabase } from "@main/database/connection";
import { computePurchasePaymentStatus } from "@shared/lib/purchase";
import type {
  Purchase,
  PurchaseItem,
  PurchaseListItem,
  PurchasePayment,
  PurchasePaymentStatus,
  PurchaseStatus,
  PurchaseSummary,
  PurchaseSyncStatus,
  PurchaseTaxType
} from "@shared/types/purchase";

export type PurchaseRow = {
  id: string;
  tenant_id: string;
  purchase_number: string;
  supplier_id: string;
  supplier_invoice_number: string | null;
  location_id: string;
  status: string;
  tax_type: string;
  subtotal_cents: number;
  discount_amount_cents: number;
  tax_amount_cents: number;
  shipping_cost_cents: number;
  grand_total_cents: number;
  payment_method_id: string | null;
  payment_reference: string | null;
  payment_status: string;
  amount_paid_cents: number;
  payments: string;
  notes: string | null;
  attachment_path: string | null;
  ordered_at: string | null;
  received_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

export type PurchaseDetailRow = PurchaseRow & {
  supplier_name: string;
  location_name: string;
  payment_method_name: string | null;
  created_by_name: string | null;
};

export type PurchaseListRow = {
  id: string;
  purchase_number: string;
  supplier_id: string;
  supplier_name: string;
  supplier_invoice_number: string | null;
  location_id: string;
  location_name: string;
  status: string;
  tax_type: string;
  grand_total_cents: number;
  payment_status: string;
  amount_paid_cents: number;
  ordered_at: string | null;
  received_at: string | null;
  created_at: string;
};

export type PurchaseItemRow = {
  id: string;
  purchase_id: string;
  product_id: string;
  ordered_quantity: number;
  received_quantity: number;
  remaining_quantity: number;
  unit_cost_cents: number;
  discount_amount_cents: number;
  tax_type: string;
  tax_amount_cents: number;
  line_total_cents: number;
  created_at: string;
  updated_at: string;
};

export type PurchaseItemDetailRow = PurchaseItemRow & {
  product_name: string;
  sku: string;
};

/** Pass null for locationId to see every branch's purchases (e.g. a super-admin with no assigned branch). */
export function findAllPurchaseListRows(tenantId: string, locationId: string | null): PurchaseListRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        p.id,
        p.purchase_number,
        p.supplier_id,
        s.business_name AS supplier_name,
        p.supplier_invoice_number,
        p.location_id,
        l.location_name AS location_name,
        p.status,
        p.tax_type,
        p.grand_total_cents,
        p.payment_status,
        p.amount_paid_cents,
        p.ordered_at,
        p.received_at,
        p.created_at
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      JOIN locations l ON l.id = p.location_id
      WHERE p.tenant_id = ? AND (? IS NULL OR p.location_id = ?)
      ORDER BY p.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId) as PurchaseListRow[];
}

/** Cancelled purchases created within [startIso, endIsoExclusive) — dated by created_at, matching how
 * every other Sales Report figure windows its period. Reports assume a cancelled purchase was never
 * paid (or the money was returned), so it's shown here as informational context, never added into any
 * revenue/expense total. */
export function findCancelledPurchaseRowsInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): PurchaseListRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        p.id,
        p.purchase_number,
        p.supplier_id,
        s.business_name AS supplier_name,
        p.supplier_invoice_number,
        p.location_id,
        l.location_name AS location_name,
        p.status,
        p.tax_type,
        p.grand_total_cents,
        p.payment_status,
        p.amount_paid_cents,
        p.ordered_at,
        p.received_at,
        p.created_at
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      JOIN locations l ON l.id = p.location_id
      WHERE p.tenant_id = ? AND p.status = 'cancelled'
        AND (? IS NULL OR p.location_id = ?)
        AND p.created_at >= ? AND p.created_at < ?
      ORDER BY p.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId, startIso, endIsoExclusive) as PurchaseListRow[];
}

export function mapPurchaseListRow(row: PurchaseListRow): PurchaseListItem {
  return {
    id: row.id,
    purchaseNumber: row.purchase_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierInvoiceNumber: row.supplier_invoice_number,
    locationId: row.location_id,
    locationName: row.location_name,
    status: row.status as PurchaseStatus,
    taxType: row.tax_type as PurchaseTaxType,
    grandTotalCents: row.grand_total_cents,
    paymentStatus: row.payment_status as PurchasePaymentStatus,
    amountPaidCents: row.amount_paid_cents,
    orderedAt: row.ordered_at,
    receivedAt: row.received_at,
    createdAt: row.created_at
  };
}

export type PurchaseSummaryRow = {
  total_purchases: number;
  draft_count: number;
  ordered_count: number;
  partially_received_count: number;
  received_count: number;
  outstanding_supplier_payments_cents: number;
};

export function findPurchaseSummaryRow(tenantId: string, locationId: string | null): PurchaseSummaryRow {
  return getDatabase()
    .prepare(
      `
      SELECT
        COUNT(*) AS total_purchases,
        COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft_count,
        COALESCE(SUM(CASE WHEN status = 'ordered' THEN 1 ELSE 0 END), 0) AS ordered_count,
        COALESCE(SUM(CASE WHEN status = 'partially_received' THEN 1 ELSE 0 END), 0) AS partially_received_count,
        COALESCE(SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END), 0) AS received_count,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN grand_total_cents - amount_paid_cents ELSE 0 END), 0)
          AS outstanding_supplier_payments_cents
      FROM purchases
      WHERE tenant_id = ? AND (? IS NULL OR location_id = ?)
    `
    )
    .get(tenantId, locationId, locationId) as PurchaseSummaryRow;
}

export function mapPurchaseSummaryRow(row: PurchaseSummaryRow): PurchaseSummary {
  return {
    totalPurchases: row.total_purchases,
    draftCount: row.draft_count,
    orderedCount: row.ordered_count,
    partiallyReceivedCount: row.partially_received_count,
    receivedCount: row.received_count,
    outstandingSupplierPaymentsCents: row.outstanding_supplier_payments_cents
  };
}

// Returns every matching number, not just the max — see document-number-service.ts's own comment.
export function findMaxPurchaseNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT purchase_number FROM purchases WHERE tenant_id = ? AND purchase_number LIKE 'PO-%'")
      .all(tenantId) as Array<{ purchase_number: string }>
  ).map((row) => row.purchase_number);
}

export function findPurchaseRowById(id: string): PurchaseRow | undefined {
  return getDatabase().prepare("SELECT * FROM purchases WHERE id = ?").get(id) as PurchaseRow | undefined;
}

export function findPurchaseDetailRowById(id: string): PurchaseDetailRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT
        p.*,
        s.business_name AS supplier_name,
        l.location_name AS location_name,
        pm.name AS payment_method_name,
        (e.first_name || ' ' || e.last_name) AS created_by_name
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      JOIN locations l ON l.id = p.location_id
      LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
      LEFT JOIN employees e ON e.id = p.created_by
      WHERE p.id = ?
    `
    )
    .get(id) as PurchaseDetailRow | undefined;
}

export function findPurchaseBySupplierInvoiceRow(
  tenantId: string,
  supplierId: string,
  supplierInvoiceNumber: string,
  excludeId?: string
): PurchaseRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId
    ? [tenantId, supplierId, supplierInvoiceNumber, excludeId]
    : [tenantId, supplierId, supplierInvoiceNumber];
  return getDatabase()
    .prepare(
      `SELECT * FROM purchases WHERE tenant_id = ? AND supplier_id = ? AND supplier_invoice_number = ? ${excludeClause}`
    )
    .get(...params) as PurchaseRow | undefined;
}

export function findPurchaseItemRowsForPurchase(purchaseId: string): PurchaseItemRow[] {
  return getDatabase()
    .prepare("SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY created_at ASC")
    .all(purchaseId) as PurchaseItemRow[];
}

export function findPurchaseItemDetailRowsForPurchase(purchaseId: string): PurchaseItemDetailRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT pi.*, p.name AS product_name, p.sku AS sku
      FROM purchase_items pi
      JOIN products p ON p.id = pi.product_id
      WHERE pi.purchase_id = ?
      ORDER BY pi.created_at ASC
    `
    )
    .all(purchaseId) as PurchaseItemDetailRow[];
}

export function findPurchaseItemRowById(id: string): PurchaseItemRow | undefined {
  return getDatabase().prepare("SELECT * FROM purchase_items WHERE id = ?").get(id) as
    | PurchaseItemRow
    | undefined;
}

export function insertPurchaseRow(input: {
  id: string;
  tenantId: string;
  purchaseNumber: string;
  supplierId: string;
  supplierInvoiceNumber: string | null;
  locationId: string;
  status: PurchaseStatus;
  taxType: PurchaseTaxType;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  shippingCostCents: number;
  grandTotalCents: number;
  notes: string | null;
  attachmentPath: string | null;
  orderedAt: string | null;
  createdBy: string | null;
}): PurchaseRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO purchases (
        id, tenant_id, purchase_number, supplier_id, supplier_invoice_number, location_id, status,
        tax_type, subtotal_cents, discount_amount_cents, tax_amount_cents, shipping_cost_cents, grand_total_cents,
        notes, attachment_path, ordered_at, created_by, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.purchaseNumber,
      input.supplierId,
      input.supplierInvoiceNumber,
      input.locationId,
      input.status,
      input.taxType,
      input.subtotalCents,
      input.discountAmountCents,
      input.taxAmountCents,
      input.shippingCostCents,
      input.grandTotalCents,
      input.notes,
      input.attachmentPath,
      input.orderedAt,
      input.createdBy,
      now,
      now
    );

  const row = findPurchaseRowById(input.id);
  if (!row) {
    throw new Error("Failed to create purchase record");
  }
  return row;
}

export function updatePurchaseRow(
  id: string,
  input: {
    supplierId: string;
    supplierInvoiceNumber: string | null;
    locationId: string;
    taxType: PurchaseTaxType;
    subtotalCents: number;
    discountAmountCents: number;
    taxAmountCents: number;
    shippingCostCents: number;
    grandTotalCents: number;
    notes: string | null;
    attachmentPath: string | null;
  }
): PurchaseRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE purchases SET
        supplier_id = ?,
        supplier_invoice_number = ?,
        location_id = ?,
        tax_type = ?,
        subtotal_cents = ?,
        discount_amount_cents = ?,
        tax_amount_cents = ?,
        shipping_cost_cents = ?,
        grand_total_cents = ?,
        notes = ?,
        attachment_path = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.supplierId,
      input.supplierInvoiceNumber,
      input.locationId,
      input.taxType,
      input.subtotalCents,
      input.discountAmountCents,
      input.taxAmountCents,
      input.shippingCostCents,
      input.grandTotalCents,
      input.notes,
      input.attachmentPath,
      now,
      id
    );

  const row = findPurchaseRowById(id);
  if (!row) {
    throw new Error("Purchase not found after update");
  }
  return row;
}

export function insertPurchaseItemRow(input: {
  id: string;
  purchaseId: string;
  productId: string;
  orderedQuantity: number;
  unitCostCents: number;
  discountAmountCents: number;
  taxType: string;
  taxAmountCents: number;
  lineTotalCents: number;
}): PurchaseItemRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO purchase_items (
        id, purchase_id, product_id, ordered_quantity, received_quantity, unit_cost_cents,
        discount_amount_cents, tax_type, tax_amount_cents, line_total_cents, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.id,
      input.purchaseId,
      input.productId,
      input.orderedQuantity,
      input.unitCostCents,
      input.discountAmountCents,
      input.taxType,
      input.taxAmountCents,
      input.lineTotalCents,
      now,
      now
    );

  const row = findPurchaseItemRowById(input.id);
  if (!row) {
    throw new Error("Failed to create purchase item record");
  }
  return row;
}

export function deletePurchaseItemsForPurchaseRow(purchaseId: string): void {
  getDatabase().prepare("DELETE FROM purchase_items WHERE purchase_id = ?").run(purchaseId);
}

export function updatePurchaseItemReceivedQuantityRow(id: string, receivedQuantity: number): PurchaseItemRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE purchase_items SET received_quantity = ?, updated_at = ? WHERE id = ?")
    .run(receivedQuantity, now, id);

  const row = findPurchaseItemRowById(id);
  if (!row) {
    throw new Error("Purchase item not found after receiving update");
  }
  return row;
}

export function updatePurchaseStatusRow(
  id: string,
  status: PurchaseStatus,
  timestamps?: { orderedAt?: string; receivedAt?: string }
): PurchaseRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE purchases SET
        status = ?,
        ordered_at = COALESCE(?, ordered_at),
        received_at = COALESCE(?, received_at),
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(status, timestamps?.orderedAt ?? null, timestamps?.receivedAt ?? null, now, id);

  const row = findPurchaseRowById(id);
  if (!row) {
    throw new Error("Purchase not found after status update");
  }
  return row;
}

/** Appends a payment to the purchase's payment history and persists the recalculated totals — the
 * header payment_method_id/payment_reference columns mirror the most recent payment for quick display. */
export function appendPaymentToPurchaseRow(input: {
  id: string;
  payments: PurchasePayment[];
  amountPaidCents: number;
  paymentStatus: PurchasePaymentStatus;
  paymentMethodId: string;
  paymentReference: string | null;
}): PurchaseRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE purchases SET
        payments = ?,
        amount_paid_cents = ?,
        payment_status = ?,
        payment_method_id = ?,
        payment_reference = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      JSON.stringify(input.payments),
      input.amountPaidCents,
      input.paymentStatus,
      input.paymentMethodId,
      input.paymentReference,
      now,
      input.id
    );

  const row = findPurchaseRowById(input.id);
  if (!row) {
    throw new Error("Purchase not found after recording payment");
  }
  return row;
}

export function deletePurchaseRow(id: string): void {
  getDatabase().prepare("DELETE FROM purchases WHERE id = ?").run(id);
}

export function mapPurchaseItemDetailRow(row: PurchaseItemDetailRow): PurchaseItem {
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    orderedQuantity: row.ordered_quantity,
    receivedQuantity: row.received_quantity,
    remainingQuantity: row.remaining_quantity,
    unitCostCents: row.unit_cost_cents,
    discountAmountCents: row.discount_amount_cents,
    taxType: row.tax_type as PurchaseItem["taxType"],
    taxAmountCents: row.tax_amount_cents,
    lineTotalCents: row.line_total_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parsePurchasePayments(raw: string): PurchasePayment[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PurchasePayment[]) : [];
  } catch {
    return [];
  }
}

export function mapPurchaseDetailRow(row: PurchaseDetailRow, items: PurchaseItem[]): Purchase {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    purchaseNumber: row.purchase_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierInvoiceNumber: row.supplier_invoice_number,
    locationId: row.location_id,
    locationName: row.location_name,
    status: row.status as PurchaseStatus,
    taxType: row.tax_type as PurchaseTaxType,
    subtotalCents: row.subtotal_cents,
    discountAmountCents: row.discount_amount_cents,
    taxAmountCents: row.tax_amount_cents,
    shippingCostCents: row.shipping_cost_cents,
    grandTotalCents: row.grand_total_cents,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name,
    paymentReference: row.payment_reference,
    paymentStatus: computePurchasePaymentStatus({
      grandTotalCents: row.grand_total_cents,
      amountPaidCents: row.amount_paid_cents
    }),
    amountPaidCents: row.amount_paid_cents,
    payments: parsePurchasePayments(row.payments),
    notes: row.notes,
    attachmentPath: row.attachment_path,
    orderedAt: row.ordered_at,
    receivedAt: row.received_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as PurchaseSyncStatus,
    lastSyncedAt: row.last_synced_at,
    items
  };
}

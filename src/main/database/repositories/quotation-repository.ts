import { getDatabase } from "@main/database/connection";
import { computeQuotationStatus } from "@shared/lib/quotation";
import type {
  Quotation,
  QuotationItem,
  QuotationListItem,
  QuotationStatus,
  QuotationSyncStatus
} from "@shared/types/quotation";
import type { SaleDelivery, SaleServiceCharge } from "@shared/types/sale";

export type QuotationRow = {
  id: string;
  tenant_id: string;
  quotation_number: string;
  customer_id: string;
  location_id: string;
  employee_id: string;
  status: string;
  subtotal_cents: number;
  discount_amount_cents: number;
  tax_amount_cents: number;
  grand_total_cents: number;
  valid_until: string;
  notes: string | null;
  converted_sale_id: string | null;
  converted_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

export type QuotationDetailRow = QuotationRow & {
  customer_name: string;
  location_name: string;
  employee_name: string;
};

export type QuotationListRow = QuotationDetailRow;

export type QuotationItemRow = {
  id: string;
  quotation_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  discount_amount_cents: number;
  tax_type: string;
  tax_amount_cents: number;
  line_total_cents: number;
  is_locally_sourced: number;
  local_cost_cents: number | null;
  local_supplier_id: string | null;
  created_at: string;
};

export type QuotationItemDetailRow = QuotationItemRow & {
  product_name: string;
  sku: string;
  local_supplier_name: string | null;
};

const DETAIL_SELECT = `
  SELECT
    q.*,
    c.name AS customer_name,
    l.location_name AS location_name,
    (e.first_name || ' ' || e.last_name) AS employee_name
  FROM quotations q
  JOIN customers c ON c.id = q.customer_id
  JOIN locations l ON l.id = q.location_id
  JOIN employees e ON e.id = q.employee_id
`;

/** Pass null for locationId to see every branch's quotations (e.g. a super-admin with no assigned branch). */
export function findAllQuotationListRows(tenantId: string, locationId: string | null): QuotationListRow[] {
  return getDatabase()
    .prepare(
      `
      ${DETAIL_SELECT}
      WHERE q.tenant_id = ?
        AND (? IS NULL OR q.location_id = ?)
      ORDER BY q.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId) as QuotationListRow[];
}

/** Lightweight rows (no joins) for computing the dashboard summary counts. */
export function findQuotationStatusRows(
  tenantId: string,
  locationId: string | null
): Array<{ status: string; valid_until: string }> {
  return getDatabase()
    .prepare(
      `
      SELECT status, valid_until FROM quotations
      WHERE tenant_id = ?
        AND (? IS NULL OR location_id = ?)
    `
    )
    .all(tenantId, locationId, locationId) as Array<{ status: string; valid_until: string }>;
}

export function findQuotationRowById(id: string): QuotationRow | undefined {
  return getDatabase().prepare("SELECT * FROM quotations WHERE id = ?").get(id) as
    | QuotationRow
    | undefined;
}

export function findQuotationDetailRowById(id: string): QuotationDetailRow | undefined {
  return getDatabase()
    .prepare(`${DETAIL_SELECT} WHERE q.id = ?`)
    .get(id) as QuotationDetailRow | undefined;
}

export function findQuotationItemDetailRows(quotationId: string): QuotationItemDetailRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT qi.*, p.name AS product_name, p.sku AS sku, sup.business_name AS local_supplier_name
      FROM quotation_items qi
      JOIN products p ON p.id = qi.product_id
      LEFT JOIN suppliers sup ON sup.id = qi.local_supplier_id
      WHERE qi.quotation_id = ?
      ORDER BY qi.created_at ASC
    `
    )
    .all(quotationId) as QuotationItemDetailRow[];
}

// Returns every matching number, not just the max — see document-number-service.ts's own comment.
export function findMaxQuotationNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT quotation_number FROM quotations WHERE tenant_id = ? AND quotation_number LIKE 'QT-%'")
      .all(tenantId) as Array<{ quotation_number: string }>
  ).map((row) => row.quotation_number);
}

export function insertQuotationRow(input: {
  id: string;
  tenantId: string;
  quotationNumber: string;
  customerId: string;
  locationId: string;
  employeeId: string;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
  validUntil: string;
  notes: string | null;
}): QuotationRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO quotations (
        id, tenant_id, quotation_number, customer_id, location_id, employee_id, status,
        subtotal_cents, discount_amount_cents, tax_amount_cents, grand_total_cents,
        valid_until, notes, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.quotationNumber,
      input.customerId,
      input.locationId,
      input.employeeId,
      input.subtotalCents,
      input.discountAmountCents,
      input.taxAmountCents,
      input.grandTotalCents,
      input.validUntil,
      input.notes,
      now,
      now
    );

  const row = findQuotationRowById(input.id);
  if (!row) {
    throw new Error("Failed to create quotation record");
  }
  return row;
}

export function insertQuotationItemRow(input: {
  id: string;
  quotationId: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
  discountAmountCents: number;
  taxType: string;
  taxAmountCents: number;
  lineTotalCents: number;
  isLocallySourced: boolean;
  localCostCents: number | null;
  localSupplierId: string | null;
}): QuotationItemRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO quotation_items (
        id, quotation_id, product_id, quantity, unit_price_cents,
        discount_amount_cents, tax_type, tax_amount_cents, line_total_cents,
        is_locally_sourced, local_cost_cents, local_supplier_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.id,
      input.quotationId,
      input.productId,
      input.quantity,
      input.unitPriceCents,
      input.discountAmountCents,
      input.taxType,
      input.taxAmountCents,
      input.lineTotalCents,
      input.isLocallySourced ? 1 : 0,
      input.localCostCents,
      input.localSupplierId,
      now
    );

  const row = getDatabase().prepare("SELECT * FROM quotation_items WHERE id = ?").get(input.id) as
    | QuotationItemRow
    | undefined;
  if (!row) {
    throw new Error("Failed to create quotation item record");
  }
  return row;
}

export function deleteQuotationItemsForQuotationRow(quotationId: string): void {
  getDatabase().prepare("DELETE FROM quotation_items WHERE quotation_id = ?").run(quotationId);
}

export function updateQuotationRow(
  id: string,
  input: {
    customerId: string;
    subtotalCents: number;
    discountAmountCents: number;
    taxAmountCents: number;
    grandTotalCents: number;
    validUntil: string;
    notes: string | null;
  }
): QuotationRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE quotations SET
        customer_id = ?,
        subtotal_cents = ?,
        discount_amount_cents = ?,
        tax_amount_cents = ?,
        grand_total_cents = ?,
        valid_until = ?,
        notes = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.customerId,
      input.subtotalCents,
      input.discountAmountCents,
      input.taxAmountCents,
      input.grandTotalCents,
      input.validUntil,
      input.notes,
      now,
      id
    );

  const row = findQuotationRowById(id);
  if (!row) {
    throw new Error("Quotation not found after update");
  }
  return row;
}

export function updateQuotationStatusRow(id: string, status: QuotationStatus): QuotationRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE quotations SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findQuotationRowById(id);
  if (!row) {
    throw new Error("Quotation not found after status update");
  }
  return row;
}

/** Marks a quotation as converted and links the resulting sale/invoice — the quotation row itself is
 * never deleted, so it stays available for historical reporting and conversion analytics. */
export function markQuotationConvertedRow(id: string, saleId: string): QuotationRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE quotations SET
        status = 'converted',
        converted_sale_id = ?,
        converted_at = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(saleId, now, now, id);

  const row = findQuotationRowById(id);
  if (!row) {
    throw new Error("Quotation not found after conversion");
  }
  return row;
}

export function deleteQuotationRow(id: string): void {
  getDatabase().prepare("DELETE FROM quotations WHERE id = ?").run(id);
}

export function mapQuotationItemDetailRow(row: QuotationItemDetailRow): QuotationItem {
  return {
    id: row.id,
    quotationId: row.quotation_id,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    discountAmountCents: row.discount_amount_cents,
    taxType: row.tax_type as QuotationItem["taxType"],
    taxAmountCents: row.tax_amount_cents,
    lineTotalCents: row.line_total_cents,
    isLocallySourced: Boolean(row.is_locally_sourced),
    localCostCents: row.local_cost_cents,
    localSupplierId: row.local_supplier_id,
    localSupplierName: row.local_supplier_name,
    createdAt: row.created_at
  };
}

function liveStatus(row: QuotationRow): QuotationStatus {
  return computeQuotationStatus({ storedStatus: row.status as QuotationStatus, validUntil: row.valid_until });
}

export function mapQuotationDetailRow(
  row: QuotationDetailRow,
  items: QuotationItem[],
  serviceCharges: SaleServiceCharge[],
  delivery: SaleDelivery | null
): Quotation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    quotationNumber: row.quotation_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    locationId: row.location_id,
    locationName: row.location_name,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    status: liveStatus(row),
    subtotalCents: row.subtotal_cents,
    discountAmountCents: row.discount_amount_cents,
    taxAmountCents: row.tax_amount_cents,
    grandTotalCents: row.grand_total_cents,
    validUntil: row.valid_until,
    notes: row.notes,
    convertedSaleId: row.converted_sale_id,
    convertedAt: row.converted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as QuotationSyncStatus,
    lastSyncedAt: row.last_synced_at,
    items,
    serviceCharges,
    delivery
  };
}

export function mapQuotationListRow(row: QuotationListRow): QuotationListItem {
  return {
    id: row.id,
    quotationNumber: row.quotation_number,
    customerName: row.customer_name,
    locationId: row.location_id,
    locationName: row.location_name,
    employeeName: row.employee_name,
    status: liveStatus(row),
    grandTotalCents: row.grand_total_cents,
    validUntil: row.valid_until,
    createdAt: row.created_at
  };
}

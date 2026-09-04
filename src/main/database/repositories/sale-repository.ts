import { getDatabase } from "@main/database/connection";
import type { NotesSection } from "@shared/lib/document-sections";
import { computePaymentStatus } from "@shared/lib/invoice";
import type { DeliveryInput } from "@shared/schemas/charges";
import type { InvoiceListItem, InvoiceSummary } from "@shared/types/invoice";
import type {
  PaymentStatus,
  PendingSaleListItem,
  Sale,
  SaleDelivery,
  SaleItem,
  SaleListItem,
  SalePayment,
  SaleServiceCharge,
  SaleStatus,
  SaleSyncStatus,
  TransactionType
} from "@shared/types/sale";

export type SaleRow = {
  id: string;
  tenant_id: string;
  receipt_number: string | null;
  location_id: string;
  employee_id: string;
  customer_id: string | null;
  /** Only ever meaningful when customer_id IS NULL — a free-text label a cashier can attach to a
   * walk-in sale ("Scott") WITHOUT creating a real Customer record, so a later search can still find
   * "the Scott sale" instead of every walk-in looking identical. Cleared server-side the moment a
   * real customer is actually selected (see completeSale/suspendSale's own assertion) — never stored
   * alongside a customer_id, so there's exactly one source of truth for "who this sale is for." Baked
   * into the read-side customer_name as "Walk-in - Scott" (see mapSaleSummaryRow and friends) so every
   * existing "customerName ?? 'Walk-in Customer'" fallback across the app picks this up for free,
   * with zero changes needed at each of those call sites. */
  walk_in_name: string | null;
  sale_status: string;
  transaction_type: string;
  payment_status: string;
  subtotal_cents: number;
  discount_amount_cents: number;
  tax_amount_cents: number;
  grand_total_cents: number;
  payment_method_id: string | null;
  payment_reference: string | null;
  amount_received_cents: number | null;
  change_given_cents: number | null;
  notes: string | null;
  include_tax_breakdown: number;
  include_business_info: number;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount_paid_cents: number;
  balance_due_cents: number;
  invoice_notes: string | null;
  /** JSON-serialized NotesSection[] — see Sale["notesSections"]'s own doc comment. */
  notes_sections: string;
  payments: string;
  /** JSON-serialized DeliveryInput, or null — see Sale["deliveryDraft"]'s own doc comment. */
  delivery_draft_json: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
  synced_updated_at: string | null;
};

/** See SaleRow["walk_in_name"]'s own doc comment — the one place this formatting rule lives, reused
 * by every mapXxxRow function below that surfaces a customer_name. rawCustomerName is whatever the
 * customers-table JOIN produced (null for a walk-in, since customer_id is null there too). */
function walkInAwareCustomerName(rawCustomerName: string | null, walkInName: string | null): string | null {
  if (rawCustomerName) return rawCustomerName;
  return walkInName ? `Walk-in - ${walkInName}` : null;
}

export type SaleDetailRow = SaleRow & {
  location_name: string;
  employee_name: string;
  customer_name: string | null;
  customer_kra_pin: string | null;
  payment_method_name: string | null;
};

export type SaleItemRow = {
  id: string;
  sale_id: string;
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
  section_label: string | null;
  created_at: string;
};

export type SaleItemDetailRow = SaleItemRow & {
  product_name: string;
  sku: string;
  local_supplier_name: string | null;
  /** Whether THIS product is stock-tracked at all — needed by invoice-cancellation-service.ts to
   * mirror insertInvoiceFromCart's own deduction condition (`track_stock && !isLocallySourced`)
   * exactly when restocking on cancel; without it, cancelling would credit phantom stock for
   * products that were never actually deducted in the first place. */
  track_stock: number;
};

export type PendingSaleListRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  walk_in_name: string | null;
  item_count: number;
  grand_total_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SaleSummaryRow = {
  id: string;
  receipt_number: string | null;
  customer_name: string | null;
  walk_in_name: string | null;
  employee_name: string;
  location_name: string;
  payment_method_name: string | null;
  item_count: number;
  grand_total_cents: number;
  sale_status: string;
  completed_at: string | null;
  created_at: string;
  /** NULL when the sale has no delivery attached at all; 0/1 (delivery_notes.is_delivered) otherwise. */
  delivery_is_delivered: number | null;
  location_id: string;
};

/** Pass null for locationId to see every branch's receipts (e.g. a super-admin with no assigned branch). */
export function findAllSaleSummaryRows(tenantId: string, locationId: string | null): SaleSummaryRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.id,
        s.receipt_number,
        c.name AS customer_name,
        s.walk_in_name,
        (e.first_name || ' ' || e.last_name) AS employee_name,
        l.location_name AS location_name,
        pm.name AS payment_method_name,
        (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
        s.grand_total_cents,
        s.sale_status,
        s.completed_at,
        s.created_at,
        (SELECT dn.is_delivered FROM delivery_notes dn WHERE dn.sale_id = s.id) AS delivery_is_delivered,
        s.location_id
      FROM sales s
      JOIN employees e ON e.id = s.employee_id
      JOIN locations l ON l.id = s.location_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
      WHERE s.tenant_id = ? AND s.sale_status = 'completed' AND s.invoice_number IS NULL
        AND (? IS NULL OR s.location_id = ?)
      ORDER BY s.completed_at DESC
    `
    )
    .all(tenantId, locationId, locationId) as SaleSummaryRow[];
}

export function mapSaleSummaryRow(row: SaleSummaryRow): SaleListItem {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    customerName: walkInAwareCustomerName(row.customer_name, row.walk_in_name),
    employeeName: row.employee_name,
    locationName: row.location_name,
    paymentMethodName: row.payment_method_name,
    itemCount: row.item_count,
    grandTotalCents: row.grand_total_cents,
    saleStatus: row.sale_status as SaleStatus,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    hasDeliveryNote: row.delivery_is_delivered !== null,
    deliveryIsDelivered: row.delivery_is_delivered === null ? null : row.delivery_is_delivered === 1,
    locationId: row.location_id
  };
}

// Returns every matching number, not just the max — see document-number-service.ts's own comment
// on why a bare SQL MAX() is wrong once tagged ("BL-D1-0000045") and untagged ("BL-0004000")
// numbers coexist (lexicographic string comparison picks the wrong one).
export function findMaxReceiptNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT receipt_number FROM sales WHERE tenant_id = ? AND receipt_number LIKE 'BL-%'")
      .all(tenantId) as Array<{ receipt_number: string }>
  ).map((row) => row.receipt_number);
}

export function findMaxInvoiceNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT invoice_number FROM sales WHERE tenant_id = ? AND invoice_number LIKE 'INV-%'")
      .all(tenantId) as Array<{ invoice_number: string }>
  ).map((row) => row.invoice_number);
}

export type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  receipt_number: string | null;
  customer_name: string | null;
  transaction_type: string;
  location_name: string;
  invoice_date: string | null;
  due_date: string | null;
  grand_total_cents: number;
  amount_paid_cents: number;
  balance_due_cents: number;
  payment_status: string;
  created_at: string;
  has_delivery_note: number;
  location_id: string;
};

/** Pass null for locationId to see every branch's invoices (e.g. a super-admin with no assigned branch). */
export function findAllInvoiceRows(tenantId: string, locationId: string | null): InvoiceRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.id,
        s.invoice_number,
        s.receipt_number,
        c.name AS customer_name,
        s.transaction_type,
        l.location_name AS location_name,
        s.invoice_date,
        s.due_date,
        s.grand_total_cents,
        s.amount_paid_cents,
        s.balance_due_cents,
        s.payment_status,
        s.created_at,
        EXISTS(SELECT 1 FROM delivery_notes dn WHERE dn.sale_id = s.id) AS has_delivery_note,
        s.location_id
      FROM sales s
      JOIN locations l ON l.id = s.location_id
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.tenant_id = ? AND s.invoice_number IS NOT NULL
        AND (? IS NULL OR s.location_id = ?)
      ORDER BY s.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId) as InvoiceRow[];
}

/** Every one of this customer's invoices not yet fully paid off or cancelled — the basis of a
 * Statement of Account. Oldest due date first, matching how a real statement reads. Same row shape
 * as findAllInvoiceRows (reuses mapInvoiceListRow) — just scoped to one customer and pre-filtered to
 * outstanding balances instead of covering every invoice tenant-wide. */
export function findOutstandingInvoiceRowsForCustomer(tenantId: string, customerId: string): InvoiceRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.id,
        s.invoice_number,
        s.receipt_number,
        c.name AS customer_name,
        s.transaction_type,
        l.location_name AS location_name,
        s.invoice_date,
        s.due_date,
        s.grand_total_cents,
        s.amount_paid_cents,
        s.balance_due_cents,
        s.payment_status,
        s.created_at,
        EXISTS(SELECT 1 FROM delivery_notes dn WHERE dn.sale_id = s.id) AS has_delivery_note,
        s.location_id
      FROM sales s
      JOIN locations l ON l.id = s.location_id
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.tenant_id = ? AND s.customer_id = ? AND s.invoice_number IS NOT NULL
        AND s.payment_status NOT IN ('paid', 'cancelled')
      ORDER BY COALESCE(s.due_date, s.invoice_date) ASC
    `
    )
    .all(tenantId, customerId) as InvoiceRow[];
}

export function mapInvoiceListRow(row: InvoiceRow): InvoiceListItem {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    receiptNumber: row.receipt_number,
    customerName: row.customer_name,
    transactionType: row.transaction_type as TransactionType,
    locationName: row.location_name,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    grandTotalCents: row.grand_total_cents,
    amountPaidCents: row.amount_paid_cents,
    balanceDueCents: row.balance_due_cents,
    paymentStatus: computePaymentStatus({
      balanceDueCents: row.balance_due_cents,
      amountPaidCents: row.amount_paid_cents,
      dueDate: row.due_date,
      cancelled: row.payment_status === "cancelled"
    }),
    createdAt: row.created_at,
    hasDeliveryNote: row.has_delivery_note === 1,
    locationId: row.location_id
  };
}

export type InvoiceSummaryRow = {
  total_outstanding_cents: number;
  total_overdue_cents: number;
  total_paid_cents: number;
  total_invoices: number;
  total_invoice_value_cents: number;
};

/** Pass null for locationId to summarize every branch's invoices (e.g. a super-admin with no assigned branch). */
export function findInvoiceSummaryRow(tenantId: string, locationId: string | null): InvoiceSummaryRow {
  return getDatabase()
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN payment_status NOT IN ('paid', 'cancelled') THEN balance_due_cents ELSE 0 END), 0) AS total_outstanding_cents,
        COALESCE(SUM(CASE WHEN payment_status NOT IN ('paid', 'cancelled') AND due_date IS NOT NULL AND due_date < datetime('now') THEN balance_due_cents ELSE 0 END), 0) AS total_overdue_cents,
        COALESCE(SUM(amount_paid_cents), 0) AS total_paid_cents,
        COUNT(*) AS total_invoices,
        COALESCE(SUM(grand_total_cents), 0) AS total_invoice_value_cents
      FROM sales
      WHERE tenant_id = ? AND invoice_number IS NOT NULL
        AND (? IS NULL OR location_id = ?)
    `
    )
    .get(tenantId, locationId, locationId) as InvoiceSummaryRow;
}

export function mapInvoiceSummaryRow(row: InvoiceSummaryRow): InvoiceSummary {
  return {
    totalOutstandingCents: row.total_outstanding_cents,
    totalOverdueCents: row.total_overdue_cents,
    totalPaidCents: row.total_paid_cents,
    totalInvoices: row.total_invoices,
    totalInvoiceValueCents: row.total_invoice_value_cents
  };
}

export function findSaleRowById(id: string): SaleRow | undefined {
  return getDatabase().prepare("SELECT * FROM sales WHERE id = ?").get(id) as SaleRow | undefined;
}

export function findSaleDetailRowById(id: string): SaleDetailRow | undefined {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.*,
        l.location_name AS location_name,
        (e.first_name || ' ' || e.last_name) AS employee_name,
        c.name AS customer_name,
        c.kra_pin AS customer_kra_pin,
        pm.name AS payment_method_name
      FROM sales s
      LEFT JOIN locations l ON l.id = s.location_id
      LEFT JOIN employees e ON e.id = s.employee_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
      WHERE s.id = ?
    `
    )
    .get(id) as SaleDetailRow | undefined;
}

export function findSaleItemRowById(id: string): SaleItemRow | undefined {
  return getDatabase().prepare("SELECT * FROM sale_items WHERE id = ?").get(id) as
    | SaleItemRow
    | undefined;
}

export function findSaleItemDetailRows(saleId: string): SaleItemDetailRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT si.*, p.name AS product_name, p.sku AS sku, p.track_stock AS track_stock, sup.business_name AS local_supplier_name
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
      LEFT JOIN suppliers sup ON sup.id = si.local_supplier_id
      WHERE si.sale_id = ?
      ORDER BY si.created_at ASC
    `
    )
    .all(saleId) as SaleItemDetailRow[];
}

export function findPendingSaleListRows(tenantId: string, locationId: string | null): PendingSaleListRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.id,
        s.customer_id,
        c.name AS customer_name,
        s.walk_in_name,
        s.notes,
        s.grand_total_cents,
        s.created_at,
        s.updated_at,
        (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.tenant_id = ? AND (? IS NULL OR s.location_id = ?) AND s.sale_status = 'pending'
      ORDER BY s.created_at DESC
    `
    )
    .all(tenantId, locationId, locationId) as PendingSaleListRow[];
}

export function insertSaleRow(input: {
  id: string;
  tenantId: string;
  receiptNumber: string | null;
  locationId: string;
  employeeId: string;
  customerId: string | null;
  /** See SaleRow["walk_in_name"]'s own doc comment. Caller (sale-service.ts) is responsible for
   * never passing both a customerId and a walkInName — this function trusts what it's given. */
  walkInName: string | null;
  saleStatus: SaleStatus;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
  paymentMethodId: string | null;
  paymentReference: string | null;
  amountReceivedCents: number | null;
  changeGivenCents: number | null;
  notes: string | null;
  /** Defaults to true (today's behavior) when omitted/undefined — see the include_tax_breakdown
   * migration's own doc comment. */
  includeTaxBreakdown?: boolean | undefined;
  /** See Sale["includeBusinessInfo"]'s own doc comment — same defaulting rule as includeTaxBreakdown. */
  includeBusinessInfo?: boolean | undefined;
  completedAt: string | null;
  /** JSON-serialized DeliveryInput for a held sale's own delivery draft, or null — see
   * Sale["deliveryDraft"]'s own doc comment. Always null for a completed sale (its delivery, if
   * any, is a real numbered row instead — see persistCartExtras). */
  deliveryDraftJson?: string | null;
}): SaleRow {
  const now = new Date().toISOString();

  // Retail checkout never allows underpayment (see completeSale), so a 'completed' row is always
  // paid in full at that instant — a 'pending' (suspended) row has collected nothing yet.
  const amountPaidCents = input.saleStatus === "completed" ? input.grandTotalCents : 0;
  const balanceDueCents = input.saleStatus === "completed" ? 0 : input.grandTotalCents;

  getDatabase()
    .prepare(
      `
      INSERT INTO sales (
        id, tenant_id, receipt_number, location_id, employee_id, customer_id, walk_in_name, sale_status,
        subtotal_cents, discount_amount_cents, tax_amount_cents, grand_total_cents,
        payment_method_id, payment_reference, amount_received_cents, change_given_cents,
        notes, completed_at, created_at, updated_at, sync_status, amount_paid_cents, balance_due_cents,
        delivery_draft_json, include_tax_breakdown, include_business_info
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.receiptNumber,
      input.locationId,
      input.employeeId,
      input.customerId,
      input.walkInName,
      input.saleStatus,
      input.subtotalCents,
      input.discountAmountCents,
      input.taxAmountCents,
      input.grandTotalCents,
      input.paymentMethodId,
      input.paymentReference,
      input.amountReceivedCents,
      input.changeGivenCents,
      input.notes,
      input.completedAt,
      now,
      now,
      amountPaidCents,
      balanceDueCents,
      input.deliveryDraftJson ?? null,
      input.includeTaxBreakdown === false ? 0 : 1,
      input.includeBusinessInfo === false ? 0 : 1
    );

  const row = findSaleRowById(input.id);
  if (!row) {
    throw new Error("Failed to create sale record");
  }
  return row;
}

export function insertSaleItemRow(input: {
  id: string;
  saleId: string;
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
  sectionLabel: string | null;
}): SaleItemRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO sale_items (
        id, sale_id, product_id, quantity, unit_price_cents,
        discount_amount_cents, tax_type, tax_amount_cents, line_total_cents,
        is_locally_sourced, local_cost_cents, local_supplier_id, section_label, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.id,
      input.saleId,
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
      input.sectionLabel,
      now
    );

  const row = getDatabase().prepare("SELECT * FROM sale_items WHERE id = ?").get(input.id) as
    | SaleItemRow
    | undefined;
  if (!row) {
    throw new Error("Failed to create sale item record");
  }
  return row;
}

/** Creates an invoice-style sale row — a separate insert path from insertSaleRow so the existing
 * retail checkout flow (suspend/complete) is never touched by invoicing. */
export function insertInvoiceRow(input: {
  id: string;
  tenantId: string;
  locationId: string;
  employeeId: string;
  customerId: string;
  transactionType: TransactionType;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  paymentStatus: PaymentStatus;
  invoiceNotes: string | null;
  notesSections: NotesSection[];
  payments: SalePayment[];
  /** Defaults to true (today's behavior) when omitted/undefined — see the include_tax_breakdown
   * migration's own doc comment. */
  includeTaxBreakdown?: boolean | undefined;
  /** See Sale["includeBusinessInfo"]'s own doc comment — same defaulting rule as includeTaxBreakdown. */
  includeBusinessInfo?: boolean | undefined;
}): SaleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO sales (
        id, tenant_id, location_id, employee_id, customer_id, sale_status, transaction_type,
        subtotal_cents, discount_amount_cents, tax_amount_cents, grand_total_cents,
        invoice_number, invoice_date, due_date, amount_paid_cents, balance_due_cents,
        payment_status, invoice_notes, notes_sections, payments, completed_at, created_at, updated_at, sync_status,
        include_tax_breakdown, include_business_info
      )
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.locationId,
      input.employeeId,
      input.customerId,
      input.transactionType,
      input.subtotalCents,
      input.discountAmountCents,
      input.taxAmountCents,
      input.grandTotalCents,
      input.invoiceNumber,
      input.invoiceDate,
      input.dueDate,
      input.amountPaidCents,
      input.balanceDueCents,
      input.paymentStatus,
      input.invoiceNotes,
      JSON.stringify(input.notesSections),
      JSON.stringify(input.payments),
      now,
      now,
      now,
      input.includeTaxBreakdown === false ? 0 : 1,
      input.includeBusinessInfo === false ? 0 : 1
    );

  const row = findSaleRowById(input.id);
  if (!row) {
    throw new Error("Failed to create invoice record");
  }
  return row;
}

/** Appends a payment to the invoice's payment history and persists the recalculated totals. */
export function appendPaymentToSaleRow(input: {
  id: string;
  payments: SalePayment[];
  amountPaidCents: number;
  balanceDueCents: number;
  paymentStatus: PaymentStatus;
}): SaleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE sales SET
        payments = ?,
        amount_paid_cents = ?,
        balance_due_cents = ?,
        payment_status = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      JSON.stringify(input.payments),
      input.amountPaidCents,
      input.balanceDueCents,
      input.paymentStatus,
      now,
      input.id
    );

  const row = findSaleRowById(input.id);
  if (!row) {
    throw new Error("Sale not found after recording payment");
  }
  return row;
}

export function updateSalePaymentStatusRow(id: string, paymentStatus: PaymentStatus): SaleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE sales SET payment_status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(paymentStatus, now, id);

  const row = findSaleRowById(id);
  if (!row) {
    throw new Error("Sale not found after status update");
  }
  return row;
}

export function updateSaleIncludeTaxBreakdownRow(id: string, includeTaxBreakdown: boolean): SaleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE sales SET include_tax_breakdown = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(includeTaxBreakdown ? 1 : 0, now, id);

  const row = findSaleRowById(id);
  if (!row) {
    throw new Error("Sale not found after tax-breakdown-toggle update");
  }
  return row;
}

export function updateSaleIncludeBusinessInfoRow(id: string, includeBusinessInfo: boolean): SaleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE sales SET include_business_info = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(includeBusinessInfo ? 1 : 0, now, id);

  const row = findSaleRowById(id);
  if (!row) {
    throw new Error("Sale not found after business-info-toggle update");
  }
  return row;
}

/** Rewrites an invoice's header content — customer/type/due date/notes/totals — as part of an
 * in-place edit. Items themselves are handled separately by the caller (deleteSaleItemsForSaleRow +
 * fresh insertSaleItemRow calls), same split as updateQuotationRow/deleteQuotationItemsForQuotationRow. */
export function updateInvoiceContentRow(input: {
  id: string;
  customerId: string;
  transactionType: TransactionType;
  dueDate: string;
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
  balanceDueCents: number;
  paymentStatus: PaymentStatus;
  invoiceNotes: string | null;
  notesSections: NotesSection[];
  includeTaxBreakdown?: boolean | undefined;
  /** See Sale["includeBusinessInfo"]'s own doc comment — same defaulting rule as includeTaxBreakdown. */
  includeBusinessInfo?: boolean | undefined;
}): SaleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE sales SET
        customer_id = ?,
        transaction_type = ?,
        due_date = ?,
        subtotal_cents = ?,
        discount_amount_cents = ?,
        tax_amount_cents = ?,
        grand_total_cents = ?,
        balance_due_cents = ?,
        payment_status = ?,
        invoice_notes = ?,
        notes_sections = ?,
        include_tax_breakdown = ?,
        include_business_info = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.customerId,
      input.transactionType,
      input.dueDate,
      input.subtotalCents,
      input.discountAmountCents,
      input.taxAmountCents,
      input.grandTotalCents,
      input.balanceDueCents,
      input.paymentStatus,
      input.invoiceNotes,
      JSON.stringify(input.notesSections),
      input.includeTaxBreakdown === false ? 0 : 1,
      input.includeBusinessInfo === false ? 0 : 1,
      now,
      input.id
    );

  const row = findSaleRowById(input.id);
  if (!row) {
    throw new Error("Invoice not found after update");
  }
  return row;
}

export function deleteSaleItemsForSaleRow(saleId: string): void {
  getDatabase().prepare("DELETE FROM sale_items WHERE sale_id = ?").run(saleId);
}

export function deleteSaleRow(id: string): void {
  getDatabase().prepare("DELETE FROM sales WHERE id = ?").run(id);
}

export function mapSaleItemDetailRow(row: SaleItemDetailRow): SaleItem {
  return {
    id: row.id,
    saleId: row.sale_id,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    discountAmountCents: row.discount_amount_cents,
    taxType: row.tax_type as SaleItem["taxType"],
    taxAmountCents: row.tax_amount_cents,
    lineTotalCents: row.line_total_cents,
    isLocallySourced: Boolean(row.is_locally_sourced),
    localCostCents: row.local_cost_cents,
    localSupplierId: row.local_supplier_id,
    localSupplierName: row.local_supplier_name,
    sectionLabel: row.section_label,
    createdAt: row.created_at
  };
}

/** Exported for delivery-note-service.ts's attachDeliveryToSale, which needs a sale/invoice row's own
 * payment method to attribute a retroactively-added delivery's cost expense to — the same "however
 * they actually paid" reasoning as the two at-creation call sites in sale-service.ts/invoice-service.ts. */
export function parseSalePayments(raw: string): SalePayment[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SalePayment[]) : [];
  } catch {
    return [];
  }
}

/** The column is NOT NULL DEFAULT '[]' (migration 84), so every row always has a value — this just
 * parses defensively, same belt-and-suspenders treatment as parseSalePayments above. */
function parseNotesSections(raw: string): NotesSection[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NotesSection[]) : [];
  } catch {
    return [];
  }
}

export function mapSaleDetailRow(
  row: SaleDetailRow,
  items: SaleItem[],
  serviceCharges: SaleServiceCharge[],
  delivery: SaleDelivery | null
): Sale {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    receiptNumber: row.receipt_number,
    locationId: row.location_id,
    locationName: row.location_name,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    customerId: row.customer_id,
    customerName: walkInAwareCustomerName(row.customer_name, row.walk_in_name),
    walkInName: row.walk_in_name,
    customerKraPin: row.customer_kra_pin,
    saleStatus: row.sale_status as Sale["saleStatus"],
    transactionType: row.transaction_type as TransactionType,
    paymentStatus: computePaymentStatus({
      balanceDueCents: row.balance_due_cents,
      amountPaidCents: row.amount_paid_cents,
      dueDate: row.due_date,
      cancelled: row.payment_status === "cancelled"
    }),
    subtotalCents: row.subtotal_cents,
    discountAmountCents: row.discount_amount_cents,
    taxAmountCents: row.tax_amount_cents,
    grandTotalCents: row.grand_total_cents,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name,
    paymentReference: row.payment_reference,
    amountReceivedCents: row.amount_received_cents,
    changeGivenCents: row.change_given_cents,
    notes: row.notes,
    includeTaxBreakdown: row.include_tax_breakdown === 1,
    includeBusinessInfo: row.include_business_info === 1,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    amountPaidCents: row.amount_paid_cents,
    balanceDueCents: row.balance_due_cents,
    invoiceNotes: row.invoice_notes,
    notesSections: parseNotesSections(row.notes_sections),
    payments: parseSalePayments(row.payments),
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as SaleSyncStatus,
    lastSyncedAt: row.last_synced_at,
    items,
    serviceCharges,
    delivery,
    deliveryDraft: row.delivery_draft_json ? (JSON.parse(row.delivery_draft_json) as DeliveryInput) : null
  };
}

export function mapPendingSaleListRow(row: PendingSaleListRow): PendingSaleListItem {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: walkInAwareCustomerName(row.customer_name, row.walk_in_name),
    walkInName: row.walk_in_name,
    itemCount: row.item_count,
    grandTotalCents: row.grand_total_cents,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

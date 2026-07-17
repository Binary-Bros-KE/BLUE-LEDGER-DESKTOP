import { getDatabase } from "@main/database/connection";
import { computePaymentStatus } from "@shared/lib/invoice";
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
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount_paid_cents: number;
  balance_due_cents: number;
  invoice_notes: string | null;
  payments: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
};

export type SaleDetailRow = SaleRow & {
  location_name: string;
  employee_name: string;
  customer_name: string | null;
  payment_method_name: string | null;
};

export type SaleItemRow = {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
  discount_amount_cents: number;
  tax_amount_cents: number;
  line_total_cents: number;
  created_at: string;
};

export type SaleItemDetailRow = SaleItemRow & {
  product_name: string;
  sku: string;
};

export type PendingSaleListRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
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
  employee_name: string;
  location_name: string;
  payment_method_name: string | null;
  item_count: number;
  grand_total_cents: number;
  sale_status: string;
  completed_at: string | null;
  created_at: string;
  has_delivery_note: number;
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
        (e.first_name || ' ' || e.last_name) AS employee_name,
        l.location_name AS location_name,
        pm.name AS payment_method_name,
        (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
        s.grand_total_cents,
        s.sale_status,
        s.completed_at,
        s.created_at,
        EXISTS(SELECT 1 FROM delivery_notes dn WHERE dn.sale_id = s.id) AS has_delivery_note
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
    customerName: row.customer_name,
    employeeName: row.employee_name,
    locationName: row.location_name,
    paymentMethodName: row.payment_method_name,
    itemCount: row.item_count,
    grandTotalCents: row.grand_total_cents,
    saleStatus: row.sale_status as SaleStatus,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    hasDeliveryNote: row.has_delivery_note === 1
  };
}

export function findMaxReceiptNumberRow(tenantId: string): string | null {
  const row = getDatabase()
    .prepare(
      "SELECT MAX(receipt_number) as maxReceipt FROM sales WHERE tenant_id = ? AND receipt_number LIKE 'BL-%'"
    )
    .get(tenantId) as { maxReceipt: string | null };
  return row.maxReceipt;
}

export function findMaxInvoiceNumberRow(tenantId: string): string | null {
  const row = getDatabase()
    .prepare(
      "SELECT MAX(invoice_number) as maxInvoice FROM sales WHERE tenant_id = ? AND invoice_number LIKE 'INV-%'"
    )
    .get(tenantId) as { maxInvoice: string | null };
  return row.maxInvoice;
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
        EXISTS(SELECT 1 FROM delivery_notes dn WHERE dn.sale_id = s.id) AS has_delivery_note
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
    hasDeliveryNote: row.has_delivery_note === 1
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
      SELECT si.*, p.name AS product_name, p.sku AS sku
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
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
  completedAt: string | null;
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
        id, tenant_id, receipt_number, location_id, employee_id, customer_id, sale_status,
        subtotal_cents, discount_amount_cents, tax_amount_cents, grand_total_cents,
        payment_method_id, payment_reference, amount_received_cents, change_given_cents,
        notes, completed_at, created_at, updated_at, sync_status, amount_paid_cents, balance_due_cents
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.receiptNumber,
      input.locationId,
      input.employeeId,
      input.customerId,
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
      balanceDueCents
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
  taxAmountCents: number;
  lineTotalCents: number;
}): SaleItemRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO sale_items (
        id, sale_id, product_id, quantity, unit_price_cents,
        discount_amount_cents, tax_amount_cents, line_total_cents, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.id,
      input.saleId,
      input.productId,
      input.quantity,
      input.unitPriceCents,
      input.discountAmountCents,
      input.taxAmountCents,
      input.lineTotalCents,
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
  payments: SalePayment[];
}): SaleRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO sales (
        id, tenant_id, location_id, employee_id, customer_id, sale_status, transaction_type,
        subtotal_cents, discount_amount_cents, tax_amount_cents, grand_total_cents,
        invoice_number, invoice_date, due_date, amount_paid_cents, balance_due_cents,
        payment_status, invoice_notes, payments, completed_at, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
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
      JSON.stringify(input.payments),
      now,
      now,
      now
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
    taxAmountCents: row.tax_amount_cents,
    lineTotalCents: row.line_total_cents,
    createdAt: row.created_at
  };
}

function parseSalePayments(raw: string): SalePayment[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SalePayment[]) : [];
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
    customerName: row.customer_name,
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
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    amountPaidCents: row.amount_paid_cents,
    balanceDueCents: row.balance_due_cents,
    invoiceNotes: row.invoice_notes,
    payments: parseSalePayments(row.payments),
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as SaleSyncStatus,
    lastSyncedAt: row.last_synced_at,
    items,
    serviceCharges,
    delivery
  };
}

export function mapPendingSaleListRow(row: PendingSaleListRow): PendingSaleListItem {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    itemCount: row.item_count,
    grandTotalCents: row.grand_total_cents,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

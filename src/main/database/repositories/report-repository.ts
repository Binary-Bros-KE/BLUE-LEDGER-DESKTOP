import { getDatabase } from "@main/database/connection";

const EXCLUDE_VOIDED = `s.id NOT IN (SELECT sale_id FROM sale_voids WHERE status = 'approved')`;
/** A sale only "counts" once it has either been paid in full at checkout (no invoice_number),
 * or has actually received at least one payment (invoice_number set, amount_paid_cents > 0) —
 * an invoice nobody has paid anything toward yet is an open order, not a transaction. */
const EXCLUDE_UNPAID_INVOICES = `(s.invoice_number IS NULL OR s.amount_paid_cents > 0)`;
const RETURN_NETTING_JOIN = `
  LEFT JOIN (
    SELECT sri.sale_item_id AS sale_item_id,
           SUM(sri.quantity) AS returned_quantity,
           SUM(sri.line_total_cents) AS returned_line_total_cents
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.sale_return_id
    WHERE sr.status = 'approved'
    GROUP BY sri.sale_item_id
  ) ret ON ret.sale_item_id = si.id
`;

/** One completed, revenue-bearing transaction — the shared raw material every
 * Sales report is aggregated from in the service layer (JS-side, not SQL
 * GROUP BY), since payment-method attribution has to parse the `payments`
 * ledger for invoices anyway, and the volumes here don't call for anything
 * heavier. */
export type CompletedSaleRow = {
  id: string;
  transaction_type: string;
  location_id: string;
  location_name: string;
  employee_id: string;
  employee_name: string;
  customer_name: string | null;
  receipt_number: string | null;
  invoice_number: string | null;
  payment_method_id: string | null;
  payment_method_name: string | null;
  grand_total_cents: number;
  discount_amount_cents: number;
  tax_amount_cents: number;
  amount_paid_cents: number;
  payment_status: string;
  completed_at: string;
  payments: string;
};

/**
 * Every completed retail/wholesale/invoice sale whose completed_at falls in
 * [startIso, endIsoExclusive) — excluding sales with an approved void,
 * cancelled invoices, and invoices that haven't received any payment yet.
 * Pass null for locationId to include every branch.
 */
export function findCompletedSaleRows(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): CompletedSaleRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.id,
        s.transaction_type,
        s.location_id,
        l.location_name AS location_name,
        s.employee_id,
        (e.first_name || ' ' || e.last_name) AS employee_name,
        c.name AS customer_name,
        s.receipt_number,
        s.invoice_number,
        s.payment_method_id,
        pm.name AS payment_method_name,
        s.grand_total_cents,
        s.discount_amount_cents,
        s.tax_amount_cents,
        s.amount_paid_cents,
        s.payment_status,
        s.completed_at,
        s.payments
      FROM sales s
      JOIN locations l ON l.id = s.location_id
      JOIN employees e ON e.id = s.employee_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
      WHERE s.tenant_id = ? AND s.sale_status = 'completed'
        AND s.transaction_type IN ('retail_sale', 'wholesale_sale', 'invoice')
        AND s.payment_status != 'cancelled'
        AND ${EXCLUDE_UNPAID_INVOICES}
        AND s.completed_at >= ? AND s.completed_at < ?
        AND (? IS NULL OR s.location_id = ?)
        AND ${EXCLUDE_VOIDED}
      ORDER BY s.completed_at DESC
    `
    )
    .all(tenantId, startIso, endIsoExclusive, locationId, locationId) as CompletedSaleRow[];
}

export type PaymentTransactionSourceRow = CompletedSaleRow & { is_voided: 0 | 1; payment_reference: string | null };

/**
 * Same shape as findCompletedSaleRows, but deliberately does NOT exclude voided/cancelled sales —
 * the Transactions tab needs to show every actual money-movement event, including ones later
 * reversed, flagged via `is_voided` rather than silently dropped. Still excludes invoices with zero
 * payments toward them (no money has moved yet, so there's nothing to list as a transaction).
 */
export function findPaymentTransactionRows(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): PaymentTransactionSourceRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.id,
        s.transaction_type,
        s.location_id,
        l.location_name AS location_name,
        s.employee_id,
        (e.first_name || ' ' || e.last_name) AS employee_name,
        c.name AS customer_name,
        s.receipt_number,
        s.invoice_number,
        s.payment_method_id,
        pm.name AS payment_method_name,
        s.payment_reference,
        s.grand_total_cents,
        s.discount_amount_cents,
        s.tax_amount_cents,
        s.amount_paid_cents,
        s.payment_status,
        s.completed_at,
        s.payments,
        (CASE WHEN s.payment_status = 'cancelled' THEN 1
              WHEN EXISTS (SELECT 1 FROM sale_voids sv WHERE sv.sale_id = s.id AND sv.status = 'approved') THEN 1
              ELSE 0 END) AS is_voided
      FROM sales s
      JOIN locations l ON l.id = s.location_id
      JOIN employees e ON e.id = s.employee_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
      WHERE s.tenant_id = ? AND s.sale_status = 'completed'
        AND s.transaction_type IN ('retail_sale', 'wholesale_sale', 'invoice')
        AND ${EXCLUDE_UNPAID_INVOICES}
        AND s.completed_at >= ? AND s.completed_at < ?
        AND (? IS NULL OR s.location_id = ?)
      ORDER BY s.completed_at DESC
    `
    )
    .all(tenantId, startIso, endIsoExclusive, locationId, locationId) as PaymentTransactionSourceRow[];
}

export type SaleItemProfitRow = {
  sale_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  line_total_cents: number;
  buying_price_cents: number;
};

/** Line items for every completed sale in range, net of any approved returns
 * (a returned item is no longer "sold"), with each product's cost price
 * attached — used for "top products", Items Sold, and the Net Revenue (gross
 * profit) card. */
export function findSaleItemRowsInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): SaleItemProfitRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        si.sale_id,
        si.product_id,
        p.name AS product_name,
        (si.quantity - COALESCE(ret.returned_quantity, 0)) AS quantity,
        (si.line_total_cents - COALESCE(ret.returned_line_total_cents, 0)) AS line_total_cents,
        p.buying_price_cents
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      ${RETURN_NETTING_JOIN}
      WHERE s.tenant_id = ? AND s.sale_status = 'completed'
        AND s.transaction_type IN ('retail_sale', 'wholesale_sale', 'invoice')
        AND s.payment_status != 'cancelled'
        AND ${EXCLUDE_UNPAID_INVOICES}
        AND s.completed_at >= ? AND s.completed_at < ?
        AND (? IS NULL OR s.location_id = ?)
        AND ${EXCLUDE_VOIDED}
    `
    )
    .all(tenantId, startIso, endIsoExclusive, locationId, locationId) as SaleItemProfitRow[];
}

export type InvoicePaymentCandidateRow = {
  id: string;
  payments: string;
};

/** Every non-cancelled, non-voided invoice/wholesale-invoice sale that has
 * received at least one payment, up to (but deliberately not starting from)
 * the given instant. A payment's own `receivedAt` — not the invoice's
 * completed_at — determines which period's cash-in it belongs to, so this
 * can't be bounded on the low end: a payment landing in today's report might
 * belong to an invoice completed weeks ago. */
export function findInvoicePaymentCandidateRows(
  tenantId: string,
  locationId: string | null,
  uptoIsoExclusive: string
): InvoicePaymentCandidateRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT s.id, s.payments
      FROM sales s
      WHERE s.tenant_id = ? AND s.sale_status = 'completed'
        AND s.invoice_number IS NOT NULL
        AND s.payment_status != 'cancelled'
        AND s.amount_paid_cents > 0
        AND s.completed_at < ?
        AND (? IS NULL OR s.location_id = ?)
        AND ${EXCLUDE_VOIDED}
    `
    )
    .all(tenantId, uptoIsoExclusive, locationId, locationId) as InvoicePaymentCandidateRow[];
}

export type ExpenseTotals = { totalCents: number; documentCount: number };

/** Total recorded (non-archived) expenses whose expense_date falls within
 * [startDate, endDate] inclusive — expense_date is a plain calendar date, not
 * a timestamp, so this compares dates directly rather than ISO instants.
 * General expenses (no storefront) always count, same as the Expenses module. */
export function findExpenseTotalCentsInRange(
  tenantId: string,
  locationId: string | null,
  startDate: string,
  endDate: string
): ExpenseTotals {
  const row = getDatabase()
    .prepare(
      `
      SELECT COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS document_count
      FROM expenses
      WHERE tenant_id = ? AND status = 'active'
        AND expense_date >= ? AND expense_date <= ?
        AND (? IS NULL OR storefront_id = ? OR storefront_id IS NULL)
    `
    )
    .get(tenantId, startDate, endDate, locationId, locationId) as { total_cents: number; document_count: number };
  return { totalCents: row.total_cents, documentCount: row.document_count };
}

export type ExpenseCategoryBreakdownRow = {
  category_id: string;
  category_name: string;
  total_cents: number;
  document_count: number;
};

/** Expenses grouped by category for the range — categories are a short,
 * curated list (typically under 10 per tenant), so this cut (not a "top 10
 * individual records" list) is the useful one: how much went where, and how
 * many times. */
export function findExpenseCategoryBreakdownInRange(
  tenantId: string,
  locationId: string | null,
  startDate: string,
  endDate: string
): ExpenseCategoryBreakdownRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT ec.id AS category_id, ec.name AS category_name,
        COALESCE(SUM(e.amount_cents), 0) AS total_cents, COUNT(*) AS document_count
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
      WHERE e.tenant_id = ? AND e.status = 'active'
        AND e.expense_date >= ? AND e.expense_date <= ?
        AND (? IS NULL OR e.storefront_id = ? OR e.storefront_id IS NULL)
      GROUP BY ec.id, ec.name
      ORDER BY total_cents DESC
    `
    )
    .all(tenantId, startDate, endDate, locationId, locationId) as ExpenseCategoryBreakdownRow[];
}

export type PurchasePaymentCandidateRow = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  payments: string;
};

/** Every non-cancelled purchase that has paid a supplier at least once — like
 * invoice payments, a purchase's payments ledger has its own per-payment
 * `paidAt`, so cash-out-in-range has to be computed in JS from this, not
 * bounded by the purchase's own created/ordered/received date. Carries the
 * supplier name too, so the same fetch feeds both the total and the
 * per-supplier breakdown without a second query. */
export function findPurchasePaymentCandidateRows(tenantId: string, locationId: string | null): PurchasePaymentCandidateRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT p.id, p.supplier_id, s.business_name AS supplier_name, p.payments
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.tenant_id = ? AND p.status != 'cancelled' AND p.amount_paid_cents > 0
        AND (? IS NULL OR p.location_id = ?)
    `
    )
    .all(tenantId, locationId, locationId) as PurchasePaymentCandidateRow[];
}

export type SalaryTotals = { totalCents: number; documentCount: number };

/** Total active (non-voided) salary payouts created within [startIso, endIsoExclusive).
 * Salaries have no location column of their own — branch scoping is only
 * approximate here, via the paid employee's assigned branch. */
export function findSalaryPayoutCentsInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): SalaryTotals {
  const row = getDatabase()
    .prepare(
      `
      SELECT COALESCE(SUM(s.net_pay_cents), 0) AS total_cents, COUNT(*) AS document_count
      FROM salaries s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.tenant_id = ? AND s.status = 'active'
        AND s.created_at >= ? AND s.created_at < ?
        AND (? IS NULL OR e.branch_id = ?)
    `
    )
    .get(tenantId, startIso, endIsoExclusive, locationId, locationId) as { total_cents: number; document_count: number };
  return { totalCents: row.total_cents, documentCount: row.document_count };
}

export type EmployeeSalaryBreakdownRow = {
  employee_id: string;
  employee_name: string;
  total_cents: number;
  document_count: number;
};

/** Active salary payouts in range, grouped by employee — no JSON parsing
 * needed here (unlike purchases/invoices), since net_pay_cents and created_at
 * are plain columns. */
export function findSalariesByEmployeeInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): EmployeeSalaryBreakdownRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT e.id AS employee_id, (e.first_name || ' ' || e.last_name) AS employee_name,
        COALESCE(SUM(s.net_pay_cents), 0) AS total_cents, COUNT(*) AS document_count
      FROM salaries s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.tenant_id = ? AND s.status = 'active'
        AND s.created_at >= ? AND s.created_at < ?
        AND (? IS NULL OR e.branch_id = ?)
      GROUP BY e.id, employee_name
      ORDER BY total_cents DESC
    `
    )
    .all(tenantId, startIso, endIsoExclusive, locationId, locationId) as EmployeeSalaryBreakdownRow[];
}

export type ServiceDeliveryCostTotals = { totalCents: number; documentCount: number };

/** Hidden internal cost_cents on service charges + delivery attached to completed sales in range —
 * feeds the expense side of the Financial Overview so delivery/service profitability shows up in Net
 * Profit. Branch-scoped via the parent sale's location_id, dated by the sale's completed_at (not the
 * charge's own created_at) to match every other completed-sale query in this file. Quotation-only
 * charges (sale_id IS NULL) never count — nothing has actually been sold yet. */
export function findServiceAndDeliveryCostsInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): ServiceDeliveryCostTotals {
  const serviceRow = getDatabase()
    .prepare(
      `
      SELECT COALESCE(SUM(sc.cost_cents), 0) AS total_cents, COUNT(*) AS document_count
      FROM sale_service_charges sc
      JOIN sales s ON s.id = sc.sale_id
      WHERE s.tenant_id = ? AND s.sale_status = 'completed'
        AND s.completed_at >= ? AND s.completed_at < ?
        AND (? IS NULL OR s.location_id = ?)
    `
    )
    .get(tenantId, startIso, endIsoExclusive, locationId, locationId) as {
    total_cents: number;
    document_count: number;
  };

  const deliveryRow = getDatabase()
    .prepare(
      `
      SELECT COALESCE(SUM(dn.cost_cents), 0) AS total_cents, COUNT(*) AS document_count
      FROM delivery_notes dn
      JOIN sales s ON s.id = dn.sale_id
      WHERE s.tenant_id = ? AND s.sale_status = 'completed'
        AND s.completed_at >= ? AND s.completed_at < ?
        AND (? IS NULL OR s.location_id = ?)
    `
    )
    .get(tenantId, startIso, endIsoExclusive, locationId, locationId) as {
    total_cents: number;
    document_count: number;
  };

  return {
    totalCents: serviceRow.total_cents + deliveryRow.total_cents,
    documentCount: serviceRow.document_count + deliveryRow.document_count
  };
}

export type ApprovedReturnRefundRow = {
  return_id: string;
  approved_at: string;
  returned_value_cents: number;
};

/** Every approved return, tenant/branch-wide, with no date bound — a refund
 * is dated by when it was APPROVED (not the original sale's date), and that
 * date could be anywhere relative to the report's range, so this is fetched
 * once and filtered per-period in JS, same pattern as invoice payments. */
export function findApprovedReturnRefundRows(tenantId: string, locationId: string | null): ApprovedReturnRefundRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT sr.id AS return_id, sr.approved_at,
        COALESCE((SELECT SUM(sri.line_total_cents) FROM sale_return_items sri WHERE sri.sale_return_id = sr.id), 0)
          AS returned_value_cents
      FROM sale_returns sr
      JOIN sales s ON s.id = sr.sale_id
      WHERE sr.tenant_id = ? AND sr.status = 'approved' AND sr.approved_at IS NOT NULL
        AND (? IS NULL OR s.location_id = ?)
    `
    )
    .all(tenantId, locationId, locationId) as ApprovedReturnRefundRow[];
}

export type VoidedSalesStatsRow = {
  void_count: number;
  total_value_cents: number;
};

/** Stats on sales voided (approved) within [startIso, endIsoExclusive), dated
 * by when the void was approved. */
export function findVoidedSalesStatsInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): VoidedSalesStatsRow {
  return getDatabase()
    .prepare(
      `
      SELECT COUNT(*) AS void_count, COALESCE(SUM(s.grand_total_cents), 0) AS total_value_cents
      FROM sale_voids sv
      JOIN sales s ON s.id = sv.sale_id
      WHERE sv.tenant_id = ? AND sv.status = 'approved'
        AND sv.approved_at >= ? AND sv.approved_at < ?
        AND (? IS NULL OR s.location_id = ?)
    `
    )
    .get(tenantId, startIso, endIsoExclusive, locationId, locationId) as VoidedSalesStatsRow;
}

export type ProcessedReturnRow = {
  return_id: string;
  approved_at: string;
  document_number: string | null;
  customer_name: string | null;
  returned_quantity: number;
  returned_value_cents: number;
  reason: string;
};

/** Every return approved within [startIso, endIsoExclusive), newest first —
 * the detail behind the Voided Sales / Processed Returns section. */
export function findProcessedReturnsInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): ProcessedReturnRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        sr.id AS return_id,
        sr.approved_at,
        COALESCE(s.invoice_number, s.receipt_number) AS document_number,
        c.name AS customer_name,
        sr.reason,
        COALESCE((SELECT SUM(sri.quantity) FROM sale_return_items sri WHERE sri.sale_return_id = sr.id), 0) AS returned_quantity,
        COALESCE((SELECT SUM(sri.line_total_cents) FROM sale_return_items sri WHERE sri.sale_return_id = sr.id), 0)
          AS returned_value_cents
      FROM sale_returns sr
      JOIN sales s ON s.id = sr.sale_id
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE sr.tenant_id = ? AND sr.status = 'approved'
        AND sr.approved_at >= ? AND sr.approved_at < ?
        AND (? IS NULL OR s.location_id = ?)
      ORDER BY sr.approved_at DESC
    `
    )
    .all(tenantId, startIso, endIsoExclusive, locationId, locationId) as ProcessedReturnRow[];
}

export type CreditorRow = {
  supplier_id: string;
  supplier_name: string;
  balance_cents: number;
  document_count: number;
};

/** Current (point-in-time, not period-scoped) balance owed to each supplier —
 * a liability snapshot, not a flow, so it deliberately ignores the report's
 * date range. Drafts are excluded (an unsubmitted cart owes nothing yet);
 * cancelled purchases are excluded (never happened). */
export function findOutstandingCreditors(tenantId: string, locationId: string | null): CreditorRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT p.supplier_id, s.business_name AS supplier_name,
        SUM(p.grand_total_cents - p.amount_paid_cents) AS balance_cents,
        COUNT(*) AS document_count
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.tenant_id = ?
        AND p.status NOT IN ('cancelled', 'draft')
        AND p.payment_status != 'paid'
        AND (? IS NULL OR p.location_id = ?)
      GROUP BY p.supplier_id, s.business_name
      HAVING SUM(p.grand_total_cents - p.amount_paid_cents) > 0
      ORDER BY balance_cents DESC
    `
    )
    .all(tenantId, locationId, locationId) as CreditorRow[];
}

export type DebtorRow = {
  customer_id: string | null;
  customer_name: string;
  balance_cents: number;
  document_count: number;
};

/** Current (point-in-time, not period-scoped) balance each customer owes —
 * an asset snapshot. Nets out approved returns (a returned item isn't owed
 * for) before summing the unpaid remainder per invoice. */
export function findOutstandingDebtors(tenantId: string, locationId: string | null): DebtorRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.customer_id,
        COALESCE(c.name, 'Walk-in / no customer on file') AS customer_name,
        SUM(MAX(0, s.grand_total_cents - s.amount_paid_cents - COALESCE(ret.returned_value_cents, 0))) AS balance_cents,
        COUNT(*) AS document_count
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN (
        SELECT si.sale_id AS sale_id, SUM(sri.line_total_cents) AS returned_value_cents
        FROM sale_return_items sri
        JOIN sale_returns sr ON sr.id = sri.sale_return_id AND sr.status = 'approved'
        JOIN sale_items si ON si.id = sri.sale_item_id
        GROUP BY si.sale_id
      ) ret ON ret.sale_id = s.id
      WHERE s.tenant_id = ?
        AND s.sale_status = 'completed'
        AND s.invoice_number IS NOT NULL
        AND s.payment_status NOT IN ('paid', 'cancelled')
        AND (? IS NULL OR s.location_id = ?)
        AND ${EXCLUDE_VOIDED}
      GROUP BY s.customer_id, customer_name
      HAVING SUM(MAX(0, s.grand_total_cents - s.amount_paid_cents - COALESCE(ret.returned_value_cents, 0))) > 0
      ORDER BY balance_cents DESC
    `
    )
    .all(tenantId, locationId, locationId) as DebtorRow[];
}

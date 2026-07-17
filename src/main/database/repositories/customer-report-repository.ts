import { getDatabase } from "@main/database/connection";

// Mirrors the same exclusion rules as report-repository.ts/product-report-repository.ts: a
// sale only counts once money has actually changed hands, and an approved void erases it.
const EXCLUDE_VOIDED = `s.id NOT IN (SELECT sale_id FROM sale_voids WHERE status = 'approved')`;
const EXCLUDE_UNPAID_INVOICES = `(s.invoice_number IS NULL OR s.amount_paid_cents > 0)`;
const SALE_QUALIFYING_WHERE = `
  s.tenant_id = ? AND s.sale_status = 'completed'
  AND s.transaction_type IN ('retail_sale', 'wholesale_sale', 'invoice')
  AND s.payment_status != 'cancelled'
  AND ${EXCLUDE_UNPAID_INVOICES}
  AND (? IS NULL OR s.location_id = ?)
  AND ${EXCLUDE_VOIDED}
`;

export type TopCustomerRowRaw = {
  customer_id: string;
  customer_name: string;
  phone: string;
  transaction_count: number;
  revenue_cents: number;
};

/** Every customer with at least one qualifying, attributed sale in
 * [startIso, endIsoExclusive) — walk-in sales with no customer attached
 * can't be ranked as "a customer", so those are excluded entirely. */
export function findTopCustomersInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): TopCustomerRowRaw[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.customer_id, c.name AS customer_name, c.phone,
        COUNT(*) AS transaction_count,
        SUM(s.grand_total_cents) AS revenue_cents
      FROM sales s
      JOIN customers c ON c.id = s.customer_id
      WHERE ${SALE_QUALIFYING_WHERE}
        AND s.customer_id IS NOT NULL
        AND s.completed_at >= ? AND s.completed_at < ?
      GROUP BY s.customer_id, c.name, c.phone
      ORDER BY revenue_cents DESC
    `
    )
    .all(tenantId, locationId, locationId, startIso, endIsoExclusive) as TopCustomerRowRaw[];
}

export type CustomerPurchaseHistoryRowRaw = {
  sale_id: string;
  completed_at: string;
  transaction_type: string;
  document_number: string | null;
  location_name: string;
  employee_name: string;
  item_count: number;
  grand_total_cents: number;
  amount_paid_cents: number;
  payment_status: string;
};

/** Every completed sale/invoice for one customer, newest first — not
 * period-scoped, since a "purchase history" is the whole story. */
export function findCustomerPurchaseHistory(
  tenantId: string,
  locationId: string | null,
  customerId: string,
  limit: number
): CustomerPurchaseHistoryRowRaw[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.id AS sale_id, s.completed_at, s.transaction_type,
        COALESCE(s.invoice_number, s.receipt_number) AS document_number,
        l.location_name, (e.first_name || ' ' || e.last_name) AS employee_name,
        (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
        s.grand_total_cents, s.amount_paid_cents, s.payment_status
      FROM sales s
      JOIN locations l ON l.id = s.location_id
      JOIN employees e ON e.id = s.employee_id
      WHERE s.customer_id = ? AND ${SALE_QUALIFYING_WHERE}
      ORDER BY s.completed_at DESC
      LIMIT ?
    `
    )
    .all(customerId, tenantId, locationId, locationId, limit) as CustomerPurchaseHistoryRowRaw[];
}

export type OutstandingInvoiceRowRaw = {
  sale_id: string;
  customer_id: string;
  customer_name: string;
  phone: string;
  document_number: string | null;
  completed_at: string;
  due_date: string | null;
  grand_total_cents: number;
  amount_paid_cents: number;
  returned_value_cents: number;
};

/** Every currently-outstanding (unpaid or partially-paid) invoice, oldest
 * first — a live snapshot, not scoped to any selected period, since a debt
 * doesn't stop existing just because you picked a different date range. */
export function findOutstandingInvoices(tenantId: string, locationId: string | null): OutstandingInvoiceRowRaw[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        s.id AS sale_id, s.customer_id, c.name AS customer_name, c.phone,
        COALESCE(s.invoice_number, s.receipt_number) AS document_number,
        s.completed_at, s.due_date, s.grand_total_cents, s.amount_paid_cents,
        COALESCE(ret.returned_value_cents, 0) AS returned_value_cents
      FROM sales s
      JOIN customers c ON c.id = s.customer_id
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
      ORDER BY s.completed_at ASC
    `
    )
    .all(tenantId, locationId, locationId) as OutstandingInvoiceRowRaw[];
}

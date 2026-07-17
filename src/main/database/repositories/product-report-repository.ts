import { getDatabase } from "@main/database/connection";

// Mirrors the same exclusion rules as report-repository.ts: a sale only counts once money
// has actually changed hands, an approved void erases it entirely, and an approved return
// nets out of the goods actually sold.
const EXCLUDE_VOIDED = `s.id NOT IN (SELECT sale_id FROM sale_voids WHERE status = 'approved')`;
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
const SALE_QUALIFYING_WHERE = `
  s.tenant_id = ? AND s.sale_status = 'completed'
  AND s.transaction_type IN ('retail_sale', 'wholesale_sale', 'invoice')
  AND s.payment_status != 'cancelled'
  AND ${EXCLUDE_UNPAID_INVOICES}
  AND (? IS NULL OR s.location_id = ?)
  AND ${EXCLUDE_VOIDED}
`;

export type ProductSalesAggregateRow = {
  product_id: string;
  product_name: string;
  sku: string;
  category_name: string | null;
  quantity_sold: number;
  revenue_cents: number;
  cost_cents: number;
};

/** Every product with at least one qualifying sale in [startIso, endIsoExclusive) — the
 * basis for "Best Selling"; products with zero sales in range simply don't appear. */
export function findProductSalesAggregateInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): ProductSalesAggregateRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        si.product_id, p.name AS product_name, p.sku, c.name AS category_name,
        SUM(si.quantity - COALESCE(ret.returned_quantity, 0)) AS quantity_sold,
        SUM(si.line_total_cents - COALESCE(ret.returned_line_total_cents, 0)) AS revenue_cents,
        SUM((si.quantity - COALESCE(ret.returned_quantity, 0)) * p.buying_price_cents) AS cost_cents
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      ${RETURN_NETTING_JOIN}
      WHERE ${SALE_QUALIFYING_WHERE}
        AND s.completed_at >= ? AND s.completed_at < ?
      GROUP BY si.product_id, p.name, p.sku, c.name
      ORDER BY quantity_sold DESC
    `
    )
    .all(tenantId, locationId, locationId, startIso, endIsoExclusive) as ProductSalesAggregateRow[];
}

export type ActiveProductRow = {
  product_id: string;
  product_name: string;
  sku: string;
  category_name: string | null;
};

/** Every active, stock-tracked product, tenant-wide — the baseline "Slow Moving" starts
 * from, since a product that's sold nothing at all in the period is exactly the point. */
export function findAllActiveProductsForReport(tenantId: string): ActiveProductRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT p.id AS product_id, p.name AS product_name, p.sku, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.tenant_id = ? AND p.track_stock = 1 AND p.status = 'active'
      ORDER BY p.name
    `
    )
    .all(tenantId) as ActiveProductRow[];
}

export type LastSoldRow = { product_id: string; last_sold_at: string };

/** The most recent qualifying sale date for every product that has ever sold at all — not
 * bounded by the report's selected period, so "days since last sale" stays meaningful even
 * for a product with zero sales in the period currently being viewed. */
export function findLastSoldAtByProduct(tenantId: string, locationId: string | null): LastSoldRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT si.product_id, MAX(s.completed_at) AS last_sold_at
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${SALE_QUALIFYING_WHERE}
      GROUP BY si.product_id
    `
    )
    .all(tenantId, locationId, locationId) as LastSoldRow[];
}

export type ProductSalesHistoryRowRaw = {
  sale_item_id: string;
  completed_at: string;
  transaction_type: string;
  document_number: string | null;
  location_name: string;
  customer_name: string | null;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

/** Every individual sale of one specific product, newest first — the detail behind
 * "Product Sales History". Not period-scoped; this is a full history lookup. */
export function findProductSalesHistory(
  tenantId: string,
  locationId: string | null,
  productId: string,
  limit: number
): ProductSalesHistoryRowRaw[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        si.id AS sale_item_id, s.completed_at, s.transaction_type,
        COALESCE(s.invoice_number, s.receipt_number) AS document_number,
        l.location_name, c.name AS customer_name,
        (si.quantity - COALESCE(ret.returned_quantity, 0)) AS quantity,
        si.unit_price_cents,
        (si.line_total_cents - COALESCE(ret.returned_line_total_cents, 0)) AS line_total_cents
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN locations l ON l.id = s.location_id
      LEFT JOIN customers c ON c.id = s.customer_id
      ${RETURN_NETTING_JOIN}
      WHERE si.product_id = ? AND ${SALE_QUALIFYING_WHERE}
      ORDER BY s.completed_at DESC
      LIMIT ?
    `
    )
    .all(productId, tenantId, locationId, locationId, limit) as ProductSalesHistoryRowRaw[];
}

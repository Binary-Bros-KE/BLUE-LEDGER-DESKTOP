import { getDatabase } from "@main/database/connection";

// Mirrors product-report-repository.ts's own exclusion rules exactly — a sale only counts once
// money has actually changed hands, an approved void erases it entirely, and an approved return
// nets out of the goods actually sold. Kept as a separate copy (not imported) since that file's
// constants aren't exported — same "one small SQL fragment repeated per report repository" pattern
// already established there.
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

export type TaxSaleItemRow = {
  product_id: string;
  product_name: string;
  sku: string;
  tax_type: string;
  quantity: number;
  returned_quantity: number | null;
  tax_amount_cents: number;
  line_total_cents: number;
  returned_line_total_cents: number | null;
};

/** Every qualifying sale line in [startIso, endIsoExclusive), raw (not pre-aggregated) — return
 * netting and tax-category grouping both happen in tax-report-service.ts, in plain JS, since
 * proportionally netting tax out of a partially-returned line is easier to get right (and verify)
 * there than as a nested SQL expression. */
export function findTaxableSaleItemsInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): TaxSaleItemRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        si.product_id, p.name AS product_name, p.sku, si.tax_type,
        si.quantity, ret.returned_quantity,
        si.tax_amount_cents, si.line_total_cents, ret.returned_line_total_cents
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      ${RETURN_NETTING_JOIN}
      WHERE ${SALE_QUALIFYING_WHERE}
        AND s.completed_at >= ? AND s.completed_at < ?
    `
    )
    .all(tenantId, locationId, locationId, startIso, endIsoExclusive) as TaxSaleItemRow[];
}

import { getDatabase } from "@main/database/connection";

// Mirrors tax-report-repository.ts's own exclusion rules exactly (same reasoning: a sale only
// counts once money has actually changed hands, an approved void erases it, an approved return
// nets out of goods actually sold) — kept as its own copy, not imported, matching the established
// "one small SQL fragment repeated per report repository" convention already used across Reports.
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

export type LocalSourcingSaleItemRow = {
  product_id: string;
  product_name: string;
  sku: string;
  local_supplier_id: string | null;
  local_supplier_name: string | null;
  local_cost_cents: number | null;
  quantity: number;
  returned_quantity: number | null;
  line_total_cents: number;
  returned_line_total_cents: number | null;
  // Same fields report-service.ts's own getNetRevenueCents reads to derive fractionPaid — a cash
  // sale (invoice_number NULL) is 100% "real" the moment it completes, but an invoice's revenue/cost
  // only becomes real cash-basis economics as it actually gets paid, so a locally-sourced line on a
  // 40%-paid invoice should only count 40% of its revenue and cost here too, not the full line.
  invoice_number: string | null;
  amount_paid_cents: number;
  grand_total_cents: number;
};

/** Every locally-sourced sale line in [startIso, endIsoExclusive), raw (not pre-aggregated) —
 * return netting and supplier/product grouping both happen in local-sourcing-report-service.ts,
 * same division of labor as tax-report-repository.ts's own doc comment explains. */
export function findLocallySourcedSaleItemsInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): LocalSourcingSaleItemRow[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        si.product_id, p.name AS product_name, p.sku,
        si.local_supplier_id, sup.business_name AS local_supplier_name, si.local_cost_cents,
        si.quantity, ret.returned_quantity,
        si.line_total_cents, ret.returned_line_total_cents,
        s.invoice_number, s.amount_paid_cents, s.grand_total_cents
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      LEFT JOIN suppliers sup ON sup.id = si.local_supplier_id
      ${RETURN_NETTING_JOIN}
      WHERE ${SALE_QUALIFYING_WHERE}
        AND s.completed_at >= ? AND s.completed_at < ?
        AND si.is_locally_sourced = 1
    `
    )
    .all(tenantId, locationId, locationId, startIso, endIsoExclusive) as LocalSourcingSaleItemRow[];
}

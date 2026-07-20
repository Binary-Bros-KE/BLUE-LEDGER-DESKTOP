import { getDatabase } from "@main/database/connection";

// A draft is an unsubmitted, freely-editable cart — never actually placed with the supplier, so
// it's excluded everywhere. A cancelled purchase WAS actually placed (then called off before any
// stock arrived — cancelPurchase() only allows that pre-receiving), so it stays out of money totals
// (assumed unpaid, or refunded if it wasn't) but should still show up in a supplier's own history —
// see EXCLUDE_DRAFT_ONLY below.
const EXCLUDE_DRAFT_AND_CANCELLED = `p.status NOT IN ('draft', 'cancelled')`;
const EXCLUDE_DRAFT_ONLY = `p.status != 'draft'`;

export type OutstandingPurchaseRowRaw = {
  purchase_id: string;
  supplier_id: string;
  supplier_name: string;
  phone: string;
  purchase_number: string;
  status: string;
  ordered_at: string | null;
  created_at: string;
  grand_total_cents: number;
  amount_paid_cents: number;
};

/** Every currently-outstanding (unpaid or partially-paid) purchase, oldest
 * first — a live snapshot, not scoped to any selected period. */
export function findOutstandingPurchases(tenantId: string, locationId: string | null): OutstandingPurchaseRowRaw[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        p.id AS purchase_id, p.supplier_id, s.business_name AS supplier_name, s.phone_1 AS phone,
        p.purchase_number, p.status, p.ordered_at, p.created_at,
        p.grand_total_cents, p.amount_paid_cents
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.tenant_id = ?
        AND ${EXCLUDE_DRAFT_AND_CANCELLED}
        AND p.payment_status != 'paid'
        AND (? IS NULL OR p.location_id = ?)
      ORDER BY COALESCE(p.ordered_at, p.created_at) ASC
    `
    )
    .all(tenantId, locationId, locationId) as OutstandingPurchaseRowRaw[];
}

export type SupplierSpendRowRaw = {
  supplier_id: string;
  supplier_name: string;
  phone: string;
  purchase_count: number;
  total_spent_cents: number;
};

/** Every supplier with at least one qualifying purchase in [startIso, endIsoExclusive), summed by
 * total purchase value (not just what's been paid so far). */
export function findSupplierSpendInRange(
  tenantId: string,
  locationId: string | null,
  startIso: string,
  endIsoExclusive: string
): SupplierSpendRowRaw[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        p.supplier_id, s.business_name AS supplier_name, s.phone_1 AS phone,
        COUNT(*) AS purchase_count, SUM(p.grand_total_cents) AS total_spent_cents
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.tenant_id = ?
        AND ${EXCLUDE_DRAFT_AND_CANCELLED}
        AND (? IS NULL OR p.location_id = ?)
        AND COALESCE(p.ordered_at, p.created_at) >= ? AND COALESCE(p.ordered_at, p.created_at) < ?
      GROUP BY p.supplier_id, s.business_name, s.phone_1
      ORDER BY total_spent_cents DESC
    `
    )
    .all(tenantId, locationId, locationId, startIso, endIsoExclusive) as SupplierSpendRowRaw[];
}

export type SupplierPurchaseHistoryRowRaw = {
  purchase_id: string;
  purchase_number: string;
  status: string;
  ordered_at: string | null;
  received_at: string | null;
  created_at: string;
  item_count: number;
  grand_total_cents: number;
  amount_paid_cents: number;
  payment_status: string;
};

/** Every purchase for one supplier, newest first — draft carts excluded (never actually placed),
 * but cancelled purchases stay visible, since a "purchase history" is the whole story, not just the
 * ones that went through. Money aggregates elsewhere still exclude cancelled ones. */
export function findSupplierPurchaseHistory(
  tenantId: string,
  locationId: string | null,
  supplierId: string,
  limit: number
): SupplierPurchaseHistoryRowRaw[] {
  return getDatabase()
    .prepare(
      `
      SELECT
        p.id AS purchase_id, p.purchase_number, p.status, p.ordered_at, p.received_at, p.created_at,
        (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count,
        p.grand_total_cents, p.amount_paid_cents, p.payment_status
      FROM purchases p
      WHERE p.supplier_id = ? AND p.tenant_id = ?
        AND ${EXCLUDE_DRAFT_ONLY}
        AND (? IS NULL OR p.location_id = ?)
      ORDER BY p.created_at DESC
      LIMIT ?
    `
    )
    .all(supplierId, tenantId, locationId, locationId, limit) as SupplierPurchaseHistoryRowRaw[];
}

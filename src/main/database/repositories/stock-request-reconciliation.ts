import { getDatabase, runInTransaction } from "@main/database/connection";

type Item = {
  id: string;
  product_id: string;
  quantity_requested: number;
  quantity_dispatched: number | null;
};
type Movement = {
  product_id: string;
  location_id: string;
  movement_type: string;
  quantity_change: number;
  previous_quantity: number | null;
  new_quantity: number | null;
  performed_by: string | null;
  created_at: string;
};

/** Metadata repair only: require complete movements linked to this exact request, never product/date
 * guesses or inventory replay. Partial dispatch is recoverable only if all intended quantities exist.
 * Missing pages and ambiguous duplicate transfers are left for review, never auto-fulfilled.
 */
export function reconcileFulfilledStockRequests(tenantId: string): number {
  const db = getDatabase();
  const requests = db
    .prepare(
      `SELECT id, storefront_id, updated_at FROM stock_requests sr
    WHERE tenant_id = ? AND status = 'pending' AND (EXISTS (
      SELECT 1 FROM stock_movements sm WHERE sm.tenant_id = sr.tenant_id
      AND sm.reference_type = 'stock_request_fulfillment' AND sm.reference_id = sr.id
      AND sm.location_id = sr.storefront_id AND sm.movement_type = 'transfer_in' AND sm.quantity_change > 0
    ) OR EXISTS (SELECT 1 FROM stock_receipts r WHERE r.tenant_id = sr.tenant_id AND r.stock_request_id = sr.id))`
    )
    .all(tenantId) as Array<{ id: string; storefront_id: string; updated_at: string }>;
  let repaired = 0;
  for (const request of requests) {
    const items = db
      .prepare("SELECT * FROM stock_request_items WHERE stock_request_id = ?")
      .all(request.id) as Item[];
    if (!items.length || new Set(items.map((i) => i.product_id)).size !== items.length) continue;
    const receipt = db
      .prepare("SELECT id FROM stock_receipts WHERE tenant_id = ? AND stock_request_id = ?")
      .get(tenantId, request.id) as { id: string } | undefined;
    const receiptItems = receipt
      ? (db
          .prepare(
            "SELECT product_id, quantity_received FROM stock_receipt_items WHERE stock_receipt_id = ?"
          )
          .all(receipt.id) as Array<{ product_id: string; quantity_received: number }>)
      : [];
    if (
      receipt &&
      (!receiptItems.length ||
        new Set(receiptItems.map((i) => i.product_id)).size !== receiptItems.length ||
        receiptItems.some((i) => !items.some((line) => line.product_id === i.product_id)))
    )
      continue;
    const movements = db
      .prepare(
        `SELECT * FROM stock_movements WHERE tenant_id = ? AND reference_type = ?
      AND reference_id = ? ORDER BY created_at, id`
      )
      .all(
        tenantId,
        receipt ? "stock_receipt" : "stock_request_fulfillment",
        receipt?.id ?? request.id
      ) as Movement[];
    const incoming = movements.filter(
      (m) =>
        m.location_id === request.storefront_id &&
        m.movement_type === "transfer_in" &&
        m.quantity_change > 0
    );
    if (!incoming.length) continue;
    if (incoming.some((m) => !items.some((i) => i.product_id === m.product_id))) continue;
    const evidence = items.map((item) => {
      const entries = incoming.filter((m) => m.product_id === item.product_id);
      const expected = receipt
        ? (receiptItems.find((i) => i.product_id === item.product_id)?.quantity_received ?? 0)
        : (item.quantity_dispatched ?? item.quantity_requested);
      if (expected === 0)
        return entries.length === 0 ? { item, received: null, outgoing: [] as Movement[] } : null;
      if (
        expected < 0 ||
        expected > item.quantity_requested ||
        entries.length !== 1 ||
        entries[0]!.quantity_change !== expected
      )
        return null;
      const outgoing = movements.filter(
        (m) =>
          m.product_id === item.product_id &&
          m.movement_type === "transfer_out" &&
          m.quantity_change < 0 &&
          m.location_id !== request.storefront_id
      );
      if (outgoing.reduce((sum, m) => sum - m.quantity_change, 0) !== expected) return null;
      return { item, received: entries[0]!, outgoing };
    });
    if (evidence.some((e) => e === null)) continue;
    runInTransaction(() => {
      for (const entry of evidence) {
        if (!entry) continue;
        const { item, received, outgoing } = entry;
        const previous = outgoing
          .map((m) => m.previous_quantity)
          .filter((n): n is number => n !== null);
        const next = outgoing.map((m) => m.new_quantity).filter((n): n is number => n !== null);
        db.prepare(
          `UPDATE stock_request_items SET quantity_dispatched = ?, previous_quantity = COALESCE(previous_quantity, ?),
          new_quantity = COALESCE(new_quantity, ?), main_store_previous_quantity = COALESCE(main_store_previous_quantity, ?),
          main_store_new_quantity = COALESCE(main_store_new_quantity, ?) WHERE id = ?`
        ).run(
          received?.quantity_change ?? 0,
          received?.previous_quantity ?? null,
          received?.new_quantity ?? null,
          previous.length ? Math.max(...previous) : null,
          next.length ? Math.min(...next) : null,
          item.id
        );
      }
      const last = incoming[incoming.length - 1]!;
      const updated = new Date(
        Math.max(Date.now(), Date.parse(request.updated_at) + 1)
      ).toISOString();
      db.prepare(
        `UPDATE stock_requests SET status = 'approved', rejection_reason = NULL, reviewed_by = COALESCE(reviewed_by, ?),
        reviewed_at = COALESCE(reviewed_at, ?), updated_at = ?, sync_status = 'pending' WHERE id = ? AND status = 'pending'`
      ).run(last.performed_by, last.created_at, updated, request.id);
      repaired++;
    });
  }
  return repaired;
}

import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";
import type { SaleDelivery } from "@shared/types/sale";

export type DeliveryNoteRow = {
  id: string;
  tenant_id: string;
  delivery_note_number: string;
  sale_id: string | null;
  quotation_id: string | null;
  rider_id: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  rider_company: string | null;
  rider_vehicle_description: string | null;
  recipient_name: string;
  country: string | null;
  town: string | null;
  physical_address: string;
  notes: string | null;
  fee_cents: number;
  cost_cents: number;
  is_delivered: number;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
};

const SELECT_WITH_RIDER = `
  SELECT dn.*, r.name AS rider_name, r.phone AS rider_phone, r.company AS rider_company,
    r.vehicle_description AS rider_vehicle_description
  FROM delivery_notes dn
  LEFT JOIN riders r ON r.id = dn.rider_id
`;

export function findDeliveryNoteRowById(id: string): DeliveryNoteRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_RIDER} WHERE dn.id = ?`).get(id) as DeliveryNoteRow | undefined;
}

export function findDeliveryNoteRowBySaleId(saleId: string): DeliveryNoteRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_RIDER} WHERE dn.sale_id = ?`).get(saleId) as
    | DeliveryNoteRow
    | undefined;
}

export function findDeliveryNoteRowByQuotationId(quotationId: string): DeliveryNoteRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_RIDER} WHERE dn.quotation_id = ?`).get(quotationId) as
    | DeliveryNoteRow
    | undefined;
}

// Returns every matching number, not just the max — see document-number-service.ts's own comment.
export function findMaxDeliveryNoteNumberRow(tenantId: string): string[] {
  return (
    getDatabase()
      .prepare("SELECT delivery_note_number FROM delivery_notes WHERE tenant_id = ? AND delivery_note_number LIKE 'DN-%'")
      .all(tenantId) as Array<{ delivery_note_number: string }>
  ).map((row) => row.delivery_note_number);
}

export function insertDeliveryNoteRow(input: {
  tenantId: string;
  deliveryNoteNumber: string;
  saleId: string | null;
  quotationId: string | null;
  riderId: string | null;
  recipientName: string;
  country: string | null;
  town: string | null;
  physicalAddress: string;
  notes: string | null;
  feeCents: number;
  costCents: number;
}): DeliveryNoteRow {
  const id = `dn_${randomUUID()}`;
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO delivery_notes (
        id, tenant_id, delivery_note_number, sale_id, quotation_id, rider_id, recipient_name,
        country, town, physical_address, notes, fee_cents, cost_cents, is_delivered, delivered_at,
        created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, 'pending')
    `
    )
    .run(
      id,
      input.tenantId,
      input.deliveryNoteNumber,
      input.saleId,
      input.quotationId,
      input.riderId,
      input.recipientName,
      input.country,
      input.town,
      input.physicalAddress,
      input.notes,
      input.feeCents,
      input.costCents,
      now,
      now
    );

  const row = findDeliveryNoteRowById(id);
  if (!row) {
    throw new Error("Failed to create delivery note record");
  }
  return row;
}

/** Part of the FK-cleanup required before deleting a held sale — this app has no ON DELETE CASCADE. */
export function deleteDeliveryNoteForSaleRow(saleId: string): void {
  getDatabase().prepare("DELETE FROM delivery_notes WHERE sale_id = ?").run(saleId);
}

/** Part of the FK-cleanup required before deleting a draft quotation — this app has no ON DELETE CASCADE. */
export function deleteDeliveryNoteForQuotationRow(quotationId: string): void {
  getDatabase().prepare("DELETE FROM delivery_notes WHERE quotation_id = ?").run(quotationId);
}

export function setDeliveryNoteDeliveredRow(id: string, delivered: boolean): DeliveryNoteRow {
  const now = new Date().toISOString();
  const db = getDatabase();

  const parent = db.prepare("SELECT sale_id, quotation_id FROM delivery_notes WHERE id = ?").get(id) as
    | { sale_id: string | null; quotation_id: string | null }
    | undefined;
  if (!parent) {
    throw new Error("Delivery note not found");
  }

  db
    .prepare("UPDATE delivery_notes SET is_delivered = ?, delivered_at = ?, updated_at = ? WHERE id = ?")
    .run(delivered ? 1 : 0, delivered ? now : null, now, id);

  // Delivery status lives inside the parent sale/quotation's own nested sync payload (see
  // sync-engine.ts's PAYLOAD_BUILDERS), not as an independent sync unit — migrate.ts's
  // trg_delivery_notes_reenqueue_sale_au/_quotation_au triggers already re-queue the parent for
  // push when is_delivered changes, but queuing alone isn't enough: every device's own pull-side
  // guard for sales/quotations (applySalePulledRow / upsertDocumentHeader) only applies an incoming
  // payload when its updated_at is strictly newer than what's already stored locally. Since this
  // update only ever touched delivery_notes.updated_at, the parent's own updated_at never changed,
  // so a receiving device saw "already same-or-newer" and silently skipped the fresh payload forever
  // — exactly why "mark delivered" never propagated while "mark invoice as paid" (which writes
  // straight to the sale row) always did. Bumping the parent's updated_at here, the same way any
  // other real edit to it would, is what makes the already-correct trigger + payload machinery
  // actually take effect on the receiving end.
  if (parent.sale_id) {
    db.prepare("UPDATE sales SET updated_at = ? WHERE id = ?").run(now, parent.sale_id);
  } else if (parent.quotation_id) {
    db.prepare("UPDATE quotations SET updated_at = ? WHERE id = ?").run(now, parent.quotation_id);
  }

  const row = findDeliveryNoteRowById(id);
  if (!row) {
    throw new Error("Delivery note not found after status update");
  }
  return row;
}

export function mapDeliveryNoteRow(row: DeliveryNoteRow): SaleDelivery {
  return {
    id: row.id,
    deliveryNoteNumber: row.delivery_note_number,
    riderId: row.rider_id,
    riderName: row.rider_name,
    riderPhone: row.rider_phone,
    riderCompany: row.rider_company,
    riderVehicleDescription: row.rider_vehicle_description,
    recipientName: row.recipient_name,
    country: row.country,
    town: row.town,
    physicalAddress: row.physical_address,
    notes: row.notes,
    feeCents: row.fee_cents,
    costCents: row.cost_cents,
    isDelivered: row.is_delivered === 1,
    deliveredAt: row.delivered_at
  };
}

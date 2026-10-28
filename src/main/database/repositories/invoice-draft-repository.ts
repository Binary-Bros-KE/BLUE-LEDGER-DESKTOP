import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";

/** invoice_drafts is local-only — see its migration (migrate.ts, "invoice_drafts_local_only"). No
 * write here may ever touch sync_outbox or sync columns. */
export type InvoiceDraftRow = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  customer_name: string | null;
  storefront_id: string | null;
  item_count: number;
  estimated_total_cents: number;
  form_json: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_WITH_JOINS = `
  SELECT d.*, CASE WHEN e.id IS NULL THEN NULL ELSE (e.first_name || ' ' || e.last_name) END AS created_by_name
  FROM invoice_drafts d
  LEFT JOIN employees e ON e.id = d.created_by
`;

/** storefrontId null = every draft on this device (unassigned Super Admin); otherwise one storefront's,
 * plus any draft saved without a storefront. */
export function findAllDraftRows(tenantId: string, storefrontId: string | null): InvoiceDraftRow[] {
  return getDatabase()
    .prepare(
      `${SELECT_WITH_JOINS} WHERE d.tenant_id = ? AND (? IS NULL OR d.storefront_id IS NULL OR d.storefront_id = ?) ORDER BY d.updated_at DESC`
    )
    .all(tenantId, storefrontId, storefrontId) as InvoiceDraftRow[];
}

export function findDraftRowById(id: string): InvoiceDraftRow | undefined {
  return getDatabase().prepare(`${SELECT_WITH_JOINS} WHERE d.id = ?`).get(id) as InvoiceDraftRow | undefined;
}

export type DraftFields = {
  customerId: string | null;
  customerName: string | null;
  storefrontId: string | null;
  itemCount: number;
  estimatedTotalCents: number;
  formJson: string;
};

export function insertDraftRow(tenantId: string, createdBy: string | null, fields: DraftFields): string {
  const id = `idraft_${randomUUID()}`;
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO invoice_drafts (
        id, tenant_id, customer_id, customer_name, storefront_id, item_count, estimated_total_cents, form_json,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      tenantId,
      fields.customerId,
      fields.customerName,
      fields.storefrontId,
      fields.itemCount,
      fields.estimatedTotalCents,
      fields.formJson,
      createdBy,
      now,
      now
    );
  return id;
}

export function updateDraftRow(id: string, fields: DraftFields): void {
  getDatabase()
    .prepare(
      `UPDATE invoice_drafts
       SET customer_id = ?, customer_name = ?, storefront_id = ?, item_count = ?, estimated_total_cents = ?, form_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      fields.customerId,
      fields.customerName,
      fields.storefrontId,
      fields.itemCount,
      fields.estimatedTotalCents,
      fields.formJson,
      new Date().toISOString(),
      id
    );
}

export function deleteDraftRow(id: string): void {
  getDatabase().prepare("DELETE FROM invoice_drafts WHERE id = ?").run(id);
}

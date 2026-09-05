import { randomUUID } from "node:crypto";
import { getDatabase } from "@main/database/connection";
import type { ServiceChargeTaxType } from "@shared/schemas/charges";
import type { SaleServiceCharge } from "@shared/types/sale";

export type ServiceChargeRow = {
  id: string;
  tenant_id: string;
  sale_id: string | null;
  quotation_id: string | null;
  name: string;
  fee_cents: number;
  cost_cents: number;
  tax_type: string;
  tax_inclusive: number | null;
  tax_amount_cents: number;
  line_total_cents: number;
  created_at: string;
  sync_status: string;
};

export function findServiceChargeRowsForSale(saleId: string): ServiceChargeRow[] {
  return getDatabase()
    .prepare("SELECT * FROM sale_service_charges WHERE sale_id = ? ORDER BY created_at ASC")
    .all(saleId) as ServiceChargeRow[];
}

export function findServiceChargeRowsForQuotation(quotationId: string): ServiceChargeRow[] {
  return getDatabase()
    .prepare("SELECT * FROM sale_service_charges WHERE quotation_id = ? ORDER BY created_at ASC")
    .all(quotationId) as ServiceChargeRow[];
}

export function insertServiceChargeRow(input: {
  tenantId: string;
  saleId: string | null;
  quotationId: string | null;
  name: string;
  feeCents: number;
  costCents: number;
  taxType: ServiceChargeTaxType;
  taxInclusive: boolean | null;
  taxAmountCents: number;
  lineTotalCents: number;
}): ServiceChargeRow {
  const id = `svc_chg_${randomUUID()}`;
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO sale_service_charges (
        id, tenant_id, sale_id, quotation_id, name, fee_cents, cost_cents,
        tax_type, tax_inclusive, tax_amount_cents, line_total_cents, created_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      id,
      input.tenantId,
      input.saleId,
      input.quotationId,
      input.name,
      input.feeCents,
      input.costCents,
      input.taxType,
      input.taxInclusive === null ? null : input.taxInclusive ? 1 : 0,
      input.taxAmountCents,
      input.lineTotalCents,
      now
    );

  return getDatabase().prepare("SELECT * FROM sale_service_charges WHERE id = ?").get(id) as ServiceChargeRow;
}

/** Part of the FK-cleanup required before deleting a held sale — this app has no ON DELETE CASCADE. */
export function deleteServiceChargesForSaleRow(saleId: string): void {
  getDatabase().prepare("DELETE FROM sale_service_charges WHERE sale_id = ?").run(saleId);
}

/** Part of the FK-cleanup required before deleting a draft quotation — this app has no ON DELETE CASCADE. */
export function deleteServiceChargesForQuotationRow(quotationId: string): void {
  getDatabase().prepare("DELETE FROM sale_service_charges WHERE quotation_id = ?").run(quotationId);
}

export function mapServiceChargeRow(row: ServiceChargeRow): SaleServiceCharge {
  return {
    id: row.id,
    name: row.name,
    feeCents: row.fee_cents,
    costCents: row.cost_cents,
    taxType: row.tax_type as ServiceChargeTaxType,
    taxInclusive: row.tax_inclusive === null ? null : Boolean(row.tax_inclusive),
    taxAmountCents: row.tax_amount_cents,
    lineTotalCents: row.line_total_cents
  };
}

import { getDatabase, runInTransaction } from "@main/database/connection";
import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { deliveryInputSchema } from "@shared/schemas/charges";
import type { SaleDelivery } from "@shared/types/sale";

/** DN-D{n}-000001, DN-D{n}-000002, ... — generated fresh every time a delivery is attached to a
 * sale/invoice/quotation, including on quotation-conversion (the quotation's own delivery note
 * number is never reused, since the sale is a distinct document under the same tenant-wide unique
 * index). */
export function generateDeliveryNoteNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "DN",
    digits: 6,
    existingNumbers: deliveryNoteRepository.findMaxDeliveryNoteNumberRow(tenantId)
  });
}

export function getDeliveryNote(id: string): SaleDelivery {
  requirePermission("sales", "view");
  const row = deliveryNoteRepository.findDeliveryNoteRowById(id);
  if (!row) {
    throw new Error("Delivery note not found");
  }
  return deliveryNoteRepository.mapDeliveryNoteRow(row);
}

export function getDeliveryNoteForSale(saleId: string): SaleDelivery | null {
  requirePermission("sales", "view");
  const row = deliveryNoteRepository.findDeliveryNoteRowBySaleId(saleId);
  return row ? deliveryNoteRepository.mapDeliveryNoteRow(row) : null;
}

export function getDeliveryNoteForQuotation(quotationId: string): SaleDelivery | null {
  requirePermission("quotations", "view");
  const row = deliveryNoteRepository.findDeliveryNoteRowByQuotationId(quotationId);
  return row ? deliveryNoteRepository.mapDeliveryNoteRow(row) : null;
}

/** Attaches a delivery to a sale that was completed without one — e.g. a cashier forgot to check
 * "Add delivery for this sale" at checkout. Deliberately never touches the sale's own totals
 * (subtotal/tax/grandTotal) — the sale was already rung up and paid for at whatever the customer
 * actually paid, and retroactively folding a delivery fee into an already-closed, already-reported
 * sale would silently corrupt that day's Sales Report and the Amount Paid vs Total reconciliation.
 * feeCents/costCents are still collected and stored (same record-keeping purpose as any other
 * delivery — see SaleDelivery's own costCents comment), they just don't move any money figures. */
export function attachDeliveryToSale(saleId: string, input: unknown): SaleDelivery {
  requirePermission("sales", "edit");
  const parsed = deliveryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  const saleRow = saleRepository.findSaleRowById(saleId);
  if (!saleRow || saleRow.tenant_id !== tenantId) {
    throw new Error("Sale not found");
  }
  if (saleRow.sale_status !== "completed") {
    throw new Error("Only a completed sale can have a delivery attached");
  }
  if (deliveryNoteRepository.findDeliveryNoteRowBySaleId(saleId)) {
    throw new Error("This sale already has a delivery attached");
  }

  return runInTransaction(() => {
    const row = deliveryNoteRepository.insertDeliveryNoteRow({
      tenantId,
      deliveryNoteNumber: generateDeliveryNoteNumber(tenantId),
      saleId,
      quotationId: null,
      riderId: parsed.riderId,
      recipientName: parsed.recipientName,
      country: parsed.country,
      town: parsed.town,
      physicalAddress: parsed.physicalAddress,
      notes: parsed.notes,
      feeCents: parsed.feeCents,
      costCents: parsed.costCents
    });

    // The delivery_notes INSERT trigger already re-queues the parent sale for push, but a receiving
    // device's own pull guard only applies a payload whose updated_at is strictly newer than what it
    // already has — without this, the sale's updated_at never actually changes, so every OTHER
    // device silently ignores the new delivery forever (this exact trap already bit
    // setDeliveryNoteDeliveredRow once — see its own comment).
    getDatabase().prepare("UPDATE sales SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), saleId);

    return deliveryNoteRepository.mapDeliveryNoteRow(row);
  });
}

/** Delivery status is fully independent of the sale's own revenue recognition — a sale is a real,
 * paid transaction the moment it's rung up, whether or not the delivery has happened yet. This never
 * touches the sale's totals or Sales Report figures. */
export function setDeliveryNoteDelivered(id: string, delivered: boolean): SaleDelivery {
  requirePermission("sales", "edit");
  const row = deliveryNoteRepository.setDeliveryNoteDeliveredRow(id, delivered);
  return deliveryNoteRepository.mapDeliveryNoteRow(row);
}

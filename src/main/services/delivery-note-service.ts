import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import { requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
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

/** Delivery status is fully independent of the sale's own revenue recognition — a sale is a real,
 * paid transaction the moment it's rung up, whether or not the delivery has happened yet. This never
 * touches the sale's totals or Sales Report figures. */
export function setDeliveryNoteDelivered(id: string, delivered: boolean): SaleDelivery {
  requirePermission("sales", "edit");
  const row = deliveryNoteRepository.setDeliveryNoteDeliveredRow(id, delivered);
  return deliveryNoteRepository.mapDeliveryNoteRow(row);
}

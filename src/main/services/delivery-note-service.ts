import { getDatabase, runInTransaction } from "@main/database/connection";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import * as quotationRepository from "@main/database/repositories/quotation-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { createDeliveryCostExpenseIfNeeded } from "@main/services/expense-service";
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

/** A sale/invoice row's own payment method, however it actually got paid — sales/checkout store it
 * directly on payment_method_id; invoices (and anything paid in installments) store it inside the
 * payments JSON array instead, so the first entry there is the fallback. Null for an invoice with no
 * payment recorded yet, same "nothing to attribute this to" case createDeliveryCostExpenseIfNeeded
 * already handles by silently skipping. */
function resolveSalePaymentMethodId(row: saleRepository.SaleRow): string | null {
  if (row.payment_method_id) return row.payment_method_id;
  return saleRepository.parseSalePayments(row.payments)[0]?.paymentMethodId ?? null;
}

/** Attaches a delivery to a sale/invoice that was completed without one — e.g. a cashier forgot to
 * check "Add delivery for this sale" at checkout. Deliberately never touches the sale's own totals
 * (subtotal/tax/grandTotal) — the sale was already rung up and paid for at whatever the customer
 * actually paid, and retroactively folding a delivery fee into an already-closed, already-reported
 * sale would silently corrupt that day's Sales Report and the Amount Paid vs Total reconciliation.
 * feeCents/costCents are still collected and stored (same record-keeping purpose as any other
 * delivery — see SaleDelivery's own costCents comment), they just don't move any money figures.
 *
 * The delivery COST is still booked as a real expense here though (same createDeliveryCostExpenseIfNeeded
 * used at sale/invoice creation time — see expense-service.ts) — dated today rather than backdated to
 * the original sale, since today is when the business actually learns about and records this cost.
 * Silently skipped for an invoice with no payment recorded yet, same as at creation time. */
export function attachDeliveryToSale(saleId: string, input: unknown): SaleDelivery {
  requirePermission("sales", "edit");
  const parsed = deliveryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }

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

    const customer = saleRow.customer_id ? customerRepository.findCustomerRowById(saleRow.customer_id) : undefined;
    createDeliveryCostExpenseIfNeeded({
      tenantId,
      documentNumber: saleRow.invoice_number ?? saleRow.receipt_number,
      customerName: customer?.name ?? null,
      delivery: parsed,
      locationId: saleRow.location_id,
      employeeId,
      paymentMethodId: resolveSalePaymentMethodId(saleRow),
      date: new Date().toISOString()
    });

    return deliveryNoteRepository.mapDeliveryNoteRow(row);
  });
}

/** Same purpose as attachDeliveryToSale but for a quotation that was created without delivery info —
 * mirrors it exactly, including never touching the quotation's own totals. */
export function attachDeliveryToQuotation(quotationId: string, input: unknown): SaleDelivery {
  requirePermission("quotations", "edit");
  const parsed = deliveryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  const quotationRow = quotationRepository.findQuotationRowById(quotationId);
  if (!quotationRow || quotationRow.tenant_id !== tenantId) {
    throw new Error("Quotation not found");
  }
  if (deliveryNoteRepository.findDeliveryNoteRowByQuotationId(quotationId)) {
    throw new Error("This quotation already has a delivery attached");
  }

  return runInTransaction(() => {
    const row = deliveryNoteRepository.insertDeliveryNoteRow({
      tenantId,
      deliveryNoteNumber: generateDeliveryNoteNumber(tenantId),
      saleId: null,
      quotationId,
      riderId: parsed.riderId,
      recipientName: parsed.recipientName,
      country: parsed.country,
      town: parsed.town,
      physicalAddress: parsed.physicalAddress,
      notes: parsed.notes,
      feeCents: parsed.feeCents,
      costCents: parsed.costCents
    });

    // Same reasoning as attachDeliveryToSale's own comment: the delivery_notes INSERT trigger
    // already re-queues the parent quotation for push, but without bumping updated_at here, a
    // receiving device's pull guard would see "no newer timestamp" and silently skip the fresh
    // delivery forever.
    getDatabase().prepare("UPDATE quotations SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), quotationId);

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

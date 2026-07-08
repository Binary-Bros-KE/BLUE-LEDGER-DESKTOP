import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import type { ProductRow } from "@main/database/repositories/product-repository";
import * as quotationRepository from "@main/database/repositories/quotation-repository";
import type { QuotationItemDetailRow } from "@main/database/repositories/quotation-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { insertInvoiceFromCart } from "@main/services/invoice-service";
import {
  getSaleDetail,
  insertCompletedSaleFromCart,
  prepareCart,
  requireActiveSession,
  type PreparedCart,
  type PreparedItem
} from "@main/services/sale-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { computeQuotationStatus } from "@shared/lib/quotation";
import {
  convertToInvoiceSchema,
  convertToSaleSchema,
  quotationCreateSchema,
  quotationUpdateSchema,
  type ConvertToInvoiceInput,
  type ConvertToSaleInput,
  type QuotationCreateInput
} from "@shared/schemas/quotation";
import type {
  Quotation,
  QuotationListItem,
  QuotationStatus,
  QuotationStockCheckItem,
  QuotationSummary
} from "@shared/types/quotation";
import type { Sale } from "@shared/types/sale";

function generateQuotationNumber(tenantId: string): string {
  const maxNumber = quotationRepository.findMaxQuotationNumberRow(tenantId);
  const currentNumber = maxNumber ? Number(maxNumber.slice("QT-".length)) : 0;
  const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 1;
  return `QT-${String(nextNumber).padStart(6, "0")}`;
}

function assertCustomerExists(tenantId: string, customerId: string): void {
  const customer = customerRepository.findCustomerRowById(customerId);
  if (!customer || customer.tenant_id !== tenantId) {
    throw new Error("Customer not found");
  }
}

function getQuotationDetail(id: string): Quotation {
  const row = quotationRepository.findQuotationDetailRowById(id);
  if (!row) {
    throw new Error("Quotation not found");
  }
  const items = quotationRepository.findQuotationItemDetailRows(id).map(quotationRepository.mapQuotationItemDetailRow);
  return quotationRepository.mapQuotationDetailRow(row, items);
}

export function listQuotations(): QuotationListItem[] {
  requirePermission("quotations", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return quotationRepository.findAllQuotationListRows(tenantId, locationId).map(quotationRepository.mapQuotationListRow);
}

export function getQuotationSummary(): QuotationSummary {
  requirePermission("quotations", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  const rows = quotationRepository.findQuotationStatusRows(tenantId, locationId);

  const summary: QuotationSummary = {
    totalQuotations: rows.length,
    draftCount: 0,
    sentCount: 0,
    acceptedCount: 0,
    expiredCount: 0,
    rejectedCount: 0,
    convertedCount: 0
  };

  for (const row of rows) {
    const status = computeQuotationStatus({
      storedStatus: row.status as QuotationStatus,
      validUntil: row.valid_until
    });
    if (status === "draft") summary.draftCount++;
    else if (status === "sent") summary.sentCount++;
    else if (status === "accepted") summary.acceptedCount++;
    else if (status === "expired") summary.expiredCount++;
    else if (status === "rejected") summary.rejectedCount++;
    else if (status === "converted") summary.convertedCount++;
  }

  return summary;
}

export function getQuotation(id: string): Quotation {
  requirePermission("quotations", "view");
  return getQuotationDetail(id);
}

export function createQuotation(input: unknown): Quotation {
  requirePermission("quotations", "create");
  const parsed: QuotationCreateInput = quotationCreateSchema.parse(input);
  const { tenantId, employeeId, locationId } = requireActiveSession();

  assertCustomerExists(tenantId, parsed.customerId);
  const cart = prepareCart(tenantId, parsed.items);
  const quotationId = `quotation_${randomUUID()}`;

  return runInTransaction(() => {
    quotationRepository.insertQuotationRow({
      id: quotationId,
      tenantId,
      quotationNumber: generateQuotationNumber(tenantId),
      customerId: parsed.customerId,
      locationId,
      employeeId,
      subtotalCents: cart.subtotalCents,
      discountAmountCents: cart.discountAmountCents,
      taxAmountCents: cart.taxAmountCents,
      grandTotalCents: cart.grandTotalCents,
      validUntil: parsed.validUntil,
      notes: parsed.notes
    });

    for (const item of cart.items) {
      quotationRepository.insertQuotationItemRow({
        id: `quotation_item_${randomUUID()}`,
        quotationId,
        productId: item.product.id,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountAmountCents: item.discountAmountCents,
        taxAmountCents: item.taxAmountCents,
        lineTotalCents: item.lineTotalCents
      });
    }

    return getQuotationDetail(quotationId);
  });
}

function requireEditableDraft(id: string, tenantId: string): quotationRepository.QuotationRow {
  const row = quotationRepository.findQuotationRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Quotation not found");
  }
  if (row.status !== "draft") {
    throw new Error("Only draft quotations can be edited");
  }
  return row;
}

/** A draft can be freely re-priced from live product data — nothing has been quoted to the customer yet. */
export function updateQuotation(id: string, input: unknown): Quotation {
  requirePermission("quotations", "edit");
  const parsed = quotationUpdateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  requireEditableDraft(id, tenantId);
  assertCustomerExists(tenantId, parsed.customerId);
  const cart = prepareCart(tenantId, parsed.items);

  return runInTransaction(() => {
    quotationRepository.updateQuotationRow(id, {
      customerId: parsed.customerId,
      subtotalCents: cart.subtotalCents,
      discountAmountCents: cart.discountAmountCents,
      taxAmountCents: cart.taxAmountCents,
      grandTotalCents: cart.grandTotalCents,
      validUntil: parsed.validUntil,
      notes: parsed.notes
    });

    quotationRepository.deleteQuotationItemsForQuotationRow(id);
    for (const item of cart.items) {
      quotationRepository.insertQuotationItemRow({
        id: `quotation_item_${randomUUID()}`,
        quotationId: id,
        productId: item.product.id,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountAmountCents: item.discountAmountCents,
        taxAmountCents: item.taxAmountCents,
        lineTotalCents: item.lineTotalCents
      });
    }

    return getQuotationDetail(id);
  });
}

export function deleteQuotation(id: string): { id: string } {
  requirePermission("quotations", "delete");
  const { tenantId } = getCurrentTenant();
  requireEditableDraft(id, tenantId);

  runInTransaction(() => {
    quotationRepository.deleteQuotationItemsForQuotationRow(id);
    quotationRepository.deleteQuotationRow(id);
  });
  return { id };
}

const MANUAL_TARGET_STATUSES = new Set<QuotationStatus>(["draft", "sent", "accepted", "rejected"]);

/** Manual status transitions (Sent/Accepted/Rejected/back-to-Draft). Expired is date-computed and
 * Converted only happens via the convert actions — neither is a valid target here. */
export function setQuotationStatus(id: string, status: QuotationStatus): Quotation {
  requirePermission("quotations", "edit");
  if (!MANUAL_TARGET_STATUSES.has(status)) {
    throw new Error(`Status "${status}" can't be set manually`);
  }

  const { tenantId } = getCurrentTenant();
  const row = quotationRepository.findQuotationRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Quotation not found");
  }
  if (row.status === "converted") {
    throw new Error("This quotation has already been converted and can't change status");
  }

  quotationRepository.updateQuotationStatusRow(id, status);
  return getQuotationDetail(id);
}

/** Live stock at the quotation's own storefront for each line — lets the UI warn before conversion. */
export function checkQuotationStock(id: string): QuotationStockCheckItem[] {
  requirePermission("quotations", "view");
  const quotation = getQuotationDetail(id);

  return quotation.items.map((item) => {
    const inventoryRow = inventoryRepository.findInventoryRow(item.productId, quotation.locationId);
    const availableQuantity = inventoryRow?.quantity ?? 0;
    return {
      productId: item.productId,
      productName: item.productName,
      requestedQuantity: item.quantity,
      availableQuantity,
      sufficient: availableQuantity >= item.quantity
    };
  });
}

/** Re-derives a line's discount/tax/total for an overridden (reduced) quantity, keeping the frozen
 * unit price but scaling the discount proportionally and recomputing tax off the product's current rate. */
function repriceLineForQuantity(item: QuotationItemDetailRow, product: ProductRow, quantity: number): PreparedItem {
  const unitPriceCents = item.unit_price_cents;
  const lineSubtotalCents = unitPriceCents * quantity;
  const originalSubtotalCents = item.unit_price_cents * item.quantity;
  const discountRatio = originalSubtotalCents > 0 ? item.discount_amount_cents / originalSubtotalCents : 0;
  const discountAmountCents = Math.min(Math.round(lineSubtotalCents * discountRatio), lineSubtotalCents);
  const taxableCents = lineSubtotalCents - discountAmountCents;
  const taxAmountCents = Math.round(taxableCents * (product.tax_rate / 100));

  return {
    product,
    quantity,
    unitPriceCents,
    discountAmountCents,
    taxAmountCents,
    lineTotalCents: taxableCents + taxAmountCents
  };
}

/** Builds the conversion cart from the quotation's frozen line items, verifying each product still
 * exists and applying any quantity overrides the user made after a stock-check warning. */
function buildConversionCart(
  quotationId: string,
  tenantId: string,
  quantityOverrides: Array<{ productId: string; quantity: number }>
): PreparedCart {
  const items = quotationRepository.findQuotationItemDetailRows(quotationId);
  const overrideByProduct = new Map(quantityOverrides.map((entry) => [entry.productId, entry.quantity]));

  const preparedItems: PreparedItem[] = items.map((item) => {
    const product = productRepository.findProductRowById(item.product_id);
    if (!product || product.tenant_id !== tenantId) {
      throw new Error(`"${item.product_name}" is no longer available and can't be converted`);
    }
    if (product.status !== "active") {
      throw new Error(`"${product.name}" is not active and can't be sold`);
    }

    const override = overrideByProduct.get(item.product_id);
    if (override !== undefined && override !== item.quantity) {
      return repriceLineForQuantity(item, product, override);
    }

    return {
      product,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      discountAmountCents: item.discount_amount_cents,
      taxAmountCents: item.tax_amount_cents,
      lineTotalCents: item.line_total_cents
    };
  });

  let subtotalCents = 0;
  let discountAmountCents = 0;
  let taxAmountCents = 0;
  for (const item of preparedItems) {
    subtotalCents += item.unitPriceCents * item.quantity;
    discountAmountCents += item.discountAmountCents;
    taxAmountCents += item.taxAmountCents;
  }

  return {
    items: preparedItems,
    subtotalCents,
    discountAmountCents,
    taxAmountCents,
    grandTotalCents: subtotalCents - discountAmountCents + taxAmountCents
  };
}

function requireAcceptedQuotationAtActiveBranch(id: string): {
  quotation: Quotation;
  tenantId: string;
  employeeId: string;
  locationId: string;
} {
  const { tenantId, employeeId, locationId } = requireActiveSession();
  const quotation = getQuotationDetail(id);

  if (quotation.status === "converted") {
    throw new Error("This quotation has already been converted");
  }
  if (quotation.status !== "accepted") {
    throw new Error("Only accepted quotations can be converted");
  }
  if (quotation.locationId !== locationId) {
    throw new Error("This quotation belongs to a different storefront");
  }

  return { quotation, tenantId, employeeId, locationId };
}

/** Converts an accepted quotation into a completed retail sale, preserving its quoted prices while
 * re-validating stock fresh. The quotation itself is never touched inventory-wise — only the new sale is. */
export function convertQuotationToSale(id: string, input: unknown): Sale {
  requirePermission("quotations", "edit");
  requirePermission("sales", "create");
  const parsed: ConvertToSaleInput = convertToSaleSchema.parse(input);
  const { quotation, tenantId, employeeId, locationId } = requireAcceptedQuotationAtActiveBranch(id);

  const cart = buildConversionCart(quotation.id, tenantId, parsed.quantityOverrides);

  const sale = insertCompletedSaleFromCart({
    tenantId,
    employeeId,
    locationId,
    customerId: quotation.customerId,
    cart,
    paymentMethodId: parsed.paymentMethodId,
    paymentReference: parsed.paymentReference,
    amountReceivedCents: parsed.amountReceivedCents,
    notes: quotation.notes
  });

  quotationRepository.markQuotationConvertedRow(quotation.id, sale.id);
  return sale;
}

/** Converts an accepted quotation into an invoice (credit sale), preserving its quoted prices while
 * re-validating stock fresh. The quotation itself is never touched inventory-wise — only the new invoice is. */
export function convertQuotationToInvoice(id: string, input: unknown): Sale {
  requirePermission("quotations", "edit");
  requirePermission("sales", "create");
  const parsed: ConvertToInvoiceInput = convertToInvoiceSchema.parse(input);
  const { quotation, tenantId, employeeId, locationId } = requireAcceptedQuotationAtActiveBranch(id);

  const cart = buildConversionCart(quotation.id, tenantId, parsed.quantityOverrides);

  const saleId = insertInvoiceFromCart({
    tenantId,
    employeeId,
    locationId,
    customerId: quotation.customerId,
    transactionType: "invoice",
    dueDate: parsed.dueDate,
    invoiceNotes: quotation.notes,
    cart,
    initialPayment: null
  });

  quotationRepository.markQuotationConvertedRow(quotation.id, saleId);
  return getSaleDetail(saleId);
}

import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import type { ProductRow } from "@main/database/repositories/product-repository";
import * as quotationRepository from "@main/database/repositories/quotation-repository";
import type { QuotationItemDetailRow } from "@main/database/repositories/quotation-repository";
import * as serviceChargeRepository from "@main/database/repositories/service-charge-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { insertInvoiceFromCart } from "@main/services/invoice-service";
import {
  getSaleDetail,
  insertCompletedSaleFromCart,
  persistCartExtras,
  prepareCart,
  requireActiveSession,
  type PreparedCart,
  type PreparedItem
} from "@main/services/sale-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { computeQuotationStatus } from "@shared/lib/quotation";
import { computeLineTax, resolveProductTaxConfig } from "@shared/lib/tax-calculation";
import type { ProductTaxType } from "@shared/types/product";
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
  return generateDocumentNumber({
    tenantId,
    prefix: "QT",
    digits: 6,
    existingNumbers: quotationRepository.findMaxQuotationNumberRow(tenantId)
  });
}

/** No-op for a walk-in quotation (customerId null) — see Quotation["customerId"]'s own doc comment
 * for why that's a valid, intentional state here. */
function assertCustomerExists(tenantId: string, customerId: string | null): void {
  if (!customerId) return;
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
  const serviceCharges = serviceChargeRepository
    .findServiceChargeRowsForQuotation(id)
    .map(serviceChargeRepository.mapServiceChargeRow);
  const deliveryRow = deliveryNoteRepository.findDeliveryNoteRowByQuotationId(id);
  const delivery = deliveryRow ? deliveryNoteRepository.mapDeliveryNoteRow(deliveryRow) : null;
  return quotationRepository.mapQuotationDetailRow(row, items, serviceCharges, delivery);
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
  const { tenantId, employeeId, locationId } = requireActiveSession(parsed.locationId);

  assertCustomerExists(tenantId, parsed.customerId);
  const cart = prepareCart(tenantId, parsed.items, {
    serviceCharges: parsed.serviceCharges,
    delivery: parsed.delivery
  });
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
      notes: parsed.notes,
      includeTaxBreakdown: parsed.includeTaxBreakdown,
      includeBusinessInfo: parsed.includeBusinessInfo
    });

    for (const item of cart.items) {
      quotationRepository.insertQuotationItemRow({
        id: `quotation_item_${randomUUID()}`,
        quotationId,
        productId: item.product.id,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountAmountCents: item.discountAmountCents,
        taxType: item.taxType,
        taxAmountCents: item.taxAmountCents,
        lineTotalCents: item.lineTotalCents,
        isLocallySourced: item.isLocallySourced,
        localCostCents: item.localCostCents,
        localSupplierId: item.localSupplierId
      });
    }

    persistCartExtras(tenantId, { quotationId }, cart);

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
  const cart = prepareCart(tenantId, parsed.items, {
    serviceCharges: parsed.serviceCharges,
    delivery: parsed.delivery
  });

  return runInTransaction(() => {
    quotationRepository.updateQuotationRow(id, {
      customerId: parsed.customerId,
      subtotalCents: cart.subtotalCents,
      discountAmountCents: cart.discountAmountCents,
      taxAmountCents: cart.taxAmountCents,
      grandTotalCents: cart.grandTotalCents,
      validUntil: parsed.validUntil,
      notes: parsed.notes,
      includeTaxBreakdown: parsed.includeTaxBreakdown,
      includeBusinessInfo: parsed.includeBusinessInfo
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
        taxType: item.taxType,
        taxAmountCents: item.taxAmountCents,
        lineTotalCents: item.lineTotalCents,
        isLocallySourced: item.isLocallySourced,
        localCostCents: item.localCostCents,
        localSupplierId: item.localSupplierId
      });
    }

    serviceChargeRepository.deleteServiceChargesForQuotationRow(id);
    deliveryNoteRepository.deleteDeliveryNoteForQuotationRow(id);
    persistCartExtras(tenantId, { quotationId: id }, cart);

    return getQuotationDetail(id);
  });
}

export function deleteQuotation(id: string): { id: string } {
  requirePermission("quotations", "delete");
  const { tenantId } = getCurrentTenant();
  const row = requireEditableDraft(id, tenantId);
  // Cloud sync has no delete propagation — a quotation already synced would leave a stale copy on
  // the cloud/other devices forever if hard-deleted here. A draft is rarely synced in practice
  // (nothing pushes it until it's touched again), but if it has been, this stops it rather than
  // silently orphaning the cloud copy.
  if (row.sync_status !== "pending") {
    throw new Error("This quotation has already synced to the cloud and can't be deleted — reject it instead.");
  }

  runInTransaction(() => {
    serviceChargeRepository.deleteServiceChargesForQuotationRow(id);
    deliveryNoteRepository.deleteDeliveryNoteForQuotationRow(id);
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

/** Toggles the "Tax Breakdown" section on/off for an already-created quotation — the "toggle even
 * after creation" half of this feature. Works regardless of status (draft/sent/accepted/converted),
 * unlike editing the quotation's own line items which is draft-only. */
export function setQuotationIncludeTaxBreakdown(id: string, includeTaxBreakdown: boolean): Quotation {
  requirePermission("quotations", "edit");
  const { tenantId } = getCurrentTenant();
  const row = quotationRepository.findQuotationRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Quotation not found");
  }
  quotationRepository.updateQuotationIncludeTaxBreakdownRow(id, includeTaxBreakdown);
  return getQuotationDetail(id);
}

/** Same as setQuotationIncludeTaxBreakdown above, for the independent "Include storefront
 * information" toggle — see Sale["includeBusinessInfo"]'s own doc comment. */
export function setQuotationIncludeBusinessInfo(id: string, includeBusinessInfo: boolean): Quotation {
  requirePermission("quotations", "edit");
  const { tenantId } = getCurrentTenant();
  const row = quotationRepository.findQuotationRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Quotation not found");
  }
  quotationRepository.updateQuotationIncludeBusinessInfoRow(id, includeBusinessInfo);
  return getQuotationDetail(id);
}

/** Live stock at the quotation's own storefront for each line — lets the UI warn before conversion. */
export function checkQuotationStock(id: string): QuotationStockCheckItem[] {
  requirePermission("quotations", "view");
  const quotation = getQuotationDetail(id);

  // A locally-sourced line never touched (and never will touch) this shop's own inventory — see
  // insertCompletedSaleFromCart's own stock-movement skip for the same condition — so checking its
  // availability here would show a misleading "insufficient stock" for a product this shop may not
  // even stock at all.
  return quotation.items
    .filter((item) => !item.isLocallySourced)
    .map((item) => {
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
 * unit price but scaling the discount proportionally and recomputing tax off the product's current
 * category/rate (deliberately not the quotation's own frozen tax_type snapshot — an overridden
 * quantity is treated as a fresh re-price, same as the discount ratio scaling above it). Tax mode
 * (inclusive/exclusive) is resolved from the product's own CURRENT setting too, same reasoning.
 * lineTotalCents is computeLineTax's grossCents — see tax-calculation.ts for why this differs from
 * the taxable amount when exclusive. */
function repriceLineForQuantity(item: QuotationItemDetailRow, product: ProductRow, quantity: number): PreparedItem {
  const unitPriceCents = item.unit_price_cents;
  const lineSubtotalCents = unitPriceCents * quantity;
  const originalSubtotalCents = item.unit_price_cents * item.quantity;
  const discountRatio = originalSubtotalCents > 0 ? item.discount_amount_cents / originalSubtotalCents : 0;
  const discountAmountCents = Math.min(Math.round(lineSubtotalCents * discountRatio), lineSubtotalCents);
  const taxableCents = lineSubtotalCents - discountAmountCents;
  const taxType = product.tax_type as ProductTaxType;
  const productTaxConfig = resolveProductTaxConfig(
    { pricesTaxInclusive: product.prices_tax_inclusive === null ? null : Boolean(product.prices_tax_inclusive) },
    getCurrentTenant()
  );
  // A stock-check quantity trim shouldn't silently discard a per-line VAT-mode override the
  // quotation was created with — derive whether the ORIGINAL frozen line was inclusive/exclusive
  // (same technique as computeTaxBreakdown, tax-calculation.ts) and carry that mode forward rather
  // than falling back to the product's current default, mirroring every other field this function
  // already carries over unchanged (isLocallySourced/localCostCents/localSupplierId below).
  const originalTaxableCents = item.unit_price_cents * item.quantity - item.discount_amount_cents;
  const originalWasInclusive = item.tax_type === "vat" ? item.line_total_cents <= originalTaxableCents : null;
  const effectiveTaxConfig =
    originalWasInclusive === null ? productTaxConfig : { ...productTaxConfig, pricesTaxInclusive: originalWasInclusive };
  const { grossCents, taxCents: taxAmountCents } = computeLineTax(taxableCents, taxType, effectiveTaxConfig);

  return {
    product,
    quantity,
    unitPriceCents,
    discountAmountCents,
    taxType,
    taxAmountCents,
    lineTotalCents: grossCents,
    // Carried over unchanged even though quantity was re-priced above — localCostCents is a flat
    // "what we paid for this batch" figure the cashier typed once, not a per-unit rate, so there's
    // no proportional amount to recompute here.
    isLocallySourced: Boolean(item.is_locally_sourced),
    localCostCents: item.local_cost_cents,
    localSupplierId: item.local_supplier_id
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
      taxType: item.tax_type as ProductTaxType,
      taxAmountCents: item.tax_amount_cents,
      lineTotalCents: item.line_total_cents,
      isLocallySourced: Boolean(item.is_locally_sourced),
      localCostCents: item.local_cost_cents,
      localSupplierId: item.local_supplier_id
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

  // The quotation's own service charges/delivery carry straight into the resulting sale/invoice —
  // this IS the entire conversion carry-over mechanism. persistCartExtras() (called by
  // insertCompletedSaleFromCart/insertInvoiceFromCart below) inserts fresh rows against the new
  // sale_id from whatever this cart carries, generating a new delivery note number in the process.
  const serviceCharges = serviceChargeRepository
    .findServiceChargeRowsForQuotation(quotationId)
    .map(serviceChargeRepository.mapServiceChargeRow);
  const deliveryRow = deliveryNoteRepository.findDeliveryNoteRowByQuotationId(quotationId);
  const delivery = deliveryRow ? deliveryNoteRepository.mapDeliveryNoteRow(deliveryRow) : null;
  const extraFeesCents = serviceCharges.reduce((sum, charge) => sum + charge.feeCents, 0) + (delivery?.feeCents ?? 0);

  // Sums each line's own grossCents rather than branching off one global toggle — mirrors
  // prepareCart's own grandTotalCents formula in sale-service.ts (see its comment), since a
  // quotation's lines can mix inclusive and exclusive products via their own overrides.
  const grandTotalCents = preparedItems.reduce((sum, item) => sum + item.lineTotalCents, 0) + extraFeesCents;

  return {
    items: preparedItems,
    subtotalCents,
    discountAmountCents,
    taxAmountCents,
    grandTotalCents,
    serviceCharges,
    delivery
  };
}

/** No storefront prompt needed even for a no-branch (Super Admin) session — a quotation already
 * belongs to a fixed storefront, so conversion auto-uses that one instead of asking again. Someone
 * WITH an assigned branch still can't convert another storefront's quotation (the check below is
 * unchanged) — this only helps the no-branch case skip a redundant pick. */
function requireAcceptedQuotationAtActiveBranch(id: string): {
  quotation: Quotation;
  tenantId: string;
  employeeId: string;
  locationId: string;
} {
  const quotation = getQuotationDetail(id);
  const { tenantId, employeeId, locationId } = requireActiveSession(quotation.locationId);

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
    // A quotation always has a real customer (required at creation) — never a walk-in.
    walkInName: null,
    cart,
    paymentMethodId: parsed.paymentMethodId,
    paymentReference: parsed.paymentReference,
    amountReceivedCents: parsed.amountReceivedCents,
    notes: quotation.notes,
    // Carried over, not re-decided — converting shouldn't silently reset the customer's chosen
    // presentation for what is, from their side, the same document going final.
    includeTaxBreakdown: quotation.includeTaxBreakdown,
    includeBusinessInfo: quotation.includeBusinessInfo
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

  // Unlike converting to a sale/receipt (walk-in is completely normal there), an invoice is a credit
  // document — the software needs someone real to bill and track a balance against. A walk-in
  // quotation converting to a walk-in invoice would create exactly the "who do we collect this from"
  // problem the Checkout-style Walk-in Customer option was deliberately kept OUT of invoice creation
  // to avoid (see Quotation["customerId"]'s own doc comment). Caught here, not left to whatever
  // insertInvoiceFromCart/the local NOT NULL-less-but-still-required-by-convention field would do.
  if (!quotation.customerId) {
    throw new Error("This quotation has no customer — pick a customer before converting it to an invoice.");
  }

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
    initialPayment: null,
    includeTaxBreakdown: quotation.includeTaxBreakdown,
    includeBusinessInfo: quotation.includeBusinessInfo
  });

  quotationRepository.markQuotationConvertedRow(quotation.id, saleId);
  return getSaleDetail(saleId);
}

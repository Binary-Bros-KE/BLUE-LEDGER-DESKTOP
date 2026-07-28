import { randomUUID } from "node:crypto";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import * as serviceChargeRepository from "@main/database/repositories/service-charge-repository";
import { runInTransaction } from "@main/database/connection";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { getCurrentBranchScope, getSession, requirePermission } from "@main/services/auth-service";
import { generateDeliveryNoteNumber } from "@main/services/delivery-note-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import type { DeliveryInput, ServiceChargeInput } from "@shared/schemas/charges";
import {
  checkoutInputSchema,
  saleCartInputSchema,
  type CheckoutInput,
  type SaleCartInput
} from "@shared/schemas/sale";
import { isStorefrontType, type LocationType } from "@shared/types/location";
import type { PendingSaleListItem, Sale, SaleListItem } from "@shared/types/sale";
import type { ProductRow } from "@main/database/repositories/product-repository";

export type PreparedItem = {
  product: ProductRow;
  quantity: number;
  unitPriceCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  lineTotalCents: number;
};

export type PreparedCartExtras = {
  serviceCharges: ServiceChargeInput[];
  delivery: DeliveryInput | null;
};

export type PreparedCart = {
  items: PreparedItem[];
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  /** Includes serviceCharges/delivery fees folded in — see prepareCart. */
  grandTotalCents: number;
  serviceCharges: ServiceChargeInput[];
  delivery: DeliveryInput | null;
};

/**
 * The employee/branch the POS screen always acts as. For anyone WITH an assigned branch (the
 * normal case), that branch is authoritative and `explicitLocationId` is never even looked at —
 * never taken from renderer input, exactly as before.
 *
 * Someone with no assigned branch (typically Super Admin) has no such default, so they used to be
 * flatly blocked from making sales/invoices/quotations at all — forcing a full logout/login as a
 * branch-assigned user just to record one transaction. Real user feedback: "annoying." Now, for
 * that case only, the caller must supply which storefront to act as (the renderer shows a picker —
 * see StorefrontPicker.tsx — only when the signed-in session itself has no branch); validated here
 * to be a real, active, genuine storefront (not the Main Store/warehouse, which nothing is ever
 * directly sold from).
 */
export function requireActiveSession(explicitLocationId?: string | null): { tenantId: string; employeeId: string; locationId: string } {
  const session = getSession();
  if (!session) {
    throw new Error("You must be signed in to use the POS");
  }
  const { tenantId } = getCurrentTenant();

  if (session.branch) {
    return { tenantId, employeeId: session.employee.id, locationId: session.branch.id };
  }

  if (!explicitLocationId) {
    throw new Error("Choose a storefront first — your account has no branch assigned.");
  }
  const location = locationRepository.findLocationRowById(explicitLocationId);
  if (!location || location.tenant_id !== tenantId) {
    throw new Error("Selected storefront not found");
  }
  if (!isStorefrontType(location.location_type as LocationType)) {
    throw new Error(`"${location.location_name}" isn't a storefront`);
  }
  if (location.status !== "active") {
    throw new Error(`"${location.location_name}" is not active`);
  }
  return { tenantId, employeeId: session.employee.id, locationId: location.id };
}

function assertCustomerExists(tenantId: string, customerId: string | null): void {
  if (!customerId) return;
  const customer = customerRepository.findCustomerRowById(customerId);
  if (!customer || customer.tenant_id !== tenantId) {
    throw new Error("Customer not found");
  }
}

/** Prices and taxes every cart line from live product data — never trusts client-supplied money math.
 * extras (service charges + delivery) are optional so callers that never touch them (e.g. quotation
 * updateQuotation before this feature existed) don't need changes; their fees are folded straight
 * into grandTotalCents, while subtotal/discount/tax stay pure product math. */
export function prepareCart(
  tenantId: string,
  items: SaleCartInput["items"],
  extras?: PreparedCartExtras
): PreparedCart {
  let subtotalCents = 0;
  let discountAmountCents = 0;
  let taxAmountCents = 0;

  const preparedItems = items.map((item) => {
    const product = productRepository.findProductRowById(item.productId);
    if (!product || product.tenant_id !== tenantId) {
      throw new Error("One of the products in the cart could not be found");
    }
    if (product.status !== "active") {
      throw new Error(`"${product.name}" is not active and can't be sold`);
    }

    const useWholesale =
      product.wholesale_price_cents !== null &&
      product.wholesale_min_quantity > 0 &&
      item.quantity >= product.wholesale_min_quantity;
    const unitPriceCents = useWholesale
      ? (product.wholesale_price_cents as number)
      : product.selling_price_cents;

    const lineSubtotalCents = unitPriceCents * item.quantity;
    if (item.discountAmountCents > lineSubtotalCents) {
      throw new Error(`Discount for "${product.name}" can't exceed its subtotal`);
    }
    const minLineSubtotalCents =
      product.minimum_price_cents !== null ? product.minimum_price_cents * item.quantity : 0;
    if (lineSubtotalCents - item.discountAmountCents < minLineSubtotalCents) {
      throw new Error(`Discount for "${product.name}" would drop it below its minimum price`);
    }

    const taxableCents = lineSubtotalCents - item.discountAmountCents;
    const lineTaxCents = Math.round(taxableCents * (product.tax_rate / 100));
    const lineTotalCents = taxableCents + lineTaxCents;

    subtotalCents += lineSubtotalCents;
    discountAmountCents += item.discountAmountCents;
    taxAmountCents += lineTaxCents;

    return {
      product,
      quantity: item.quantity,
      unitPriceCents,
      discountAmountCents: item.discountAmountCents,
      taxAmountCents: lineTaxCents,
      lineTotalCents
    };
  });

  const serviceCharges = extras?.serviceCharges ?? [];
  const delivery = extras?.delivery ?? null;
  const extraFeesCents =
    serviceCharges.reduce((sum, charge) => sum + charge.feeCents, 0) + (delivery?.feeCents ?? 0);

  return {
    items: preparedItems,
    subtotalCents,
    discountAmountCents,
    taxAmountCents,
    grandTotalCents: subtotalCents - discountAmountCents + taxAmountCents + extraFeesCents,
    serviceCharges,
    delivery
  };
}

/** Persists a cart's service charges + delivery (if any) against a sale or quotation — shared by every
 * cart-insertion site (checkout, suspend, invoice, quotation-create) so charge persistence can never
 * drift between them the way buildConversionCart's duplicated totals math once could have. Exactly
 * one of saleId/quotationId is provided, matching the sale_service_charges/delivery_notes CHECK
 * constraint. */
export function persistCartExtras(
  tenantId: string,
  target: { saleId: string; quotationId?: undefined } | { saleId?: undefined; quotationId: string },
  cart: PreparedCart
): void {
  const saleId = target.saleId ?? null;
  const quotationId = target.quotationId ?? null;

  for (const charge of cart.serviceCharges) {
    serviceChargeRepository.insertServiceChargeRow({
      tenantId,
      saleId,
      quotationId,
      name: charge.name,
      feeCents: charge.feeCents,
      costCents: charge.costCents
    });
  }

  if (cart.delivery) {
    deliveryNoteRepository.insertDeliveryNoteRow({
      tenantId,
      deliveryNoteNumber: generateDeliveryNoteNumber(tenantId),
      saleId,
      quotationId,
      riderId: cart.delivery.riderId,
      recipientName: cart.delivery.recipientName,
      country: cart.delivery.country,
      town: cart.delivery.town,
      physicalAddress: cart.delivery.physicalAddress,
      notes: cart.delivery.notes,
      feeCents: cart.delivery.feeCents,
      costCents: cart.delivery.costCents
    });
  }
}

/** Removes a held sale being replaced — either resumed-then-resuspended, or resumed-then-completed. */
function discardResumedSale(tenantId: string, resumeSaleId: string | null | undefined): void {
  if (!resumeSaleId) return;
  const pending = saleRepository.findSaleRowById(resumeSaleId);
  if (pending && pending.tenant_id === tenantId && pending.sale_status === "pending") {
    serviceChargeRepository.deleteServiceChargesForSaleRow(pending.id);
    deliveryNoteRepository.deleteDeliveryNoteForSaleRow(pending.id);
    saleRepository.deleteSaleItemsForSaleRow(pending.id);
    saleRepository.deleteSaleRow(pending.id);
  }
}

function generateReceiptNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "BL",
    digits: 7,
    existingNumbers: saleRepository.findMaxReceiptNumberRow(tenantId)
  });
}

export function getSaleDetail(id: string): Sale {
  const row = saleRepository.findSaleDetailRowById(id);
  if (!row) {
    throw new Error("Sale not found");
  }
  const items = saleRepository.findSaleItemDetailRows(id).map(saleRepository.mapSaleItemDetailRow);
  const serviceCharges = serviceChargeRepository
    .findServiceChargeRowsForSale(id)
    .map(serviceChargeRepository.mapServiceChargeRow);
  const deliveryRow = deliveryNoteRepository.findDeliveryNoteRowBySaleId(id);
  const delivery = deliveryRow ? deliveryNoteRepository.mapDeliveryNoteRow(deliveryRow) : null;
  return saleRepository.mapSaleDetailRow(row, items, serviceCharges, delivery);
}

export function listPendingSales(): PendingSaleListItem[] {
  requirePermission("sales", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return saleRepository
    .findPendingSaleListRows(tenantId, locationId)
    .map(saleRepository.mapPendingSaleListRow);
}

export function getSale(id: string): Sale {
  requirePermission("sales", "view");
  return getSaleDetail(id);
}

/** Completed POS sales for the Receipts screen, latest first — invoices live on the Invoices screen instead. */
export function listSales(): SaleListItem[] {
  requirePermission("sales", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return saleRepository.findAllSaleSummaryRows(tenantId, locationId).map(saleRepository.mapSaleSummaryRow);
}

/** Holds the current cart for later — no inventory impact, since nothing has been sold yet. */
export function suspendSale(input: unknown): { id: string } {
  requirePermission("sales", "create");
  const parsed = saleCartInputSchema.parse(input);
  const { tenantId, employeeId, locationId } = requireActiveSession(parsed.locationId);

  assertCustomerExists(tenantId, parsed.customerId);
  const cart = prepareCart(tenantId, parsed.items, {
    serviceCharges: parsed.serviceCharges,
    delivery: parsed.delivery
  });

  return runInTransaction(() => {
    discardResumedSale(tenantId, parsed.resumeSaleId);

    const saleId = `sale_${randomUUID()}`;
    saleRepository.insertSaleRow({
      id: saleId,
      tenantId,
      receiptNumber: null,
      locationId,
      employeeId,
      customerId: parsed.customerId,
      saleStatus: "pending",
      subtotalCents: cart.subtotalCents,
      discountAmountCents: cart.discountAmountCents,
      taxAmountCents: cart.taxAmountCents,
      grandTotalCents: cart.grandTotalCents,
      paymentMethodId: null,
      paymentReference: null,
      amountReceivedCents: null,
      changeGivenCents: null,
      notes: parsed.notes,
      completedAt: null
    });

    for (const item of cart.items) {
      saleRepository.insertSaleItemRow({
        id: `sale_item_${randomUUID()}`,
        saleId,
        productId: item.product.id,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountAmountCents: item.discountAmountCents,
        taxAmountCents: item.taxAmountCents,
        lineTotalCents: item.lineTotalCents
      });
    }

    persistCartExtras(tenantId, { saleId }, cart);

    return { id: saleId };
  });
}

export function deletePendingSale(id: string): { id: string } {
  requirePermission("sales", "delete");
  const { tenantId } = getCurrentTenant();
  const row = saleRepository.findSaleRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Sale not found");
  }
  if (row.sale_status !== "pending") {
    throw new Error("Only pending sales can be deleted");
  }
  // Cloud sync has no delete propagation — a held sale already synced would leave a stale copy on
  // the cloud/other devices forever if hard-deleted here. A pending (held) sale is rarely synced
  // in practice, but if it has been, this stops it rather than silently orphaning the cloud copy.
  if (row.sync_status !== "pending") {
    throw new Error("This held sale has already synced to the cloud and can't be deleted.");
  }

  runInTransaction(() => {
    serviceChargeRepository.deleteServiceChargesForSaleRow(id);
    deliveryNoteRepository.deleteDeliveryNoteForSaleRow(id);
    saleRepository.deleteSaleItemsForSaleRow(id);
    saleRepository.deleteSaleRow(id);
  });
  return { id };
}

/**
 * Inserts a completed sale from an already-priced cart — shared by checkout (which prices the cart
 * itself from live product data) and quotation conversion (which carries over the quotation's frozen
 * prices instead of re-quoting). Always re-validates stock at insert time via applyValidatedStockMovement,
 * regardless of where the cart's prices came from.
 */
export function insertCompletedSaleFromCart(input: {
  tenantId: string;
  employeeId: string;
  locationId: string;
  customerId: string | null;
  cart: PreparedCart;
  paymentMethodId: string;
  paymentReference: string | null;
  amountReceivedCents: number | null;
  notes: string | null;
  resumeSaleId?: string | null;
}): Sale {
  const { tenantId, employeeId, locationId, cart } = input;

  if (input.amountReceivedCents !== null && input.amountReceivedCents < cart.grandTotalCents) {
    throw new Error("Amount received is less than the total due");
  }
  const changeGivenCents =
    input.amountReceivedCents !== null ? input.amountReceivedCents - cart.grandTotalCents : null;

  const saleId = `sale_${randomUUID()}`;

  return runInTransaction(() => {
    discardResumedSale(tenantId, input.resumeSaleId ?? null);

    const receiptNumber = generateReceiptNumber(tenantId);
    const now = new Date().toISOString();

    saleRepository.insertSaleRow({
      id: saleId,
      tenantId,
      receiptNumber,
      locationId,
      employeeId,
      customerId: input.customerId,
      saleStatus: "completed",
      subtotalCents: cart.subtotalCents,
      discountAmountCents: cart.discountAmountCents,
      taxAmountCents: cart.taxAmountCents,
      grandTotalCents: cart.grandTotalCents,
      paymentMethodId: input.paymentMethodId,
      paymentReference: input.paymentReference,
      amountReceivedCents: input.amountReceivedCents,
      changeGivenCents,
      notes: input.notes,
      completedAt: now
    });

    for (const item of cart.items) {
      saleRepository.insertSaleItemRow({
        id: `sale_item_${randomUUID()}`,
        saleId,
        productId: item.product.id,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        discountAmountCents: item.discountAmountCents,
        taxAmountCents: item.taxAmountCents,
        lineTotalCents: item.lineTotalCents
      });

      if (item.product.track_stock) {
        applyValidatedStockMovement(
          {
            productId: item.product.id,
            locationId,
            movementType: "sale",
            quantityChange: -item.quantity,
            referenceType: "sale",
            referenceId: saleId,
            performedBy: employeeId,
            notes: null
          },
          tenantId
        );
      }
    }

    persistCartExtras(tenantId, { saleId }, cart);

    return getSaleDetail(saleId);
  });
}

/**
 * Completes checkout: validates stock/payment/totals, then atomically creates the sale + items,
 * writes stock movements, and updates inventory balances. Everything happens in one transaction —
 * either the whole sale goes through, or none of it does.
 */
export function completeSale(input: unknown): Sale {
  requirePermission("sales", "create");
  const parsed: CheckoutInput = checkoutInputSchema.parse(input);
  const { tenantId, employeeId, locationId } = requireActiveSession(parsed.locationId);

  const paymentMethod = paymentMethodRepository.findPaymentMethodRowById(parsed.paymentMethodId);
  if (!paymentMethod || paymentMethod.tenant_id !== tenantId) {
    throw new Error("Payment method not found");
  }
  if (!paymentMethod.is_active) {
    throw new Error(`"${paymentMethod.name}" is not active`);
  }
  if (paymentMethod.requires_reference && !parsed.paymentReference) {
    throw new Error(`${paymentMethod.name} requires a reference number`);
  }

  assertCustomerExists(tenantId, parsed.customerId);
  const cart = prepareCart(tenantId, parsed.items, {
    serviceCharges: parsed.serviceCharges,
    delivery: parsed.delivery
  });

  return insertCompletedSaleFromCart({
    tenantId,
    employeeId,
    locationId,
    customerId: parsed.customerId,
    cart,
    paymentMethodId: parsed.paymentMethodId,
    paymentReference: parsed.paymentReference,
    amountReceivedCents: parsed.amountReceivedCents,
    notes: parsed.notes,
    resumeSaleId: parsed.resumeSaleId
  });
}

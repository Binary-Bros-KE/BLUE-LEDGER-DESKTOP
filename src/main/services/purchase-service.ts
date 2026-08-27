import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as inventoryRepository from "@main/database/repositories/inventory-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as purchaseRepository from "@main/database/repositories/purchase-repository";
import type { PurchaseRow } from "@main/database/repositories/purchase-repository";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, getSession, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { deleteManagedPurchaseAttachment } from "@main/services/image-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { computePurchasePaymentStatus, computePurchaseReceivingStatus } from "@shared/lib/purchase";
import {
  markPurchasePaidSchema,
  purchaseCreateSchema,
  purchaseUpdateSchema,
  receiveGoodsSchema,
  recordPurchasePaymentSchema,
  type PurchaseCreateInput,
  type PurchaseItemInput,
  type PurchaseUpdateInput
} from "@shared/schemas/purchase";
import { computeLineTax, resolveProductTaxConfig } from "@shared/lib/tax-calculation";
import type { ProductTaxType } from "@shared/types/product";
import type {
  Purchase,
  PurchaseListItem,
  PurchasePayment,
  PurchaseReceivingEvent,
  PurchaseReceivingEventItem,
  PurchaseStatus,
  PurchaseSummary
} from "@shared/types/purchase";

/** No longer a client-supplied value (see purchaseCreateSchema) — Purchase.taxType is now a
 * legacy, unused-going-forward column, kept only so historical POs created before tax became
 * per-line still have SOMETHING on record. Every new purchase just writes this fixed placeholder. */
const LEGACY_PURCHASE_TAX_TYPE = "no_vat";

type PreparedPurchaseItem = {
  productId: string;
  orderedQuantity: number;
  unitCostCents: number;
  sellingPriceCents: number | null;
  discountAmountCents: number;
  taxType: ProductTaxType;
  taxAmountCents: number;
  lineTotalCents: number;
};

type PreparedPurchaseCart = {
  items: PreparedPurchaseItem[];
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  shippingCostCents: number;
  grandTotalCents: number;
};

function generatePurchaseNumber(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "PO",
    digits: 6,
    existingNumbers: purchaseRepository.findMaxPurchaseNumberRow(tenantId)
  });
}

function assertSupplierExists(tenantId: string, supplierId: string): void {
  const row = supplierRepository.findSupplierRowById(supplierId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Supplier not found");
  }
}

function assertLocationBelongsToTenant(tenantId: string, locationId: string): void {
  const row = locationRepository.findLocationRowById(locationId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Destination location not found");
  }
}

function assertUniqueSupplierInvoiceNumber(
  tenantId: string,
  supplierId: string,
  supplierInvoiceNumber: string | null,
  excludeId?: string
): void {
  if (!supplierInvoiceNumber) return;
  const existing = purchaseRepository.findPurchaseBySupplierInvoiceRow(
    tenantId,
    supplierId,
    supplierInvoiceNumber,
    excludeId
  );
  if (existing) {
    throw new Error(`Supplier invoice number "${supplierInvoiceNumber}" is already recorded for this supplier`);
  }
}

function prepareCart(tenantId: string, items: PurchaseItemInput[], shippingCostCents: number): PreparedPurchaseCart {
  const tenantTaxConfig = getCurrentTenant();

  const preparedItems: PreparedPurchaseItem[] = items.map((item) => {
    const product = productRepository.findProductRowById(item.productId);
    if (!product || product.tenant_id !== tenantId) {
      throw new Error("One of the selected products was not found");
    }

    // Supplier invoice cost follows the same product-level (falling back to tenant-wide) inclusive/
    // exclusive setting as retail prices (see tax-calculation.ts) — tax is extracted for reporting
    // when inclusive, added on top when exclusive. taxType comes from the line itself (defaults from
    // the product in the UI, but a real invoice can classify differently).
    const taxableCents = item.orderedQuantity * item.unitCostCents - item.discountAmountCents;
    const taxType = item.taxType as ProductTaxType;
    const productTaxConfig = resolveProductTaxConfig(
      { pricesTaxInclusive: product.prices_tax_inclusive === null ? null : Boolean(product.prices_tax_inclusive) },
      tenantTaxConfig
    );
    const { grossCents, taxCents } = computeLineTax(taxableCents, taxType, productTaxConfig);

    return {
      productId: product.id,
      orderedQuantity: item.orderedQuantity,
      unitCostCents: item.unitCostCents,
      sellingPriceCents: item.sellingPriceCents ?? null,
      discountAmountCents: item.discountAmountCents,
      taxType,
      taxAmountCents: taxCents,
      lineTotalCents: grossCents
    };
  });

  let subtotalCents = 0;
  let discountAmountCents = 0;
  let taxAmountCents = 0;
  for (const item of preparedItems) {
    subtotalCents += item.orderedQuantity * item.unitCostCents;
    discountAmountCents += item.discountAmountCents;
    taxAmountCents += item.taxAmountCents;
  }

  // Sums each line's own grossCents rather than branching off one global toggle — same reasoning as
  // sale-service.ts's prepareCart, since an order's lines can mix inclusive and exclusive products
  // via their own overrides. Shipping is a whole-order add-on, unlike discount — it increases the
  // total, it never reduces it.
  const grandTotalCents = preparedItems.reduce((sum, item) => sum + item.lineTotalCents, 0) + shippingCostCents;

  return {
    items: preparedItems,
    subtotalCents,
    discountAmountCents,
    taxAmountCents,
    shippingCostCents,
    grandTotalCents
  };
}

/** The moment a purchase is saved as "ordered" is when the business actually knows its new cost for
 * these products — so this is when buying/selling/minimum price all get re-set on the product
 * itself, not just recorded on the purchase line. Deliberately NOT run for a "draft" save (nothing
 * is confirmed yet) or on receiving goods (that's stock arrival, a separate concern — see the
 * Stock Before/After freeze pattern). See product-repository.ts's updatePricingFromPurchaseRow for
 * the actual column-level behavior (minimum price always pinned to the new buying price). */
function syncProductPricingFromOrder(items: Array<{ productId: string; unitCostCents: number; sellingPriceCents: number | null }>): void {
  for (const item of items) {
    productRepository.updatePricingFromPurchaseRow(item.productId, {
      buyingPriceCents: item.unitCostCents,
      sellingPriceCents: item.sellingPriceCents
    });
  }
}

export function getPurchaseDetail(id: string): Purchase {
  const row = purchaseRepository.findPurchaseDetailRowById(id);
  if (!row) {
    throw new Error("Purchase not found");
  }
  const items = purchaseRepository.findPurchaseItemDetailRowsForPurchase(id).map(purchaseRepository.mapPurchaseItemDetailRow);
  return purchaseRepository.mapPurchaseDetailRow(row, items);
}

/** Tenant-wide by default; branch-scoped to the caller's assigned location like Sales/Invoices/Quotations —
 * a super-admin with no assigned branch sees every storefront's purchase orders. */
export function listPurchases(): PurchaseListItem[] {
  requirePermission("purchases", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return purchaseRepository.findAllPurchaseListRows(tenantId, locationId).map(purchaseRepository.mapPurchaseListRow);
}

export function getPurchaseSummary(): PurchaseSummary {
  requirePermission("purchases", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return purchaseRepository.mapPurchaseSummaryRow(purchaseRepository.findPurchaseSummaryRow(tenantId, locationId));
}

export function getPurchase(id: string): Purchase {
  requirePermission("purchases", "view");
  return getPurchaseDetail(id);
}

/** Creates a purchase order — stock never moves here. Goods only enter inventory via receivePurchaseGoods. */
export function createPurchase(input: unknown): Purchase {
  requirePermission("purchases", "create");
  const parsed: PurchaseCreateInput = purchaseCreateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();

  assertSupplierExists(tenantId, parsed.supplierId);
  assertLocationBelongsToTenant(tenantId, parsed.locationId);
  assertUniqueSupplierInvoiceNumber(tenantId, parsed.supplierId, parsed.supplierInvoiceNumber);

  const cart = prepareCart(tenantId, parsed.items, parsed.shippingCostCents);
  const purchaseId = `purchase_${randomUUID()}`;
  const now = new Date().toISOString();

  return runInTransaction(() => {
    purchaseRepository.insertPurchaseRow({
      id: purchaseId,
      tenantId,
      purchaseNumber: generatePurchaseNumber(tenantId),
      supplierId: parsed.supplierId,
      supplierInvoiceNumber: parsed.supplierInvoiceNumber,
      locationId: parsed.locationId,
      status: parsed.intent,
      taxType: LEGACY_PURCHASE_TAX_TYPE,
      subtotalCents: cart.subtotalCents,
      discountAmountCents: cart.discountAmountCents,
      taxAmountCents: cart.taxAmountCents,
      shippingCostCents: cart.shippingCostCents,
      grandTotalCents: cart.grandTotalCents,
      notes: parsed.notes,
      attachmentPath: parsed.attachmentPath,
      orderedAt: parsed.intent === "ordered" ? now : null,
      createdBy: employeeId
    });

    for (const item of cart.items) {
      purchaseRepository.insertPurchaseItemRow({
        id: `purchase_item_${randomUUID()}`,
        purchaseId,
        productId: item.productId,
        orderedQuantity: item.orderedQuantity,
        unitCostCents: item.unitCostCents,
        sellingPriceCents: item.sellingPriceCents,
        discountAmountCents: item.discountAmountCents,
        taxType: item.taxType,
        taxAmountCents: item.taxAmountCents,
        lineTotalCents: item.lineTotalCents
      });
    }

    if (parsed.intent === "ordered") {
      syncProductPricingFromOrder(cart.items);
    }

    return getPurchaseDetail(purchaseId);
  });
}

function requireEditableDraft(id: string, tenantId: string): PurchaseRow {
  const row = purchaseRepository.findPurchaseRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Purchase not found");
  }
  if (row.status !== "draft") {
    throw new Error("Only draft purchases can be edited");
  }
  return row;
}

/** A draft can be freely re-priced/re-itemized — nothing has been ordered or received yet. */
export function updatePurchase(id: string, input: unknown): Purchase {
  requirePermission("purchases", "edit");
  const parsed: PurchaseUpdateInput = purchaseUpdateSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const existing = requireEditableDraft(id, tenantId);

  assertSupplierExists(tenantId, parsed.supplierId);
  assertLocationBelongsToTenant(tenantId, parsed.locationId);
  assertUniqueSupplierInvoiceNumber(tenantId, parsed.supplierId, parsed.supplierInvoiceNumber, id);

  const cart = prepareCart(tenantId, parsed.items, parsed.shippingCostCents);
  const now = new Date().toISOString();

  if (existing.attachment_path && existing.attachment_path !== parsed.attachmentPath) {
    deleteManagedPurchaseAttachment(existing.attachment_path);
  }

  return runInTransaction(() => {
    purchaseRepository.updatePurchaseRow(id, {
      supplierId: parsed.supplierId,
      supplierInvoiceNumber: parsed.supplierInvoiceNumber,
      locationId: parsed.locationId,
      taxType: LEGACY_PURCHASE_TAX_TYPE,
      subtotalCents: cart.subtotalCents,
      discountAmountCents: cart.discountAmountCents,
      taxAmountCents: cart.taxAmountCents,
      shippingCostCents: cart.shippingCostCents,
      grandTotalCents: cart.grandTotalCents,
      notes: parsed.notes,
      attachmentPath: parsed.attachmentPath
    });

    purchaseRepository.deletePurchaseItemsForPurchaseRow(id);
    for (const item of cart.items) {
      purchaseRepository.insertPurchaseItemRow({
        id: `purchase_item_${randomUUID()}`,
        purchaseId: id,
        productId: item.productId,
        orderedQuantity: item.orderedQuantity,
        unitCostCents: item.unitCostCents,
        sellingPriceCents: item.sellingPriceCents,
        discountAmountCents: item.discountAmountCents,
        taxType: item.taxType,
        taxAmountCents: item.taxAmountCents,
        lineTotalCents: item.lineTotalCents
      });
    }

    if (parsed.intent === "ordered") {
      purchaseRepository.updatePurchaseStatusRow(id, "ordered", { orderedAt: now });
      syncProductPricingFromOrder(cart.items);
    }

    return getPurchaseDetail(id);
  });
}

/** Manually places a saved draft with the supplier — the only forward transition a user triggers by
 * hand; Partially Received/Received are derived automatically from what's actually been received. */
export function markPurchaseOrdered(id: string): Purchase {
  requirePermission("purchases", "edit");
  const { tenantId } = getCurrentTenant();
  const row = purchaseRepository.findPurchaseRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Purchase not found");
  }
  if (row.status !== "draft") {
    throw new Error("Only draft purchases can be marked as ordered");
  }

  return runInTransaction(() => {
    purchaseRepository.updatePurchaseStatusRow(id, "ordered", { orderedAt: new Date().toISOString() });

    // No items are resubmitted on this path (it's a status-only flip on an already-saved draft) —
    // read back what's already stored, same syncProductPricingFromOrder every other "save as
    // ordered" path runs.
    const itemRows = purchaseRepository.findPurchaseItemDetailRowsForPurchase(id);
    syncProductPricingFromOrder(
      itemRows.map((row) => ({
        productId: row.product_id,
        unitCostCents: row.unit_cost_cents,
        sellingPriceCents: row.selling_price_cents
      }))
    );

    return getPurchaseDetail(id);
  });
}

/** Cancels a purchase that hasn't received any stock yet. Once any quantity has arrived, cancelling
 * would leave inventory with no clean reversal path — use a return workflow instead in that case. */
export function cancelPurchase(id: string): Purchase {
  requirePermission("purchases", "edit");
  const { tenantId } = getCurrentTenant();
  const row = purchaseRepository.findPurchaseRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Purchase not found");
  }
  if (row.status === "cancelled") {
    throw new Error("This purchase is already cancelled");
  }
  if (row.status === "partially_received" || row.status === "received") {
    throw new Error("This purchase already has received stock and can't be cancelled");
  }

  purchaseRepository.updatePurchaseStatusRow(id, "cancelled");
  return getPurchaseDetail(id);
}

/**
 * Receives some or all of the outstanding quantity on one or more lines. Stock is only ever
 * increased here — never on create/order — and every unit received generates a real stock movement
 * at the purchase's destination location, so Main Store allocations and branch inventory stay
 * accurate. Supports repeated partial receiving sessions until every line is fully received.
 */
export function receivePurchaseGoods(id: string, input: unknown): Purchase {
  requirePermission("purchases", "edit");
  const parsed = receiveGoodsSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = getCurrentEmployeeId();
  const session = getSession();
  const receivedByName = session ? `${session.employee.firstName} ${session.employee.lastName}` : "Unknown";

  const purchase = purchaseRepository.findPurchaseRowById(id);
  if (!purchase || purchase.tenant_id !== tenantId) {
    throw new Error("Purchase not found");
  }
  if (purchase.status !== "ordered" && purchase.status !== "partially_received") {
    throw new Error("Only ordered or partially received purchases can receive stock");
  }

  const existingItems = purchaseRepository.findPurchaseItemDetailRowsForPurchase(id);
  const itemById = new Map(existingItems.map((item) => [item.id, item]));

  for (const entry of parsed.items) {
    const item = itemById.get(entry.purchaseItemId);
    if (!item || item.purchase_id !== id) {
      throw new Error("One of the selected purchase lines was not found");
    }
    if (entry.receivingQuantity > item.remaining_quantity) {
      throw new Error(
        `Can't receive ${entry.receivingQuantity} units — only ${item.remaining_quantity} remain outstanding`
      );
    }
  }

  return runInTransaction(() => {
    const eventItems: PurchaseReceivingEventItem[] = [];

    for (const entry of parsed.items) {
      const item = itemById.get(entry.purchaseItemId);
      if (!item || entry.receivingQuantity <= 0) continue;

      const previousQuantity = inventoryRepository.findInventoryRow(item.product_id, purchase.location_id)?.quantity ?? 0;
      const newQuantity = previousQuantity + entry.receivingQuantity;

      const newReceivedQuantity = item.received_quantity + entry.receivingQuantity;
      purchaseRepository.updatePurchaseItemReceivedQuantityRow(item.id, newReceivedQuantity);

      applyValidatedStockMovement(
        {
          productId: item.product_id,
          locationId: purchase.location_id,
          movementType: "purchase",
          quantityChange: entry.receivingQuantity,
          referenceType: "purchase",
          referenceId: id,
          performedBy: employeeId,
          notes: null
        },
        tenantId
      );

      eventItems.push({
        purchaseItemId: item.id,
        productId: item.product_id,
        productName: item.product_name,
        sku: item.sku,
        receivingQuantity: entry.receivingQuantity,
        previousQuantity,
        newQuantity
      });
    }

    if (eventItems.length > 0) {
      const existingEvents = JSON.parse(purchase.receiving_events) as PurchaseReceivingEvent[];
      const newEvent: PurchaseReceivingEvent = {
        id: `purchase_receiving_${randomUUID()}`,
        receivedBy: employeeId ?? "",
        receivedByName,
        receivedAt: new Date().toISOString(),
        items: eventItems
      };
      purchaseRepository.appendReceivingEventToPurchaseRow({
        id,
        receivingEvents: [...existingEvents, newEvent]
      });
    }

    const updatedItems = purchaseRepository.findPurchaseItemRowsForPurchase(id);
    const newStatus = computePurchaseReceivingStatus({
      items: updatedItems.map((item) => ({
        orderedQuantity: item.ordered_quantity,
        receivedQuantity: item.received_quantity
      }))
    });

    purchaseRepository.updatePurchaseStatusRow(
      id,
      newStatus as PurchaseStatus,
      newStatus === "received" ? { receivedAt: new Date().toISOString() } : undefined
    );

    return getPurchaseDetail(id);
  });
}

function requireActivePaymentMethod(
  tenantId: string,
  paymentMethodId: string
): { id: string; name: string; requiresReference: boolean } {
  const method = paymentMethodRepository.findPaymentMethodRowById(paymentMethodId);
  if (!method || method.tenant_id !== tenantId) {
    throw new Error("Payment method not found");
  }
  if (!method.is_active) {
    throw new Error(`"${method.name}" is not active`);
  }
  return { id: method.id, name: method.name, requiresReference: Boolean(method.requires_reference) };
}

function applyPayment(
  tenantId: string,
  purchaseId: string,
  payment: { paymentMethodId: string; amountCents: number; reference: string | null; notes: string | null }
): Purchase {
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }
  const session = getSession();
  const paidByName = session ? `${session.employee.firstName} ${session.employee.lastName}` : "Unknown";

  const row = purchaseRepository.findPurchaseRowById(purchaseId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Purchase not found");
  }
  if (row.status === "cancelled") {
    throw new Error("This purchase has been cancelled");
  }
  const balanceDueCents = row.grand_total_cents - row.amount_paid_cents;
  if (balanceDueCents <= 0) {
    throw new Error("This purchase is already fully paid");
  }
  if (payment.amountCents > balanceDueCents) {
    throw new Error(`Amount exceeds the outstanding balance of ${(balanceDueCents / 100).toFixed(2)}`);
  }

  const method = requireActivePaymentMethod(tenantId, payment.paymentMethodId);
  if (method.requiresReference && !payment.reference) {
    throw new Error(`${method.name} requires a reference number`);
  }

  const existingPayments = JSON.parse(row.payments) as PurchasePayment[];
  const now = new Date().toISOString();
  const newPayment: PurchasePayment = {
    id: `purchase_payment_${randomUUID()}`,
    paymentMethodId: method.id,
    paymentMethodName: method.name,
    amountCents: payment.amountCents,
    reference: payment.reference,
    paidBy: employeeId,
    paidByName,
    paidAt: now,
    notes: payment.notes
  };
  const payments = [...existingPayments, newPayment];
  const amountPaidCents = payments.reduce((sum, entry) => sum + entry.amountCents, 0);
  const paymentStatus = computePurchasePaymentStatus({
    grandTotalCents: row.grand_total_cents,
    amountPaidCents
  });

  purchaseRepository.appendPaymentToPurchaseRow({
    id: purchaseId,
    payments,
    amountPaidCents,
    paymentStatus,
    paymentMethodId: method.id,
    paymentReference: payment.reference
  });

  return getPurchaseDetail(purchaseId);
}

/** Records a supplier payment against the purchase's outstanding balance. */
export function recordPurchasePayment(purchaseId: string, input: unknown): Purchase {
  requirePermission("purchases", "edit");
  const parsed = recordPurchasePaymentSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  return applyPayment(tenantId, purchaseId, parsed);
}

/** Records a final payment for the exact remaining balance — a one-click "pay it off" action. */
export function markPurchasePaid(purchaseId: string, input: unknown): Purchase {
  requirePermission("purchases", "edit");
  const parsed = markPurchasePaidSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const row = purchaseRepository.findPurchaseRowById(purchaseId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Purchase not found");
  }

  return applyPayment(tenantId, purchaseId, {
    paymentMethodId: parsed.paymentMethodId,
    amountCents: row.grand_total_cents - row.amount_paid_cents,
    reference: parsed.reference,
    notes: parsed.notes
  });
}

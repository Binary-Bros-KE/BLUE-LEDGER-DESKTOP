import { randomUUID } from "node:crypto";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { runInTransaction } from "@main/database/connection";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { getCurrentBranchScope, getSession, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import {
  checkoutInputSchema,
  saleCartInputSchema,
  type CheckoutInput,
  type SaleCartInput
} from "@shared/schemas/sale";
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

export type PreparedCart = {
  items: PreparedItem[];
  subtotalCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  grandTotalCents: number;
};

/** The employee/branch the POS screen always acts as — never taken from renderer input. */
export function requireActiveSession(): { tenantId: string; employeeId: string; locationId: string } {
  const session = getSession();
  if (!session) {
    throw new Error("You must be signed in to use the POS");
  }
  if (!session.branch) {
    throw new Error("You have no branch assigned. Contact an administrator before making sales.");
  }
  const { tenantId } = getCurrentTenant();
  return { tenantId, employeeId: session.employee.id, locationId: session.branch.id };
}

function assertCustomerExists(tenantId: string, customerId: string | null): void {
  if (!customerId) return;
  const customer = customerRepository.findCustomerRowById(customerId);
  if (!customer || customer.tenant_id !== tenantId) {
    throw new Error("Customer not found");
  }
}

/** Prices and taxes every cart line from live product data — never trusts client-supplied money math. */
export function prepareCart(tenantId: string, items: SaleCartInput["items"]): PreparedCart {
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

  return {
    items: preparedItems,
    subtotalCents,
    discountAmountCents,
    taxAmountCents,
    grandTotalCents: subtotalCents - discountAmountCents + taxAmountCents
  };
}

/** Removes a held sale being replaced — either resumed-then-resuspended, or resumed-then-completed. */
function discardResumedSale(tenantId: string, resumeSaleId: string | null | undefined): void {
  if (!resumeSaleId) return;
  const pending = saleRepository.findSaleRowById(resumeSaleId);
  if (pending && pending.tenant_id === tenantId && pending.sale_status === "pending") {
    saleRepository.deleteSaleItemsForSaleRow(pending.id);
    saleRepository.deleteSaleRow(pending.id);
  }
}

function generateReceiptNumber(tenantId: string): string {
  const maxReceipt = saleRepository.findMaxReceiptNumberRow(tenantId);
  const currentNumber = maxReceipt ? Number(maxReceipt.slice("BL-".length)) : 0;
  const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 1;
  return `BL-${String(nextNumber).padStart(7, "0")}`;
}

export function getSaleDetail(id: string): Sale {
  const row = saleRepository.findSaleDetailRowById(id);
  if (!row) {
    throw new Error("Sale not found");
  }
  const items = saleRepository.findSaleItemDetailRows(id).map(saleRepository.mapSaleItemDetailRow);
  return saleRepository.mapSaleDetailRow(row, items);
}

export function listPendingSales(): PendingSaleListItem[] {
  requirePermission("sales", "view");
  const session = getSession();
  if (!session?.branch) return [];
  const { tenantId } = getCurrentTenant();
  return saleRepository
    .findPendingSaleListRows(tenantId, session.branch.id)
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
  const { tenantId, employeeId, locationId } = requireActiveSession();

  assertCustomerExists(tenantId, parsed.customerId);
  const cart = prepareCart(tenantId, parsed.items);

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

  runInTransaction(() => {
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
  const { tenantId, employeeId, locationId } = requireActiveSession();

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
  const cart = prepareCart(tenantId, parsed.items);

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

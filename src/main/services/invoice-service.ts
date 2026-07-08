import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as customerRepository from "@main/database/repositories/customer-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import type { SaleRow } from "@main/database/repositories/sale-repository";
import { runInTransaction } from "@main/database/connection";
import {
  getCurrentBranchScope,
  getCurrentEmployeeId,
  getSession,
  requirePermission
} from "@main/services/auth-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import {
  getSaleDetail,
  prepareCart,
  requireActiveSession,
  type PreparedCart
} from "@main/services/sale-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { computePaymentStatus } from "@shared/lib/invoice";
import { optionalText } from "@shared/schemas/common";
import { createInvoiceSchema, recordPaymentSchema, type CreateInvoiceInput } from "@shared/schemas/invoice";
import type { InvoiceListItem, InvoiceSummary } from "@shared/types/invoice";
import type { PaymentStatus, Sale, SalePayment, TransactionType } from "@shared/types/sale";

const markPaidSchema = z.object({
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  reference: optionalText(120),
  notes: optionalText(500)
});

function generateInvoiceNumber(tenantId: string): string {
  const maxInvoice = saleRepository.findMaxInvoiceNumberRow(tenantId);
  const currentNumber = maxInvoice ? Number(maxInvoice.slice("INV-".length)) : 0;
  const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 1;
  return `INV-${String(nextNumber).padStart(6, "0")}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function diffDays(laterIso: string, earlierIso: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / msPerDay);
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

function requireInvoiceRow(id: string, tenantId: string): SaleRow {
  const row = saleRepository.findSaleRowById(id);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Invoice not found");
  }
  if (!row.invoice_number) {
    throw new Error("This sale is not an invoice");
  }
  return row;
}

function applyPayment(
  tenantId: string,
  saleId: string,
  payment: { paymentMethodId: string; amountCents: number; reference: string | null; notes: string | null }
): Sale {
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }
  const session = getSession();
  const receivedByName = session ? `${session.employee.firstName} ${session.employee.lastName}` : "Unknown";

  const row = requireInvoiceRow(saleId, tenantId);
  if (row.payment_status === "cancelled") {
    throw new Error("This invoice has been cancelled");
  }
  if (row.balance_due_cents <= 0) {
    throw new Error("This invoice is already fully paid");
  }
  if (payment.amountCents > row.balance_due_cents) {
    throw new Error(
      `Amount exceeds the outstanding balance of ${(row.balance_due_cents / 100).toFixed(2)}`
    );
  }

  const method = requireActivePaymentMethod(tenantId, payment.paymentMethodId);
  if (method.requiresReference && !payment.reference) {
    throw new Error(`${method.name} requires a reference number`);
  }

  const existingPayments = JSON.parse(row.payments) as SalePayment[];
  const now = new Date().toISOString();
  const newPayment: SalePayment = {
    id: `payment_${randomUUID()}`,
    paymentMethodId: method.id,
    paymentMethodName: method.name,
    amountCents: payment.amountCents,
    reference: payment.reference,
    receivedBy: employeeId,
    receivedByName,
    receivedAt: now,
    notes: payment.notes
  };
  const payments = [...existingPayments, newPayment];

  const amountPaidCents = payments.reduce((sum, entry) => sum + entry.amountCents, 0);
  const balanceDueCents = row.grand_total_cents - amountPaidCents;
  const paymentStatus = computePaymentStatus({
    balanceDueCents,
    amountPaidCents,
    dueDate: row.due_date,
    cancelled: false
  });

  saleRepository.appendPaymentToSaleRow({
    id: saleId,
    payments,
    amountPaidCents,
    balanceDueCents,
    paymentStatus
  });

  return getSaleDetail(saleId);
}

/** Exported so quotation conversion can reuse this insertion path with the quotation's frozen cart pricing. */
export function insertInvoiceFromCart(input: {
  tenantId: string;
  employeeId: string;
  locationId: string;
  customerId: string;
  transactionType: TransactionType;
  dueDate: string;
  invoiceNotes: string | null;
  cart: PreparedCart;
  initialPayment: { paymentMethodId: string; amountCents: number; reference: string | null } | null;
}): string {
  const { tenantId, employeeId, locationId } = input;
  const saleId = `sale_${randomUUID()}`;
  const invoiceNumber = generateInvoiceNumber(tenantId);
  const invoiceDate = new Date().toISOString();

  let payments: SalePayment[] = [];
  let amountPaidCents = 0;

  if (input.initialPayment) {
    const method = requireActivePaymentMethod(tenantId, input.initialPayment.paymentMethodId);
    if (method.requiresReference && !input.initialPayment.reference) {
      throw new Error(`${method.name} requires a reference number`);
    }
    const session = getSession();
    const receivedByName = session ? `${session.employee.firstName} ${session.employee.lastName}` : "Unknown";
    amountPaidCents = input.initialPayment.amountCents;
    payments = [
      {
        id: `payment_${randomUUID()}`,
        paymentMethodId: method.id,
        paymentMethodName: method.name,
        amountCents: amountPaidCents,
        reference: input.initialPayment.reference,
        receivedBy: employeeId,
        receivedByName,
        receivedAt: invoiceDate,
        notes: null
      }
    ];
  }

  if (amountPaidCents > input.cart.grandTotalCents) {
    throw new Error("The initial payment can't exceed the invoice total");
  }
  const balanceDueCents = input.cart.grandTotalCents - amountPaidCents;
  const paymentStatus = computePaymentStatus({
    balanceDueCents,
    amountPaidCents,
    dueDate: input.dueDate,
    cancelled: false
  });

  runInTransaction(() => {
    saleRepository.insertInvoiceRow({
      id: saleId,
      tenantId,
      locationId,
      employeeId,
      customerId: input.customerId,
      transactionType: input.transactionType,
      invoiceNumber,
      invoiceDate,
      dueDate: input.dueDate,
      subtotalCents: input.cart.subtotalCents,
      discountAmountCents: input.cart.discountAmountCents,
      taxAmountCents: input.cart.taxAmountCents,
      grandTotalCents: input.cart.grandTotalCents,
      amountPaidCents,
      balanceDueCents,
      paymentStatus,
      invoiceNotes: input.invoiceNotes,
      payments
    });

    for (const item of input.cart.items) {
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
            referenceType: "invoice",
            referenceId: saleId,
            performedBy: employeeId,
            notes: null
          },
          tenantId
        );
      }
    }
  });

  return saleId;
}

export function listInvoices(): InvoiceListItem[] {
  requirePermission("sales", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return saleRepository.findAllInvoiceRows(tenantId, locationId).map(saleRepository.mapInvoiceListRow);
}

export function getInvoiceSummary(): InvoiceSummary {
  requirePermission("sales", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return saleRepository.mapInvoiceSummaryRow(saleRepository.findInvoiceSummaryRow(tenantId, locationId));
}

/** Creates a new invoice — goods/services are considered delivered now, payment can follow over time. */
export function createInvoice(input: unknown): Sale {
  requirePermission("sales", "create");
  const parsed: CreateInvoiceInput = createInvoiceSchema.parse(input);
  const { tenantId, employeeId, locationId } = requireActiveSession();

  const customer = customerRepository.findCustomerRowById(parsed.customerId);
  if (!customer || customer.tenant_id !== tenantId) {
    throw new Error("Customer not found");
  }

  const cart = prepareCart(tenantId, parsed.items);

  const saleId = insertInvoiceFromCart({
    tenantId,
    employeeId,
    locationId,
    customerId: parsed.customerId,
    transactionType: parsed.transactionType,
    dueDate: parsed.dueDate,
    invoiceNotes: parsed.invoiceNotes,
    cart,
    initialPayment: parsed.initialPayment
  });

  return getSaleDetail(saleId);
}

/** Appends a payment to the invoice's history and recalculates the outstanding balance and status. */
export function recordInvoicePayment(saleId: string, input: unknown): Sale {
  requirePermission("sales", "edit");
  const parsed = recordPaymentSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  return applyPayment(tenantId, saleId, parsed);
}

/** Records a final payment for the exact remaining balance, keeping the payment ledger complete. */
export function markInvoicePaid(saleId: string, input: unknown): Sale {
  requirePermission("sales", "edit");
  const parsed = markPaidSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const row = requireInvoiceRow(saleId, tenantId);

  return applyPayment(tenantId, saleId, {
    paymentMethodId: parsed.paymentMethodId,
    amountCents: row.balance_due_cents,
    reference: parsed.reference,
    notes: parsed.notes
  });
}

/** Writes off the invoice without touching inventory — use the Void workflow if stock must be reversed. */
export function cancelInvoice(saleId: string): Sale {
  requirePermission("sales", "edit");
  const { tenantId } = getCurrentTenant();
  const row = requireInvoiceRow(saleId, tenantId);
  if (row.payment_status === "cancelled") {
    throw new Error("This invoice is already cancelled");
  }

  saleRepository.updateSalePaymentStatusRow(saleId, "cancelled" satisfies PaymentStatus);
  return getSaleDetail(saleId);
}

/** Creates a fresh unpaid invoice with the same customer, items, and terms — for recurring billing. */
export function duplicateInvoice(saleId: string): Sale {
  requirePermission("sales", "create");
  const { tenantId, employeeId, locationId } = requireActiveSession();
  const original = getSaleDetail(saleId);
  if (!original.invoiceNumber) {
    throw new Error("This sale is not an invoice");
  }
  if (!original.customerId) {
    throw new Error("The original invoice has no customer to bill");
  }

  const termDays =
    original.invoiceDate && original.dueDate ? diffDays(original.dueDate, original.invoiceDate) : 30;
  const newInvoiceDate = new Date().toISOString();
  const newDueDate = addDaysIso(newInvoiceDate, termDays > 0 ? termDays : 30);

  const cart = prepareCart(
    tenantId,
    original.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      discountAmountCents: item.discountAmountCents
    }))
  );

  const saleId2 = insertInvoiceFromCart({
    tenantId,
    employeeId,
    locationId,
    customerId: original.customerId,
    transactionType: original.transactionType,
    dueDate: newDueDate,
    invoiceNotes: original.invoiceNotes,
    cart,
    initialPayment: null
  });

  return getSaleDetail(saleId2);
}

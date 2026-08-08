import { randomUUID } from "node:crypto";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import { requirePermission, requireSignedIn } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { paymentMethodInputSchema } from "@shared/schemas/payment-method";
import type { PaymentMethod } from "@shared/types/payment-method";

const DEFAULT_PAYMENT_METHODS: Array<{
  name: string;
  code: string;
  requiresReference: boolean;
}> = [
  { name: "Cash", code: "CASH", requiresReference: false },
  { name: "M-Pesa", code: "MPESA", requiresReference: true },
  { name: "Card", code: "CARD", requiresReference: true },
  { name: "Bank Transfer", code: "BANK_TRANSFER", requiresReference: true },
  { name: "Cheque", code: "CHEQUE", requiresReference: true },
  { name: "PayPal", code: "PAYPAL", requiresReference: true }
];

/**
 * Seeds the default payment methods the first time a tenant has none at all. Called once from
 * app bootstrap (before anyone is signed in), mirroring the default-roles/system-employee seeds —
 * listPaymentMethods() is permission-gated, so seeding can't live there without a chicken-and-egg
 * deadlock on a brand new install.
 */
export function ensureDefaultPaymentMethods(tenantId: string): void {
  const existing = paymentMethodRepository.findAllPaymentMethodRows(tenantId);
  if (existing.length > 0) return;

  DEFAULT_PAYMENT_METHODS.forEach((method, index) => {
    paymentMethodRepository.insertPaymentMethodRow({
      id: `payment_method_${randomUUID()}`,
      tenantId,
      name: method.name,
      code: method.code,
      description: null,
      isActive: true,
      requiresReference: method.requiresReference,
      sortOrder: index,
      isSystemMethod: true
    });
  });
}

/**
 * Was seeded as a default system payment method; removed from DEFAULT_PAYMENT_METHODS since a
 * credit sale is never actually completed with a payment method at all — it goes through Invoices
 * instead (unpaid/partially paid, no payment_method_id until an actual payment is recorded against
 * it). Tenants that already had it seeded before this change get it deactivated here (not deleted —
 * it's a system method that may already be synced/referenced by old sales, and deactivating already
 * achieves "no longer offered at checkout" without losing that historical link). Idempotent and
 * cheap (no-op once already inactive), same as every other "ensureX" boot fixup.
 */
export function ensureCreditPaymentMethodDeactivated(tenantId: string): void {
  const row = paymentMethodRepository.findPaymentMethodByCodeRow(tenantId, "CREDIT");
  if (!row || !row.is_system_method || !row.is_active) return;
  paymentMethodRepository.setPaymentMethodActiveRow(row.id, false);
}

function assertUniqueFields(
  tenantId: string,
  fields: { name: string; code: string },
  excludeId?: string
): void {
  if (paymentMethodRepository.findPaymentMethodByNameRow(tenantId, fields.name, excludeId)) {
    throw new Error(`A payment method named "${fields.name}" already exists`);
  }
  if (paymentMethodRepository.findPaymentMethodByCodeRow(tenantId, fields.code, excludeId)) {
    throw new Error(`Code "${fields.code}" is already in use`);
  }
}

/** Every signed-in employee can read the list — choosing a payment method is part of completing a
 * sale/invoice/quotation, which is already gated by its own permission. Managing payment methods
 * (create/edit/delete) below remains gated behind the "payment_methods" permission. */
export function listPaymentMethods(): PaymentMethod[] {
  requireSignedIn();
  const { tenantId } = getCurrentTenant();
  return paymentMethodRepository
    .findAllPaymentMethodRows(tenantId)
    .map(paymentMethodRepository.mapPaymentMethodRow);
}

export function getPaymentMethod(id: string): PaymentMethod {
  requirePermission("payment_methods", "view");
  const row = paymentMethodRepository.findPaymentMethodRowById(id);
  if (!row) {
    throw new Error("Payment method not found");
  }
  return paymentMethodRepository.mapPaymentMethodRow(row);
}

export function createPaymentMethod(input: unknown): PaymentMethod {
  requirePermission("payment_methods", "create");
  const parsed = paymentMethodInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  assertUniqueFields(tenantId, parsed);

  const row = paymentMethodRepository.insertPaymentMethodRow({
    ...parsed,
    id: `payment_method_${randomUUID()}`,
    tenantId,
    isSystemMethod: false
  });
  return paymentMethodRepository.mapPaymentMethodRow(row);
}

export function updatePaymentMethod(id: string, input: unknown): PaymentMethod {
  requirePermission("payment_methods", "edit");
  const parsed = paymentMethodInputSchema.parse(input);
  const existing = paymentMethodRepository.findPaymentMethodRowById(id);
  if (!existing) {
    throw new Error("Payment method not found");
  }

  assertUniqueFields(existing.tenant_id, parsed, id);

  const row = paymentMethodRepository.updatePaymentMethodRow(id, parsed);
  return paymentMethodRepository.mapPaymentMethodRow(row);
}

export function setPaymentMethodActive(id: string, isActive: boolean): PaymentMethod {
  requirePermission("payment_methods", "edit");
  const row = paymentMethodRepository.setPaymentMethodActiveRow(id, isActive);
  return paymentMethodRepository.mapPaymentMethodRow(row);
}

export function deletePaymentMethod(id: string): { id: string } {
  requirePermission("payment_methods", "delete");
  const row = paymentMethodRepository.findPaymentMethodRowById(id);
  if (!row) {
    throw new Error("Payment method not found");
  }
  if (row.is_system_method) {
    throw new Error("System payment methods can't be deleted");
  }
  // Cloud sync has no delete propagation — a payment method already synced would leave a stale
  // copy on the cloud/other devices forever if hard-deleted here. Deactivating already achieves
  // "no longer offered at checkout" without losing the historical link from past sales.
  if (row.sync_status !== "pending") {
    throw new Error("This payment method has already synced to the cloud — deactivate it instead of deleting it.");
  }

  paymentMethodRepository.deletePaymentMethodRow(id);
  return { id };
}

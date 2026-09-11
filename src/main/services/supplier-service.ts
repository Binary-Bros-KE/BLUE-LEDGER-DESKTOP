import { randomUUID } from "node:crypto";
import * as supplierRepository from "@main/database/repositories/supplier-repository";
import { requirePermission, requirePermissionAnyOf } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { supplierInputSchema } from "@shared/schemas/supplier";
import type { Supplier, SupplierPickerOption, SupplierStatus } from "@shared/types/supplier";

/** SUP-D1-000001, SUP-D1-000002, ... — generated once at creation and never editable afterward.
 * Device-tagged (see generateDocumentNumber's own doc comment) — two offline devices independently
 * incrementing a plain local max used to be able to mint the exact same code for two different real
 * suppliers; the device tag makes that structurally impossible. */
function generateSupplierCode(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "SUP",
    digits: 6,
    existingNumbers: supplierRepository.findMaxSupplierCodeRow(tenantId)
  });
}

function assertUniqueBusinessName(tenantId: string, businessName: string, excludeId?: string): void {
  const existing = supplierRepository.findSupplierByBusinessNameRow(tenantId, businessName, excludeId);
  if (existing) {
    throw new Error(`A supplier named "${businessName}" already exists`);
  }
}

/**
 * Every tenant-wide supplier, master-data style — not branch-scoped, since a supplier is a business
 * relationship the whole company has, not one specific storefront. Callers building a selection
 * dropdown (e.g. a future Purchases screen) should filter to status === "active" themselves unless
 * they're deliberately letting the user pick from inactive suppliers too.
 */
export function listSuppliers(): Supplier[] {
  requirePermission("suppliers", "view");
  const { tenantId } = getCurrentTenant();
  return supplierRepository.findAllSupplierRows(tenantId).map(supplierRepository.mapSupplierRow);
}

/** Powers the "local/outsourced-source" supplier picker on Checkout/Invoices/Quotations — a role
 * that can process a sale/invoice/quotation but lacks "suppliers:view" (e.g. a Cashier, per client
 * request that cashiers not see supplier balances) can still pick a supplier here, since the shape
 * returned never carries balanceCents or anything else gated behind the full Suppliers tab. */
export function listSupplierPickerOptions(): SupplierPickerOption[] {
  requirePermissionAnyOf([
    ["suppliers", "view"],
    ["sales", "view"],
    ["quotations", "view"]
  ]);
  const { tenantId } = getCurrentTenant();
  return supplierRepository
    .findAllSupplierRows(tenantId)
    .map(supplierRepository.mapSupplierRow)
    .map(({ id, businessName, phone1, status }) => ({ id, businessName, phone1, status }));
}

export function getSupplier(id: string): Supplier {
  requirePermission("suppliers", "view");
  const row = supplierRepository.findSupplierRowById(id);
  if (!row) {
    throw new Error("Supplier not found");
  }
  return supplierRepository.mapSupplierRow(row);
}

/** Also reachable via "sales:create"/"quotations:create" — the quick-create button inside the
 * local-supplier picker (see listSupplierPickerOptions above) lets a Cashier add a brand-new
 * supplier mid-sale without ever needing the full "suppliers" module. Creating exposes nothing about
 * any OTHER supplier (the response is just the one record they themselves just entered), unlike
 * listSuppliers, so this is safe to widen the same way. */
export function createSupplier(input: unknown): Supplier {
  requirePermissionAnyOf([
    ["suppliers", "create"],
    ["sales", "create"],
    ["quotations", "create"]
  ]);
  const parsed = supplierInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  assertUniqueBusinessName(tenantId, parsed.businessName);

  const row = supplierRepository.insertSupplierRow({
    ...parsed,
    id: `supplier_${randomUUID()}`,
    tenantId,
    supplierCode: generateSupplierCode(tenantId)
  });
  return supplierRepository.mapSupplierRow(row);
}

export function updateSupplier(id: string, input: unknown): Supplier {
  requirePermission("suppliers", "edit");
  const parsed = supplierInputSchema.parse(input);
  const existing = supplierRepository.findSupplierRowById(id);
  if (!existing) {
    throw new Error("Supplier not found");
  }

  assertUniqueBusinessName(existing.tenant_id, parsed.businessName, id);

  const row = supplierRepository.updateSupplierRow(id, parsed);
  return supplierRepository.mapSupplierRow(row);
}

/** Suppliers are never permanently deleted — Purchases and inventory records will reference them by
 * id, so only their visibility toggles. */
export function setSupplierStatus(id: string, status: SupplierStatus): Supplier {
  requirePermission("suppliers", "edit");
  const row = supplierRepository.setSupplierStatusRow(id, status);
  return supplierRepository.mapSupplierRow(row);
}

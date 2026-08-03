import { randomUUID } from "node:crypto";
import * as customerRepository from "@main/database/repositories/customer-repository";
import { getCurrentBranchScope, requirePermission } from "@main/services/auth-service";
import { generateDocumentNumber } from "@main/services/document-number-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { customerInputSchema } from "@shared/schemas/customer";
import type { Customer, CustomerStatus } from "@shared/types/customer";

/** Device-tagged (e.g. "CUST-D1-00042") — see generateDocumentNumber's own doc comment. Two
 * offline devices independently incrementing a plain local max used to be able to mint the exact
 * same code for two different real customers; the device tag makes that structurally impossible. */
function generateCustomerCode(tenantId: string): string {
  return generateDocumentNumber({
    tenantId,
    prefix: "CUST",
    digits: 5,
    existingNumbers: customerRepository.findMaxCustomerCodeRow(tenantId)
  });
}

function assertUniquePhone(tenantId: string, phone: string, excludeId?: string): void {
  const existing = customerRepository.findCustomerByPhoneRow(tenantId, phone, excludeId);
  if (existing) {
    throw new Error(`A customer with phone "${phone}" already exists: ${existing.name}`);
  }
}

export function listCustomers(): Customer[] {
  requirePermission("customers", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return customerRepository.findAllCustomerRows(tenantId, locationId).map(customerRepository.mapCustomerRow);
}

export function getCustomer(id: string): Customer {
  requirePermission("customers", "view");
  const row = customerRepository.findCustomerRowById(id);
  if (!row) {
    throw new Error("Customer not found");
  }
  return customerRepository.mapCustomerRow(row);
}

export function createCustomer(input: unknown): Customer {
  requirePermission("customers", "create");
  const parsed = customerInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  assertUniquePhone(tenantId, parsed.phone);

  const row = customerRepository.insertCustomerRow({
    ...parsed,
    id: `customer_${randomUUID()}`,
    tenantId,
    customerCode: generateCustomerCode(tenantId),
    locationId: getCurrentBranchScope()
  });
  return customerRepository.mapCustomerRow(row);
}

export function updateCustomer(id: string, input: unknown): Customer {
  requirePermission("customers", "edit");
  const parsed = customerInputSchema.parse(input);
  const existing = customerRepository.findCustomerRowById(id);
  if (!existing) {
    throw new Error("Customer not found");
  }

  assertUniquePhone(existing.tenant_id, parsed.phone, id);

  const row = customerRepository.updateCustomerRow(id, parsed);
  return customerRepository.mapCustomerRow(row);
}

export function setCustomerStatus(id: string, status: CustomerStatus): Customer {
  requirePermission("customers", "edit");
  const row = customerRepository.setCustomerStatusRow(id, status);
  return customerRepository.mapCustomerRow(row);
}

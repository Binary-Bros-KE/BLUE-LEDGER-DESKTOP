import { randomUUID } from "node:crypto";
import * as customerRepository from "@main/database/repositories/customer-repository";
import { getCurrentBranchScope, requirePermission } from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { customerInputSchema } from "@shared/schemas/customer";
import type { Customer, CustomerStatus } from "@shared/types/customer";

function generateCustomerCode(tenantId: string): string {
  const maxCode = customerRepository.findMaxCustomerCodeRow(tenantId);
  const currentNumber = maxCode ? Number(maxCode.slice("CUST-".length)) : 0;
  const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 1;
  return `CUST-${String(nextNumber).padStart(5, "0")}`;
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

import { getDatabase } from "@main/database/connection";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import type { Currency, LicenseStatus, SubscriptionType, TenantContext } from "@shared/types/tenant";

type WorkstationRow = { id: string };

function toTenantContext(row: tenantRepository.TenantRow): TenantContext {
  const workstation = getDatabase()
    .prepare("SELECT id FROM workstations WHERE tenant_id = ? ORDER BY created_at LIMIT 1")
    .get(row.id) as WorkstationRow | undefined;

  return {
    tenantId: row.id,
    clientId: row.client_id,
    serverId: row.server_id,
    workstationId: workstation?.id ?? "",
    businessName: row.business_name,
    businessLogoPath: row.business_logo_path,
    physicalAddress: row.physical_address,
    primaryPhone: row.primary_phone,
    receiptHeader: row.receipt_header,
    receiptFooter: row.receipt_footer,
    currency: row.currency as Currency,
    vatRatePercent: row.vat_rate_percent,
    pricesTaxInclusive: Boolean(row.prices_tax_inclusive),
    invoiceEditsDisabled: Boolean(row.invoice_edits_disabled),
    invoiceStockFromMainStore: Boolean(row.invoice_stock_from_main_store),
    activated: row.license_key !== null,
    licenseStatus: row.license_status as LicenseStatus,
    nextDueDate: row.next_due_date,
    subscriptionType: row.subscription_type as SubscriptionType | null,
    ecommerceEnabled: Boolean(row.ecommerce_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getCurrentTenant(): TenantContext {
  const row = tenantRepository.findTenantRow();
  if (!row) throw new Error("Tenant has not been initialized yet");
  return toTenantContext(row);
}

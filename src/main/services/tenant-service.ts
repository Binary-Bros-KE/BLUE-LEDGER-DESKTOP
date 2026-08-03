import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import electron from "electron";
import { getDatabase, getDatabasePath, runInTransaction } from "@main/database/connection";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { requirePermission } from "@main/services/auth-service";
import { deleteManagedBusinessLogo, pickAndStoreBusinessLogo } from "@main/services/image-service";
import { pushProfileToServer } from "@main/services/license-service";

const { app } = electron;
import { APP_NAME } from "@shared/constants/app";
import { businessProfileInputSchema } from "@shared/schemas/tenant";
import type {
  AppContext,
  Currency,
  LicenseStatus,
  SubscriptionType,
  TenantContext,
  TenantRecord
} from "@shared/types/tenant";

type WorkstationRow = {
  id: string;
};

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
    activated: row.license_key !== null,
    licenseStatus: row.license_status as LicenseStatus,
    nextDueDate: row.next_due_date,
    subscriptionType: row.subscription_type as SubscriptionType | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function ensureTenantContext(): TenantContext {
  let row = tenantRepository.findTenantRow();

  if (!row) {
    const now = new Date().toISOString();
    const tenantId = `tenant_${randomUUID()}`;
    const clientId = `client_${randomUUID()}`;
    const workstationId = `station_${randomUUID()}`;

    runInTransaction(() => {
      row = tenantRepository.insertDefaultTenantRow({
        id: tenantId,
        clientId,
        businessName: "Blue Ledger Demo Store",
        currency: "KES",
        now
      });

      getDatabase()
        .prepare(
          `
          INSERT INTO workstations (
            id, tenant_id, server_id, label, device_fingerprint, last_seen_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        // "Device" is a placeholder — activateInstallation renames this to "Device {N}" once
        // registration hands back this workstation's permanent sequence number (never overwrites a
        // label the user has already customized by then — see updateWorkstationActivationRow).
        .run(workstationId, tenantId, null, "Device", hostname(), now, now, now);
    });
  }

  return toTenantContext(row!);
}

export function getCurrentTenant(): TenantContext {
  const row = tenantRepository.findTenantRow();
  if (!row) {
    throw new Error("Tenant has not been initialized yet");
  }
  return toTenantContext(row);
}

export function getAppContext(): AppContext {
  return {
    appName: APP_NAME,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    databasePath: getDatabasePath(),
    tenant: getCurrentTenant()
  };
}

export function getTenantProfile(): TenantRecord {
  requirePermission("business_profile", "view");
  const row = tenantRepository.findTenantRow();
  if (!row) {
    throw new Error("Tenant has not been initialized yet");
  }
  return tenantRepository.mapTenantRow(row, app.getVersion());
}

export function updateTenantProfile(input: unknown): TenantRecord {
  requirePermission("business_profile", "edit");
  const parsed = businessProfileInputSchema.parse(input);
  const existing = tenantRepository.findTenantRow();

  const row = tenantRepository.updateTenantProfileRow(parsed);

  if (existing?.business_logo_path && existing.business_logo_path !== parsed.businessLogoPath) {
    deleteManagedBusinessLogo(existing.business_logo_path);
  }

  // Best-effort, fire-and-forget — the local save above already succeeded and is the source of
  // truth regardless of whether this reaches the cloud right now. Never awaited/blocking; see
  // pushProfileToServer's own doc comment for why it can never throw.
  void pushProfileToServer({
    businessName: parsed.businessName,
    businessType: parsed.businessType,
    currency: parsed.currency,
    ownerName: parsed.ownerName,
    primaryPhone: parsed.primaryPhone,
    businessRegistrationNumber: parsed.businessRegistrationNumber,
    kraPin: parsed.kraPin,
    email: parsed.email,
    alternativePhone: parsed.alternativePhone,
    website: parsed.website,
    country: parsed.country,
    countyState: parsed.countyState,
    cityTown: parsed.cityTown,
    physicalAddress: parsed.physicalAddress,
    ownerPhone: parsed.ownerPhone,
    ownerEmail: parsed.ownerEmail,
    vatRatePercent: parsed.vatRatePercent,
    pricesTaxInclusive: parsed.pricesTaxInclusive
  });

  return tenantRepository.mapTenantRow(row, app.getVersion());
}

/** Copies the chosen logo into managed app storage so it survives the source file moving or being deleted. */
export async function pickBusinessLogoPath(): Promise<string | null> {
  requirePermission("business_profile", "edit");
  return pickAndStoreBusinessLogo();
}

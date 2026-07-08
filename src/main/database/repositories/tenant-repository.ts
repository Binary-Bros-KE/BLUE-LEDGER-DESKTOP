import { getDatabase } from "@main/database/connection";
import type { BusinessProfileInput } from "@shared/schemas/tenant";
import type { LogoRatio } from "@shared/types/logo";
import type {
  BusinessType,
  Currency,
  LicenseStatus,
  SubscriptionPlan,
  TenantRecord,
  TenantSyncStatus
} from "@shared/types/tenant";

export type TenantRow = {
  id: string;
  client_id: string;
  server_id: string | null;
  business_name: string;
  business_logo_path: string | null;
  business_logo_ratio: string | null;
  business_registration_number: string | null;
  kra_pin: string | null;
  primary_phone: string | null;
  alternative_phone: string | null;
  email: string | null;
  website: string | null;
  country: string | null;
  county_state: string | null;
  city_town: string | null;
  physical_address: string | null;
  business_type: string;
  currency: string;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  license_key: string | null;
  license_status: string;
  subscription_plan: string;
  subscription_start_date: string | null;
  subscription_expiry_date: string | null;
  max_branches: number;
  max_users: number;
  max_devices: number;
  developer_notes: string | null;
  is_demo_account: number;
  is_suspended: number;
  sync_status: string;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export function findTenantRow(): TenantRow | undefined {
  return getDatabase().prepare("SELECT * FROM tenant ORDER BY created_at LIMIT 1").get() as
    | TenantRow
    | undefined;
}

export function insertDefaultTenantRow(input: {
  id: string;
  clientId: string;
  businessName: string;
  currency: string;
  now: string;
}): TenantRow {
  getDatabase()
    .prepare(
      `
      INSERT INTO tenant (id, client_id, server_id, business_name, business_type, currency, created_at, updated_at)
      VALUES (?, ?, NULL, ?, 'other', ?, ?, ?)
    `
    )
    .run(input.id, input.clientId, input.businessName, input.currency, input.now, input.now);

  const row = findTenantRow();
  if (!row) {
    throw new Error("Failed to create default tenant record");
  }
  return row;
}

export function updateTenantProfileRow(input: BusinessProfileInput): TenantRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE tenant SET
        business_name = ?,
        business_logo_path = ?,
        business_logo_ratio = ?,
        business_registration_number = ?,
        kra_pin = ?,
        primary_phone = ?,
        alternative_phone = ?,
        email = ?,
        website = ?,
        country = ?,
        county_state = ?,
        city_town = ?,
        physical_address = ?,
        business_type = ?,
        currency = ?,
        owner_name = ?,
        owner_phone = ?,
        owner_email = ?,
        receipt_header = ?,
        receipt_footer = ?,
        sync_status = 'pending',
        updated_at = ?
      WHERE id = (SELECT id FROM tenant ORDER BY created_at LIMIT 1)
    `
    )
    .run(
      input.businessName,
      input.businessLogoPath,
      input.businessLogoRatio,
      input.businessRegistrationNumber,
      input.kraPin,
      input.primaryPhone,
      input.alternativePhone,
      input.email,
      input.website,
      input.country,
      input.countyState,
      input.cityTown,
      input.physicalAddress,
      input.businessType,
      input.currency,
      input.ownerName,
      input.ownerPhone,
      input.ownerEmail,
      input.receiptHeader,
      input.receiptFooter,
      now
    );

  const row = findTenantRow();
  if (!row) {
    throw new Error("Tenant record not found after update");
  }
  return row;
}

export function countPendingSyncRecords(): number {
  const row = getDatabase()
    .prepare("SELECT COUNT(*) as count FROM sync_outbox WHERE status IN ('queued', 'syncing')")
    .get() as { count: number };
  return row.count;
}

export function mapTenantRow(row: TenantRow, appVersion: string): TenantRecord {
  return {
    tenantId: row.id,
    clientId: row.client_id,
    serverId: row.server_id,
    businessName: row.business_name,
    businessLogoPath: row.business_logo_path,
    businessLogoRatio: row.business_logo_ratio as LogoRatio | null,
    businessRegistrationNumber: row.business_registration_number,
    kraPin: row.kra_pin,
    primaryPhone: row.primary_phone,
    alternativePhone: row.alternative_phone,
    email: row.email,
    website: row.website,
    country: row.country,
    countyState: row.county_state,
    cityTown: row.city_town,
    physicalAddress: row.physical_address,
    businessType: row.business_type as BusinessType,
    currency: row.currency as Currency,
    ownerName: row.owner_name,
    ownerPhone: row.owner_phone,
    ownerEmail: row.owner_email,
    receiptHeader: row.receipt_header,
    receiptFooter: row.receipt_footer,
    licenseKey: row.license_key,
    licenseStatus: row.license_status as LicenseStatus,
    subscriptionPlan: row.subscription_plan as SubscriptionPlan,
    subscriptionStartDate: row.subscription_start_date,
    subscriptionExpiryDate: row.subscription_expiry_date,
    maxBranches: row.max_branches,
    maxUsers: row.max_users,
    maxDevices: row.max_devices,
    appVersion,
    pendingSyncRecords: countPendingSyncRecords(),
    developerNotes: row.developer_notes,
    isDemoAccount: Boolean(row.is_demo_account),
    isSuspended: Boolean(row.is_suspended),
    syncStatus: row.sync_status as TenantSyncStatus,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

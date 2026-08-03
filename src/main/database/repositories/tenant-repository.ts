import { getDatabase } from "@main/database/connection";
import type { BusinessProfileInput } from "@shared/schemas/tenant";
import type { LogoRatio } from "@shared/types/logo";
import type {
  BusinessType,
  Currency,
  LicenseStatus,
  SubscriptionType,
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
  vat_rate_percent: number;
  prices_tax_inclusive: number;
  receipt_header: string | null;
  receipt_footer: string | null;
  license_key: string | null;
  license_status: string;
  subscription_plan: string;
  subscription_type: string | null;
  subscription_start_date: string | null;
  /// Legacy column, superseded by next_due_date below — kept (unused by new code) rather than
  /// dropped, since dropping a column already shipped to real installs is riskier than ignoring it.
  subscription_expiry_date: string | null;
  next_due_date: string | null;
  last_license_check_at: string | null;
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
  /// This device's own "when did I last actually edit my business profile" timestamp — compared
  /// against the cloud's own businessProfileUpdatedAt (from register/heartbeat) before ever
  /// overwriting local fields with a pulled copy. See migration v47's own comment for why this
  /// can't just reuse the shared updated_at column above.
  business_profile_updated_at: string | null;
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
        vat_rate_percent = ?,
        prices_tax_inclusive = ?,
        receipt_header = ?,
        receipt_footer = ?,
        sync_status = 'pending',
        updated_at = ?,
        business_profile_updated_at = ?
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
      input.vatRatePercent,
      input.pricesTaxInclusive ? 1 : 0,
      input.receiptHeader,
      input.receiptFooter,
      now,
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

export type WorkstationRow = {
  id: string;
  tenant_id: string;
  server_id: string | null;
  label: string;
  device_fingerprint: string | null;
  device_type: string;
  os_name: string | null;
  app_version: string | null;
  device_sequence: number | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

/** The untouched placeholder `ensureTenantContext()` inserts pre-activation — never overwritten
 * once the user (or a prior activation) has replaced it with anything else, including the "Device
 * {N}" label activation itself assigns. */
const DEFAULT_WORKSTATION_LABEL = "Device";

/** Every install has exactly one workstation row today — "which one" doesn't matter yet, so this
 * just takes the oldest, same convention as findTenantRow(). */
export function findPrimaryWorkstationRow(tenantId: string): WorkstationRow | undefined {
  return getDatabase()
    .prepare("SELECT * FROM workstations WHERE tenant_id = ? ORDER BY created_at LIMIT 1")
    .get(tenantId) as WorkstationRow | undefined;
}

/** Written once by a successful activation — server_id becomes this workstation's cloud Device id,
 * used on every heartbeat afterward. device_sequence is the permanent, never-reused ordinal the
 * server just assigned (see activation-service.ts's registerDevice) — also used here to rename the
 * label from its untouched "Device" placeholder to "Device {N}", but ONLY if it's still that exact
 * placeholder; a label the user already customized (or a previous activation already renamed) is
 * never overwritten. */
export function updateWorkstationActivationRow(
  id: string,
  input: { serverId: string; deviceSequence: number; osName: string | null; appVersion: string | null }
): void {
  const now = new Date().toISOString();
  const current = getDatabase().prepare("SELECT label FROM workstations WHERE id = ?").get(id) as
    | { label: string }
    | undefined;
  const nextLabel =
    current?.label === DEFAULT_WORKSTATION_LABEL ? `Device ${input.deviceSequence}` : (current?.label ?? DEFAULT_WORKSTATION_LABEL);

  getDatabase()
    .prepare(
      "UPDATE workstations SET server_id = ?, device_sequence = ?, label = ?, os_name = ?, app_version = ?, last_seen_at = ?, updated_at = ? WHERE id = ?"
    )
    .run(input.serverId, input.deviceSequence, nextLabel, input.osName, input.appVersion, now, now, id);
}

/** Backfills device_sequence for a workstation that activated BEFORE this field existed (its own
 * activation already happened, so updateWorkstationActivationRow won't run again) — called from
 * every heartbeat (see license-service.ts's checkInWithServer), same "cheap, no-op once already
 * set" pattern already used for tenantId there. Never overwrites an already-set value, and only
 * renames the label if it's still the untouched "Device" placeholder. */
export function backfillWorkstationDeviceSequenceRow(id: string, deviceSequence: number): void {
  const current = getDatabase().prepare("SELECT label, device_sequence FROM workstations WHERE id = ?").get(id) as
    | { label: string; device_sequence: number | null }
    | undefined;
  if (!current || current.device_sequence !== null) return;

  const now = new Date().toISOString();
  const nextLabel = current.label === DEFAULT_WORKSTATION_LABEL ? `Device ${deviceSequence}` : current.label;
  getDatabase()
    .prepare("UPDATE workstations SET device_sequence = ?, label = ?, updated_at = ? WHERE id = ?")
    .run(deviceSequence, nextLabel, now, id);
}

export function touchWorkstationHeartbeatRow(id: string, appVersion: string | null): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE workstations SET last_seen_at = ?, app_version = COALESCE(?, app_version), updated_at = ? WHERE id = ?")
    .run(now, appVersion, now, id);
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
    vatRatePercent: row.vat_rate_percent,
    pricesTaxInclusive: Boolean(row.prices_tax_inclusive),
    receiptHeader: row.receipt_header,
    receiptFooter: row.receipt_footer,
    licenseKey: row.license_key,
    licenseStatus: row.license_status as LicenseStatus,
    subscriptionPlan: row.subscription_plan,
    subscriptionType: row.subscription_type as SubscriptionType | null,
    subscriptionStartDate: row.subscription_start_date,
    nextDueDate: row.next_due_date,
    maxBranches: row.max_branches,
    maxUsers: row.max_users,
    maxDevices: row.max_devices,
    appVersion,
    pendingSyncRecords: countPendingSyncRecords(),
    developerNotes: row.developer_notes,
    isSuspended: Boolean(row.is_suspended),
    lastLicenseCheckAt: row.last_license_check_at,
    syncStatus: row.sync_status as TenantSyncStatus,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Written once by a successful activation (see license-service.ts), and refreshed on every
 * successful heartbeat afterward. Deliberately separate from updateTenantProfileRow — this is
 * cloud-owned data, never touched by the Business Profile form. businessType is deliberately NOT
 * synced here — the cloud and local BusinessType enums use entirely different value sets (e.g.
 * "RETAIL" vs "retail_shop"), so it stays a purely local, user-edited field. currency is safe to
 * sync since both sides use the identical KES/USD/UGX/TZS strings. */
export function updateTenantLicenseRow(input: {
  businessName?: string;
  currency?: string;
  /** The cloud Tenant.id, returned once by POST /activation/register. Set-once/immutable — COALESCE
   * in the SQL below means a later heartbeat call (which doesn't have this) never clobbers it with
   * null. Every cloud sync request needs this value to identify which tenant's rows it's touching. */
  serverId?: string;
  licenseKey: string;
  licenseStatus: string;
  subscriptionPlan: string;
  subscriptionType: string | null;
  subscriptionStartDate: string | null;
  nextDueDate: string | null;
  maxBranches: number;
  maxUsers: number;
  maxDevices: number;
  isSuspended: boolean;
}): TenantRow {
  const now = new Date().toISOString();
  const existing = findTenantRow();
  if (!existing) {
    throw new Error("Tenant record not found");
  }

  getDatabase()
    .prepare(
      `
      UPDATE tenant SET
        business_name = COALESCE(?, business_name),
        currency = COALESCE(?, currency),
        server_id = COALESCE(server_id, ?),
        license_key = ?,
        license_status = ?,
        subscription_plan = ?,
        subscription_type = ?,
        subscription_start_date = ?,
        next_due_date = ?,
        max_branches = ?,
        max_users = ?,
        max_devices = ?,
        is_suspended = ?,
        last_license_check_at = ?,
        updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.businessName ?? null,
      input.currency ?? null,
      input.serverId ?? null,
      input.licenseKey,
      input.licenseStatus,
      input.subscriptionPlan,
      input.subscriptionType,
      input.subscriptionStartDate,
      input.nextDueDate,
      input.maxBranches,
      input.maxUsers,
      input.maxDevices,
      input.isSuspended ? 1 : 0,
      now,
      now,
      existing.id
    );

  const row = findTenantRow();
  if (!row) {
    throw new Error("Tenant record not found after license update");
  }
  return row;
}

/** Called once, right after a fresh install's first successful activation — fills in whatever
 * business-profile fields the cloud already has on file (e.g. entered by the marketer at tenant
 * creation) without ever clobbering anything the tenant later typed locally. COALESCE(column, ?)
 * means "keep the existing value if it's already set, otherwise use the cloud's value" — the exact
 * "seed empty fields only" semantics this needs, deliberately different from
 * updateTenantProfileRow's unconditional overwrite (that one is a real user edit; this is a
 * one-time fill-in). */
export function seedBusinessProfileFieldsRow(input: {
  businessName: string;
  businessType: string;
  currency: string;
  ownerName: string | null;
  primaryPhone: string | null;
  businessRegistrationNumber: string | null;
  kraPin: string | null;
  email: string | null;
  alternativePhone: string | null;
  website: string | null;
  country: string | null;
  countyState: string | null;
  cityTown: string | null;
  physicalAddress: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  /** The cloud's own businessProfileUpdatedAt at register time, if it has one — stamped as this
   * device's OWN baseline too (only if not already set) so the very first heartbeat afterward has
   * something real to compare against instead of treating "never set" as "cloud is always newer"
   * and redundantly reapplying the same seed data it just wrote. */
  businessProfileUpdatedAt: string | null;
}): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `
      UPDATE tenant SET
        owner_name = COALESCE(owner_name, ?),
        primary_phone = COALESCE(primary_phone, ?),
        business_registration_number = COALESCE(business_registration_number, ?),
        kra_pin = COALESCE(kra_pin, ?),
        email = COALESCE(email, ?),
        alternative_phone = COALESCE(alternative_phone, ?),
        website = COALESCE(website, ?),
        country = COALESCE(country, ?),
        county_state = COALESCE(county_state, ?),
        city_town = COALESCE(city_town, ?),
        physical_address = COALESCE(physical_address, ?),
        owner_phone = COALESCE(owner_phone, ?),
        owner_email = COALESCE(owner_email, ?),
        updated_at = ?,
        business_profile_updated_at = COALESCE(business_profile_updated_at, ?)
      WHERE id = (SELECT id FROM tenant ORDER BY created_at LIMIT 1)
    `
    )
    .run(
      input.ownerName,
      input.primaryPhone,
      input.businessRegistrationNumber,
      input.kraPin,
      input.email,
      input.alternativePhone,
      input.website,
      input.country,
      input.countyState,
      input.cityTown,
      input.physicalAddress,
      input.ownerPhone,
      input.ownerEmail,
      now,
      input.businessProfileUpdatedAt
    );

  // businessName/businessType/currency are NEVER null locally (placeholder defaults from
  // insertDefaultTenantRow's own schema defaults), so a COALESCE like the fields above would be a
  // permanent no-op for these three — activation is also the one moment guaranteed to precede any
  // possible local edit (Business Profile can't be touched before an employee can log in, and login
  // itself is gated behind activation completing), so an unconditional set here is safe.
  getDatabase()
    .prepare(
      `
      UPDATE tenant SET business_name = ?, business_type = ?, currency = ?
      WHERE id = (SELECT id FROM tenant ORDER BY created_at LIMIT 1)
    `
    )
    .run(input.businessName, input.businessType, input.currency);
}

/** The pull side of Business Profile's own separate sync path (see migration v47's comment) — an
 * UNCONDITIONAL overwrite, unlike seedBusinessProfileFieldsRow's fill-empty-only semantics, since
 * the caller (checkInWithServer) has already confirmed the cloud's businessProfileUpdatedAt is
 * genuinely newer than this device's own before ever calling this. Does NOT set sync_status =
 * 'pending' — this data just came FROM the cloud, there's nothing new to push back. Stamps
 * business_profile_updated_at to the CLOUD's own timestamp (not `now()`), so it becomes the
 * correct baseline this device compares against next time, not a fresh "I just edited this" mark. */
export function applyBusinessProfileFromCloudRow(input: {
  businessName: string;
  businessType: string;
  currency: string;
  ownerName: string | null;
  primaryPhone: string | null;
  businessRegistrationNumber: string | null;
  kraPin: string | null;
  email: string | null;
  alternativePhone: string | null;
  website: string | null;
  country: string | null;
  countyState: string | null;
  cityTown: string | null;
  physicalAddress: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  vatRatePercent: number;
  pricesTaxInclusive: boolean;
  businessProfileUpdatedAt: string;
}): void {
  getDatabase()
    .prepare(
      `
      UPDATE tenant SET
        business_name = ?,
        business_type = ?,
        currency = ?,
        owner_name = ?,
        primary_phone = ?,
        business_registration_number = ?,
        kra_pin = ?,
        email = ?,
        alternative_phone = ?,
        website = ?,
        country = ?,
        county_state = ?,
        city_town = ?,
        physical_address = ?,
        owner_phone = ?,
        owner_email = ?,
        vat_rate_percent = ?,
        prices_tax_inclusive = ?,
        business_profile_updated_at = ?
      WHERE id = (SELECT id FROM tenant ORDER BY created_at LIMIT 1)
    `
    )
    .run(
      input.businessName,
      input.businessType,
      input.currency,
      input.ownerName,
      input.primaryPhone,
      input.businessRegistrationNumber,
      input.kraPin,
      input.email,
      input.alternativePhone,
      input.website,
      input.country,
      input.countyState,
      input.cityTown,
      input.physicalAddress,
      input.ownerPhone,
      input.ownerEmail,
      input.vatRatePercent,
      input.pricesTaxInclusive ? 1 : 0,
      input.businessProfileUpdatedAt
    );
}

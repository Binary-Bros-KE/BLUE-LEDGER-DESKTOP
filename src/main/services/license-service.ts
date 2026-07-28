import * as os from "node:os";
import electron from "electron";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { getCurrentTenant } from "@main/services/tenant-service";
import type { PaymentHistoryResult, PaymentScheduleResult } from "@shared/types/subscription-payment";
import type { TenantContext } from "@shared/types/tenant";

const { app } = electron;

/** The one place this app knows the cloud API's address. Set BLUE_LEDGER_API_URL in .env (loaded
 * via dotenv/config at the top of main/index.ts) — change that one value for staging/prod, nothing
 * else needs to change. Packaged builds still need a real deployment story for shipping a
 * production .env (e.g. electron-builder extraResources); not solved yet, dev-only for now.
 * Exported for reuse by sync-engine.ts — one source of truth for the API base, not two. */
export const API_BASE_URL = process.env.BLUE_LEDGER_API_URL ?? "http://localhost:4000";

/** Every business-profile field the cloud Tenant model now mirrors (see SERVER's
 * activation-service.ts) — pulled down once at register time to seed a fresh install (see
 * seedBusinessProfileFieldsRow), and the same shape pushed back up via pushProfileToServer below
 * whenever the tenant edits their local Business Profile. */
type CloudBusinessProfileFields = {
  // Real bug found live (2026-07-24): these three ARE editable on the local Business Profile screen
  // (see shared/schemas/tenant.ts's businessProfileInputSchema) but were never part of ANY push/
  // pull surface at all — not even the one-time registration seed. Editing them on one device
  // never reached the cloud or any other device, silently, forever.
  businessName: string;
  businessType: string;
  currency: string;
  ownerName: string | null;
  contactEmail: string;
  contactPhone: string | null;
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
  /** When the CLOUD last received a business-profile push, from any device — compared against this
   * device's own local `business_profile_updated_at` before ever overwriting anything, so a
   * dashboard-side (or another device's) edit only wins if it's genuinely newer. */
  businessProfileUpdatedAt: string | null;
};

type RegisterResponse = CloudBusinessProfileFields & {
  tenantId: string;
  deviceId: string;
  deviceSequence: number;
  licenseStatus: string;
  subscriptionType: string | null;
  planName: string;
  maxBranches: number;
  maxUsers: number;
  maxDevices: number;
};

type HeartbeatResponse = CloudBusinessProfileFields & {
  tenantId: string;
  deviceSequence: number;
  licenseStatus: string;
  nextDueDate: string | null;
  subscriptionType: string | null;
  planName: string;
  maxBranches: number;
  maxUsers: number;
  maxDevices: number;
};

function osDescription(): string {
  return `${os.type()} ${os.release()}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  if (!body) {
    throw new Error("The server returned an unreadable response");
  }
  return body;
}

/** First-time activation for a fresh install — called from the Activation screen (see
 * ActivationRoute.tsx / IPC channel activation:activate). Requires internet; there's no offline
 * path for a NEW install (only an already-activated one can keep running offline). */
export async function activateInstallation(licenseKey: string): Promise<TenantContext> {
  const trimmedKey = licenseKey.trim();
  if (!trimmedKey) {
    throw new Error("Enter your license key");
  }

  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("This installation hasn't finished setting up yet — restart the app and try again.");
  }
  const workstation = tenantRepository.findPrimaryWorkstationRow(tenantRow.id);
  if (!workstation) {
    throw new Error("This installation hasn't finished setting up yet — restart the app and try again.");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/activation/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: trimmedKey,
        deviceName: workstation.label,
        deviceType: "DESKTOP",
        osName: osDescription(),
        appVersion: app.getVersion()
      }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error("Couldn't reach Blue Ledger's servers. Check your internet connection and try again.");
  }

  const result = await parseJsonResponse<RegisterResponse>(response);

  tenantRepository.updateTenantLicenseRow({
    businessName: result.businessName,
    currency: result.currency,
    serverId: result.tenantId,
    licenseKey: trimmedKey,
    licenseStatus: result.licenseStatus.toLowerCase(),
    subscriptionPlan: result.planName,
    subscriptionType: result.subscriptionType?.toLowerCase() ?? null,
    nextDueDate: null,
    maxBranches: result.maxBranches,
    maxUsers: result.maxUsers,
    maxDevices: result.maxDevices,
    isSuspended: false
  });

  // Fill in whatever business-profile details the cloud already has on file (e.g. typed by the
  // marketer at tenant creation) — only into fields still empty locally, so this never clobbers
  // anything the tenant fills in afterward on their own Business Profile screen.
  tenantRepository.seedBusinessProfileFieldsRow({
    businessName: result.businessName,
    businessType: result.businessType,
    currency: result.currency,
    ownerName: result.ownerName,
    primaryPhone: result.contactPhone,
    businessRegistrationNumber: result.businessRegistrationNumber,
    kraPin: result.kraPin,
    email: result.email,
    alternativePhone: result.alternativePhone,
    website: result.website,
    country: result.country,
    countyState: result.countyState,
    cityTown: result.cityTown,
    physicalAddress: result.physicalAddress,
    ownerPhone: result.ownerPhone,
    ownerEmail: result.ownerEmail,
    businessProfileUpdatedAt: result.businessProfileUpdatedAt
  });

  tenantRepository.updateWorkstationActivationRow(workstation.id, {
    serverId: result.deviceId,
    deviceSequence: result.deviceSequence,
    osName: osDescription(),
    appVersion: app.getVersion()
  });

  return getCurrentTenant();
}

/** Best-effort periodic re-check — called once at boot and safe to call again later (e.g. a
 * future "check now" button, or a timer). Never throws: no internet, an unreachable server, or any
 * other failure is completely expected and just means "keep working off whatever was last cached."
 * A suspended/cancelled response (403) is the one case that DOES get written locally, so the app
 * can react on its next restart or permission check even without a live connection at that moment. */
export async function checkInWithServer(): Promise<void> {
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow?.license_key) return;

  const workstation = tenantRepository.findPrimaryWorkstationRow(tenantRow.id);
  if (!workstation?.server_id) return;

  try {
    const response = await fetch(`${API_BASE_URL}/activation/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: tenantRow.license_key,
        deviceId: workstation.server_id,
        appVersion: app.getVersion()
      }),
      signal: AbortSignal.timeout(8_000)
    });

    if (response.status === 403) {
      // The server has explicitly told us this license is no longer usable — worth recording even
      // though we don't have the exact new status string in a well-typed shape here.
      tenantRepository.updateTenantLicenseRow({
        licenseKey: tenantRow.license_key,
        licenseStatus: "suspended",
        subscriptionPlan: tenantRow.subscription_plan,
        subscriptionType: tenantRow.subscription_type,
        nextDueDate: tenantRow.next_due_date,
        maxBranches: tenantRow.max_branches,
        maxUsers: tenantRow.max_users,
        maxDevices: tenantRow.max_devices,
        isSuspended: true
      });
      return;
    }

    const result = await parseJsonResponse<HeartbeatResponse>(response);
    tenantRepository.updateTenantLicenseRow({
      // Backfills any install that activated before this field started being persisted (see
      // updateTenantLicenseRow's own COALESCE — a no-op once it's already set).
      serverId: result.tenantId,
      licenseKey: tenantRow.license_key,
      licenseStatus: result.licenseStatus.toLowerCase(),
      subscriptionPlan: result.planName,
      subscriptionType: result.subscriptionType?.toLowerCase() ?? null,
      nextDueDate: result.nextDueDate,
      maxBranches: result.maxBranches,
      maxUsers: result.maxUsers,
      maxDevices: result.maxDevices,
      isSuspended: result.licenseStatus === "SUSPENDED"
    });
    tenantRepository.backfillWorkstationDeviceSequenceRow(workstation.id, result.deviceSequence);
    tenantRepository.touchWorkstationHeartbeatRow(workstation.id, app.getVersion());

    // Business Profile's own pull side — see Tenant.businessProfileUpdatedAt's (SERVER) and
    // migration v47's (DESKTOP) comments for why this needs its own dedicated timestamp instead of
    // reusing tenant.updated_at (bumped moments ago by updateTenantLicenseRow above, for a reason
    // that has nothing to do with the profile). Only apply the cloud's copy if it's genuinely newer
    // than this device's own last local edit — never a blind overwrite, matching the "don't clobber
    // a newer local edit" guard every other synced entity in this app already has.
    if (result.businessProfileUpdatedAt) {
      const currentTenantRow = tenantRepository.findTenantRow();
      const localTimestamp = currentTenantRow?.business_profile_updated_at;
      const cloudIsNewer =
        !localTimestamp || new Date(result.businessProfileUpdatedAt).getTime() > new Date(localTimestamp).getTime();
      if (cloudIsNewer) {
        tenantRepository.applyBusinessProfileFromCloudRow({
          businessName: result.businessName,
          businessType: result.businessType,
          currency: result.currency,
          ownerName: result.ownerName,
          primaryPhone: result.contactPhone,
          businessRegistrationNumber: result.businessRegistrationNumber,
          kraPin: result.kraPin,
          email: result.email,
          alternativePhone: result.alternativePhone,
          website: result.website,
          country: result.country,
          countyState: result.countyState,
          cityTown: result.cityTown,
          physicalAddress: result.physicalAddress,
          ownerPhone: result.ownerPhone,
          ownerEmail: result.ownerEmail,
          businessProfileUpdatedAt: result.businessProfileUpdatedAt
        });
      }
    }
  } catch {
    // No internet / server unreachable / timed out — exactly the case this app must keep working
    // through. Silently skip; last cached state stands until the next successful check-in.
  }
}

/** Renderer-invokable wrapper (see IPC channel activation:heartbeat) — called every time the
 * employee login screen is reached (fresh app start, or a logout), not just on the shared 20s
 * interval, so a license suspended moments ago is caught close to live instead of only on next
 * restart. Still fully non-blocking-safe: checkInWithServer() itself never throws, so this always
 * returns the freshest available context, live or cached. */
export async function heartbeatAndGetContext(): Promise<TenantContext> {
  await checkInWithServer();
  return getCurrentTenant();
}

/** The push side of the business-profile sync (register/heartbeat above are the pull side — see
 * checkInWithServer's own recency-guarded pull, which only applies a heartbeat's copy when it's
 * genuinely newer than this device's own last local edit). Called by tenant-service.ts's
 * updateTenantProfile() every time the tenant saves their local Business Profile. Fire-and-forget
 * by design: the local save already succeeded and is authoritative regardless of whether this
 * reaches the cloud right now, and there is no user-visible action waiting on its result. */
export async function pushProfileToServer(profile: {
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
}): Promise<void> {
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow?.license_key) return;

  try {
    await fetch(`${API_BASE_URL}/activation/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: tenantRow.license_key,
        // Server field is `name`, not `businessName` — same renaming convention as
        // primaryPhone -> contactPhone right below.
        name: profile.businessName,
        businessType: profile.businessType,
        currency: profile.currency,
        ownerName: profile.ownerName,
        contactPhone: profile.primaryPhone,
        businessRegistrationNumber: profile.businessRegistrationNumber,
        kraPin: profile.kraPin,
        email: profile.email,
        alternativePhone: profile.alternativePhone,
        website: profile.website,
        country: profile.country,
        countyState: profile.countyState,
        cityTown: profile.cityTown,
        physicalAddress: profile.physicalAddress,
        ownerPhone: profile.ownerPhone,
        ownerEmail: profile.ownerEmail
      }),
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    // No internet / server unreachable — expected and fine. The next successful profile save (or
    // a future explicit retry) pushes the same data again; nothing is lost since local stays
    // authoritative.
  }
}

/** Renderer-invokable (see IPC channel activation:payments) — lets the desktop show "your last 5
 * payments" plus anything still outstanding, acting as the client's own view of their invoices.
 * Returns null (rather than throwing) when unreachable, so the UI can show "unable to load" instead
 * of an error boundary — this is a read, never something that should block or crash the screen. */
export async function fetchPaymentHistory(): Promise<PaymentHistoryResult | null> {
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow?.license_key) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/activation/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey: tenantRow.license_key }),
      signal: AbortSignal.timeout(8_000)
    });
    return await parseJsonResponse<PaymentHistoryResult>(response);
  } catch {
    return null;
  }
}

/** Renderer-invokable — the "Jan ✅ Feb ✅ Mar ❌" calendar plus per-period pricing for the "pay in
 * advance" picker (see PayNowModal.tsx / BusinessProfileRoute.tsx). Same null-on-failure contract
 * as fetchPaymentHistory above. */
export async function fetchPaymentSchedule(): Promise<PaymentScheduleResult | null> {
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow?.license_key) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/activation/payment-schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey: tenantRow.license_key }),
      signal: AbortSignal.timeout(8_000)
    });
    return await parseJsonResponse<PaymentScheduleResult>(response);
  } catch {
    return null;
  }
}

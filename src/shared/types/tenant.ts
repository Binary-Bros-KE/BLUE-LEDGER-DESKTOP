import type { LogoRatio } from "./logo";

export type TenantId = string;
export type ClientId = string;
export type ServerId = string;
export type WorkstationId = string;

export const BUSINESS_TYPE_OPTIONS = [
  { value: "retail_shop", label: "Retail Shop" },
  { value: "wholesale_shop", label: "Wholesale Shop" },
  { value: "retail_and_wholesale", label: "Retail & Wholesale" },
  { value: "restaurant", label: "Restaurant" },
  { value: "hotel", label: "Hotel" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "electronics", label: "Electronics" },
  { value: "hardware", label: "Hardware" },
  { value: "general_store", label: "General Store" },
  { value: "supermarket", label: "Supermarket" },
  { value: "other", label: "Other" }
] as const;

export type BusinessType = (typeof BUSINESS_TYPE_OPTIONS)[number]["value"];

export const CURRENCY_OPTIONS = [
  { value: "KES", label: "KES — Kenyan Shilling" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "UGX", label: "UGX — Ugandan Shilling" },
  { value: "TZS", label: "TZS — Tanzanian Shilling" }
] as const;

export type Currency = (typeof CURRENCY_OPTIONS)[number]["value"];

/** Mirrors the cloud registry's License.status exactly (see SERVER/prisma/schema.prisma) — no
 * "expired" here; a license doesn't expire on its own, it's explicitly suspended or cancelled. */
export type LicenseStatus = "trial" | "active" | "suspended" | "cancelled";
export type TenantSyncStatus = "pending" | "synced" | "syncing" | "error";

/** Mirrors the cloud registry's Subscription.subscriptionType — drives the grace-period policy in
 * shared/lib/grace-period.ts: only "monthly" ever hard-locks the POS once its grace period lapses;
 * "lifetime"/"custom" (one-time purchase + yearly maintenance fee) only ever lose sync. */
export type SubscriptionType = "monthly" | "lifetime" | "custom";

/** Editable fields the business owner manages from the Business Profile settings page. */
export type BusinessProfile = {
  businessName: string;
  businessLogoPath: string | null;
  businessLogoRatio: LogoRatio | null;
  businessRegistrationNumber: string | null;
  kraPin: string | null;
  primaryPhone: string | null;
  alternativePhone: string | null;
  email: string | null;
  website: string | null;
  country: string | null;
  countyState: string | null;
  cityTown: string | null;
  physicalAddress: string | null;
  businessType: BusinessType;
  currency: Currency;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
};

/** Read-only fields owned by the online admin dashboard (SERVER/NEXT/admin), pulled in via
 * activation + periodic heartbeat — see main/services/license-service.ts. subscriptionPlan is a
 * plain string (the cloud Plan's own name, e.g. "Duka" or a one-off custom plan) rather than a
 * fixed enum, since plans are admin-defined on the dashboard, not a closed set baked into this app. */
export type TenantManagement = {
  licenseKey: string | null;
  licenseStatus: LicenseStatus;
  subscriptionPlan: string;
  subscriptionType: SubscriptionType | null;
  subscriptionStartDate: string | null;
  /** Rolling next-due date, not a fixed contract expiry — see the cloud Subscription model. */
  nextDueDate: string | null;
  maxBranches: number;
  maxUsers: number;
  maxDevices: number;
  appVersion: string;
  pendingSyncRecords: number;
  developerNotes: string | null;
  isSuspended: boolean;
  /** Last time this install successfully heard back from the server — null until the first
   * activation/heartbeat ever succeeds. Never blocks the app on its own; see license-service.ts for
   * the offline grace-period policy that reads it. */
  lastLicenseCheckAt: string | null;
};

export type TenantRecord = BusinessProfile &
  TenantManagement & {
    tenantId: TenantId;
    clientId: ClientId;
    serverId: ServerId | null;
    syncStatus: TenantSyncStatus;
    lastSyncedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };

/** Lightweight tenant snapshot used for app boot / sidebar display, and receipt rendering. */
export type TenantContext = {
  tenantId: TenantId;
  clientId: ClientId;
  serverId: ServerId | null;
  workstationId: WorkstationId;
  businessName: string;
  businessLogoPath: string | null;
  physicalAddress: string | null;
  primaryPhone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  currency: Currency;
  /** True once this install has a real license key from the cloud registry — App.tsx gates the
   * entire app on this, before even the employee login screen. False means "freshly installed,
   * never activated" (licenseKey is still null). */
  activated: boolean;
  /** Cached from the last successful activation/heartbeat — App.tsx blocks the app outright when
   * this is "suspended" or "cancelled", which is the actual enforcement point for a revoked
   * license. Never re-derived locally; only a real server response ever changes it. */
  licenseStatus: LicenseStatus;
  /** Rolling next-due date + subscription type — the two inputs to the 30-day grace-period policy
   * (see shared/lib/grace-period.ts). Same cached-from-last-server-response guarantee as
   * licenseStatus above. */
  nextDueDate: string | null;
  subscriptionType: SubscriptionType | null;
  createdAt: string;
  updatedAt: string;
};

export type AppContext = {
  appName: string;
  appVersion: string;
  isPackaged: boolean;
  databasePath: string;
  tenant: TenantContext;
};

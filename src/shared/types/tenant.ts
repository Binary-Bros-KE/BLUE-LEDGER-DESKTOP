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

export type LicenseStatus = "trial" | "active" | "expired" | "suspended";
export type SubscriptionPlan = "free" | "starter" | "pro" | "enterprise";
export type TenantSyncStatus = "pending" | "synced" | "syncing" | "error";

/** Editable fields the business owner manages from the Business Profile settings page. */
export type BusinessProfile = {
  businessName: string;
  businessLogoPath: string | null;
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

/** Read-only fields intended to be owned by the future online management dashboard. */
export type TenantManagement = {
  licenseKey: string | null;
  licenseStatus: LicenseStatus;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStartDate: string | null;
  subscriptionExpiryDate: string | null;
  maxBranches: number;
  maxUsers: number;
  maxDevices: number;
  appVersion: string;
  pendingSyncRecords: number;
  developerNotes: string | null;
  isDemoAccount: boolean;
  isSuspended: boolean;
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

/** Lightweight tenant snapshot used for app boot / sidebar display. */
export type TenantContext = {
  tenantId: TenantId;
  clientId: ClientId;
  serverId: ServerId | null;
  workstationId: WorkstationId;
  businessName: string;
  businessLogoPath: string | null;
  currency: Currency;
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

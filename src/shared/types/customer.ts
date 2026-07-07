export type CustomerId = string;

export const CUSTOMER_TYPE_OPTIONS = [
  { value: "retail", label: "Retail" },
  { value: "wholesale", label: "Wholesale" },
  { value: "corporate", label: "Corporate" },
  { value: "walk_in", label: "Walk-In" }
] as const;

export type CustomerType = (typeof CUSTOMER_TYPE_OPTIONS)[number]["value"];

export const CUSTOMER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUS_OPTIONS)[number]["value"];

export type CustomerSyncStatus = "pending" | "synced" | "syncing" | "error";

export type CustomerInputFields = {
  name: string;
  phone: string;
  customerType: CustomerType;
  email: string | null;
  physicalAddress: string | null;
  creditLimitCents: number | null;
  notes: string | null;
};

export type Customer = CustomerInputFields & {
  id: CustomerId;
  tenantId: string;
  customerCode: string;
  currentBalanceCents: number;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
  syncStatus: CustomerSyncStatus;
  lastSyncedAt: string | null;
};

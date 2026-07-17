export type RiderId = string;

export const RIDER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
] as const;

export type RiderStatus = (typeof RIDER_STATUS_OPTIONS)[number]["value"];

export type RiderSyncStatus = "pending" | "synced" | "syncing" | "error";

export type RiderInputFields = {
  name: string;
  phone: string;
  altPhone: string | null;
  company: string | null;
  vehicleDescription: string | null;
};

/** A delivery courier assigned to a sale/invoice/quotation's delivery — never deleted, only
 * deactivated, since past delivery notes will reference a rider by id. */
export type Rider = RiderInputFields & {
  id: RiderId;
  tenantId: string;
  status: RiderStatus;
  createdAt: string;
  updatedAt: string;
  syncStatus: RiderSyncStatus;
  lastSyncedAt: string | null;
};

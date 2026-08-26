export type WorkingHoursSyncStatus = "pending" | "synced" | "syncing" | "error";

export type WorkingHoursLockMode = "auto" | "manual";

export type WorkingHoursScheduleDay = { isOpen: boolean; openTime: string | null; closeTime: string | null };

/** Keyed "0".."6" — 0=Sunday..6=Saturday, matches JS Date.getDay(). */
export type WorkingHoursSchedule = Record<string, WorkingHoursScheduleDay>;

export type WorkingHoursInputFields = {
  lockEnabled: boolean;
  lockMode: WorkingHoursLockMode;
  manuallyLocked: boolean;
  timezoneOffsetMinutes: number;
  schedule: WorkingHoursSchedule;
};

export type WorkingHours = WorkingHoursInputFields & {
  id: string;
  tenantId: string;
  locationId: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: WorkingHoursSyncStatus;
  lastSyncedAt: string | null;
};

/** One row per storefront for the Working Hours settings screen's picker — `config: null` means
 * that storefront has never been configured (always-open by default). */
export type WorkingHoursStorefrontEntry = { locationId: string; locationName: string; config: WorkingHours | null };

import type { WorkingHoursSchedule } from "@shared/types/working-hours";

export type WorkingHoursConfig = {
  lockEnabled: boolean;
  lockMode: string;
  manuallyLocked: boolean;
  timezoneOffsetMinutes: number;
  schedule: WorkingHoursSchedule;
};

export type WorkingHoursLockStatus = { locked: false } | { locked: true; reason: "manual" | "outside_hours" };

/**
 * PORTED (not shared code) from SERVER's own src/lib/working-hours-lock.ts of the same name —
 * update both together if this logic ever changes. Pure — no I/O beyond the defaulted `now` param —
 * mirrors grace-period.ts's own style/reasoning: this app is offline-first, so the lock decision must
 * be computable entirely from a locally-synced WorkingHours row + the device's own clock, never a
 * server round trip.
 *
 * `config: null` means this storefront has never had working hours configured — never locked; a
 * tenant that hasn't opted into this feature at all sees no behavior change.
 */
export function computeWorkingHoursLockStatus(config: WorkingHoursConfig | null, now: Date = new Date()): WorkingHoursLockStatus {
  if (!config || !config.lockEnabled) return { locked: false };

  if (config.lockMode === "manual") {
    return config.manuallyLocked ? { locked: true, reason: "manual" } : { locked: false };
  }

  // "auto" mode — shift `now` by the storefront's own stored UTC offset so the day-of-week/hour/
  // minute read below reflect the STOREFRONT's local wall clock, not this device's own system
  // timezone (which is usually correct for DESKTOP, physically at the storefront, but this keeps the
  // exact same arithmetic as SERVER's ported copy rather than two subtly different implementations).
  const localNow = new Date(now.getTime() - config.timezoneOffsetMinutes * 60_000);
  const dayOfWeek = localNow.getUTCDay();
  const day = config.schedule[String(dayOfWeek)];
  if (!day || !day.isOpen || !day.openTime || !day.closeTime) {
    return { locked: true, reason: "outside_hours" };
  }

  const minutesNow = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const [openH, openM] = day.openTime.split(":").map(Number);
  const [closeH, closeM] = day.closeTime.split(":").map(Number);
  const openMinutes = (openH ?? 0) * 60 + (openM ?? 0);
  const closeMinutes = (closeH ?? 0) * 60 + (closeM ?? 0);

  // closeMinutes <= openMinutes means the window crosses midnight (e.g. 18:00-02:00) — "within
  // hours" then means AFTER open OR BEFORE close, not a plain between-check.
  const withinHours =
    closeMinutes > openMinutes ? minutesNow >= openMinutes && minutesNow < closeMinutes : minutesNow >= openMinutes || minutesNow < closeMinutes;

  return withinHours ? { locked: false } : { locked: true, reason: "outside_hours" };
}

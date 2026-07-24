import type { SubscriptionType } from "@shared/types/tenant";

const GRACE_PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type GraceStatus =
  | { state: "current" }
  | { state: "grace"; daysRemaining: number; hardLock: boolean }
  | { state: "expired"; hardLock: boolean };

/** Pure function so both the login-page warning banner and App.tsx's hard-lock gate compute the
 * identical answer from the same cached TenantContext fields — no extra IPC round trip needed just
 * to know "how many days are left", and it still works fully offline since it's driven by the
 * device's own clock, not a live check. Only a MONTHLY subscription ever hard-locks the POS once
 * its 30-day grace period lapses; LIFETIME/CUSTOM (the one-time-purchase + yearly maintenance fee
 * crowd) get the same warning but the client was explicit that "POS will continue working just
 * fine, is only sync that will not work" for them. */
export function computeGraceStatus(
  nextDueDate: string | null,
  subscriptionType: SubscriptionType | null,
  now: Date = new Date()
): GraceStatus {
  if (!nextDueDate) {
    return { state: "current" };
  }

  const due = new Date(nextDueDate);
  const msPastDue = now.getTime() - due.getTime();
  if (msPastDue <= 0) {
    return { state: "current" };
  }

  const hardLock = subscriptionType === "monthly";
  const daysPastDue = Math.floor(msPastDue / MS_PER_DAY);
  const daysRemaining = GRACE_PERIOD_DAYS - daysPastDue;

  if (daysRemaining > 0) {
    return { state: "grace", daysRemaining, hardLock };
  }
  return { state: "expired", hardLock };
}

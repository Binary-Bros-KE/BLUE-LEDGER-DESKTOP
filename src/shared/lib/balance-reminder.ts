import type { LicenseStatus } from "@shared/types/tenant";

/** How many days before a due date a short balance is mentioned. */
export const BALANCE_REMINDER_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type BalanceReminder = {
  dueDate: string;
  daysUntilDue: number;
  balanceCents: number;
  priceCents: number;
  shortByCents: number;
};

/**
 * "Your balance won't cover the next payment" — the prepaid balance (SERVER subscription-wallet-
 * service.ts) pays each period automatically on its due date, so the only thing worth saying ahead of
 * time is when it won't be enough. Pure, from the last check-in's cached fields, so it works offline.
 *
 * Only for a business that has topped up (a balance above zero): one that never uses the balance keeps
 * exactly the warnings it always had. Nothing during a trial, nothing once it's overdue (the grace
 * warning in shared/lib/grace-period.ts takes over), nothing more than BALANCE_REMINDER_DAYS ahead.
 */
export function computeBalanceReminder(
  tenant: {
    nextDueDate: string | null;
    walletBalanceCents: number | null;
    pricePerPeriodCents: number | null;
    licenseStatus?: LicenseStatus | undefined;
  },
  now: Date = new Date()
): BalanceReminder | null {
  const { nextDueDate, walletBalanceCents: balance, pricePerPeriodCents: price } = tenant;
  if (tenant.licenseStatus === "trial" || !nextDueDate || balance === null || balance <= 0 || !price || price <= 0) return null;
  if (balance >= price) return null;
  const msUntilDue = new Date(nextDueDate).getTime() - now.getTime();
  if (msUntilDue <= 0) return null;
  const daysUntilDue = Math.ceil(msUntilDue / MS_PER_DAY);
  if (daysUntilDue > BALANCE_REMINDER_DAYS) return null;
  return { dueDate: nextDueDate, daysUntilDue, balanceCents: balance, priceCents: price, shortByCents: price - balance };
}

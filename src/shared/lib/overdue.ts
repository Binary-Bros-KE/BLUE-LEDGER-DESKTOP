const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days since an invoice's due date, at least 1 — counted day to day in local time, so
 * an invoice due yesterday is 1 day overdue whatever the hour. Copied in APP (src/lib/overdue.ts). */
export function daysOverdue(dueDate: string, now: Date = new Date()): number {
  const due = new Date(dueDate);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(1, Math.round((today - dueDay) / MS_PER_DAY));
}

/** What an overdue invoice's status pill says instead of "Overdue": "1 day", "30 days". */
export function overdueLabel(dueDate: string, now: Date = new Date()): string {
  const days = daysOverdue(dueDate, now);
  return `${days} day${days === 1 ? "" : "s"}`;
}

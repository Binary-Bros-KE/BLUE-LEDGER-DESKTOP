export const RECURRING_BILL_CYCLE_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" }
] as const;

export type RecurringBillCycle = (typeof RECURRING_BILL_CYCLE_OPTIONS)[number]["value"];

export const RECURRING_BILL_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" }
] as const;

export type RecurringBillStatus = (typeof RECURRING_BILL_STATUS_OPTIONS)[number]["value"];

/** A scheduling/reminder record that becomes a real Expense the moment it's marked paid — see
 * markRecurringBillPaid() in recurring-bill-service.ts. "Push to Next Cycle" (advanceRecurringBill())
 * remains for the rare case it needs rolling forward without having been paid. */
export type RecurringBillInputFields = {
  name: string;
  categoryId: string;
  storefrontId: string;
  amountCents: number;
  cycle: RecurringBillCycle;
  startDate: string;
  notes: string | null;
};

export type RecurringBillReminderStatus = "overdue" | "due_soon" | "upcoming";

export type RecurringBill = RecurringBillInputFields & {
  id: string;
  tenantId: string;
  nextDueDate: string;
  status: RecurringBillStatus;
  categoryName: string;
  storefrontName: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Computed fresh at read time against "today" — never stored. */
  reminderStatus: RecurringBillReminderStatus;
  daysUntilDue: number;
};

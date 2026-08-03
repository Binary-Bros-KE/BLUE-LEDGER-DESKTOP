export type ExpenseId = string;

/** "general" = a formal expense (rent, wifi, salaries paid as a cash expense entry, etc.) — visible
 * only to whoever holds "expenses" permission. "local_purchase" = a small day-to-day buy (tape,
 * delivery bags, a pen) — visible to whoever holds the separate, narrower "local_purchases"
 * permission (typically Cashiers), who never get "expenses" itself. Decided entirely by which
 * service function/permission path created the row — never a user-editable form field, so a cashier
 * has no way to mislabel a local purchase into the general list or vice versa. */
export type ExpenseKind = "general" | "local_purchase";

export const EXPENSE_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" }
] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUS_OPTIONS)[number]["value"];

export type ExpenseSyncStatus = "pending" | "synced" | "syncing" | "error";

/** Reserved for a future recurring-expense feature (rent, subscriptions, etc.) — the columns exist
 * now so the schema never needs to change later, but nothing currently reads or writes them beyond
 * carrying the values through. No automatic generation happens yet. */
export const RECURRENCE_FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" }
] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCY_OPTIONS)[number]["value"];

export type ExpenseInputFields = {
  expenseDate: string;
  categoryId: string;
  amountCents: number;
  paidBy: string | null;
  paymentMethodId: string;
  /** Never null — every expense belongs to a real storefront, no "General/Head Office" catch-all. */
  storefrontId: string;
  reference: string | null;
  description: string | null;
  attachmentPath: string | null;
};

/** Money leaving the business for operational costs — entirely independent of Sales, Purchases,
 * Inventory, Customers, and Suppliers, and never affects stock levels. */
export type Expense = ExpenseInputFields & {
  id: ExpenseId;
  tenantId: string;
  kind: ExpenseKind;
  /** Auto-generated at creation (e.g. EXP-000001). */
  expenseNumber: string;
  categoryName: string;
  paymentMethodName: string;
  storefrontName: string;
  status: ExpenseStatus;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency | null;
  nextDueDate: string | null;
  lastReminderSent: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: ExpenseSyncStatus;
  lastSyncedAt: string | null;
};

/** Lightweight row for the Expenses table — the same fields as Expense, just named for list display. */
export type ExpenseListItem = Expense;

export type ExpenseCategoryBreakdown = {
  categoryId: string;
  categoryName: string;
  totalCents: number;
};

export type ExpenseSummary = {
  todayCents: number;
  thisMonthCents: number;
  totalCents: number;
  byCategory: ExpenseCategoryBreakdown[];
};

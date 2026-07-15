export type ExpenseCategoryId = string;

export const EXPENSE_CATEGORY_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" }
] as const;

export type ExpenseCategoryStatus = (typeof EXPENSE_CATEGORY_STATUS_OPTIONS)[number]["value"];

export type ExpenseCategorySyncStatus = "pending" | "synced" | "syncing" | "error";

export type ExpenseCategoryInputFields = {
  name: string;
  description: string | null;
};

/** A spending bucket for Expenses — never deleted once referenced, since historical expense records
 * point at it by id; only its visibility toggles via status. */
export type ExpenseCategory = ExpenseCategoryInputFields & {
  id: ExpenseCategoryId;
  tenantId: string;
  status: ExpenseCategoryStatus;
  createdAt: string;
  updatedAt: string;
  syncStatus: ExpenseCategorySyncStatus;
  lastSyncedAt: string | null;
};

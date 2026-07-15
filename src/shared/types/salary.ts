export type SalaryId = string;

export const SALARY_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "voided", label: "Voided" }
] as const;

export type SalaryStatus = (typeof SALARY_STATUS_OPTIONS)[number]["value"];

export type SalarySyncStatus = "pending" | "synced" | "syncing" | "error";

/** One named line within an allowance or deduction breakdown — e.g. "Transport Allowance" /
 * "PAYE" — rather than a single opaque total. */
export type SalaryLineItem = {
  name: string;
  amountCents: number;
};

export type SalaryInputFields = {
  employeeId: string;
  payPeriod: string;
  basicSalaryCents: number;
  allowances: SalaryLineItem[];
  deductions: SalaryLineItem[];
  paymentMethodId: string;
  paymentReference: string | null;
  notes: string | null;
};

/**
 * A single processed payroll run for one employee, in one pay period — its own immutable ledger
 * (like Sales/Stock Movements), never edited in place. If pay terms change later, the correction
 * is a new row for the next period; a mistaken entry is voided rather than deleted, so payroll
 * history is always complete.
 */
export type Salary = SalaryInputFields & {
  id: SalaryId;
  tenantId: string;
  /** Auto-generated at creation (e.g. PAY-000001). */
  payslipNumber: string;
  employeeName: string;
  employeeCode: string;
  /** Sums of the itemized allowances/deductions above — kept alongside the breakdown for quick
   * aggregate reporting without parsing the line items. */
  allowancesCents: number;
  deductionsCents: number;
  netPayCents: number;
  paymentMethodName: string;
  status: SalaryStatus;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SalarySyncStatus;
  lastSyncedAt: string | null;
};

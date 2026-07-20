export type SalaryId = string;

export const SALARY_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Complete" },
  { value: "voided", label: "Voided" }
] as const;

export type SalaryStatus = (typeof SALARY_STATUS_OPTIONS)[number]["value"];

export type SalarySyncStatus = "pending" | "synced" | "syncing" | "error";

/** One named line within an allowance or deduction breakdown — e.g. "Transport Allowance" /
 * "PAYE" — rather than a single opaque total. Also how a mid-month salary advance/loan is recorded:
 * a deduction line (e.g. "Advance — 15 Jul") on a draft payslip, honored when it's later completed. */
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
  paymentMethodId: string | null;
  paymentReference: string | null;
  notes: string | null;
};

/**
 * A single payroll run for one employee, in one pay period. Two ways into existence: `createSalary`
 * processes and pays it atomically in one step (the historical/default flow — immediately `active`,
 * from then on treated as an immutable ledger entry, corrected by voiding rather than editing). OR
 * `createSalaryAdvance` opens it as a `draft` mid-month (e.g. to record a cash advance as a deduction
 * against pay not yet calculated) with no basic salary/payment method yet, and `completeSalary` later
 * fills in the rest and flips it to `active` — the only case where a row is legitimately edited in
 * place, since nothing was actually disbursed until completion.
 */
export type Salary = SalaryInputFields & {
  id: SalaryId;
  tenantId: string;
  /** Auto-generated at creation (e.g. PAY-000001), reserved from the draft stage onward. */
  payslipNumber: string;
  employeeName: string;
  employeeCode: string;
  /** Sums of the itemized allowances/deductions above — kept alongside the breakdown for quick
   * aggregate reporting without parsing the line items. */
  allowancesCents: number;
  deductionsCents: number;
  /** Can be negative for a draft (deductions recorded with no basic salary yet) — never negative
   * once `active`, enforced at completion time. */
  netPayCents: number;
  paymentMethodName: string | null;
  status: SalaryStatus;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: SalarySyncStatus;
  lastSyncedAt: string | null;
};

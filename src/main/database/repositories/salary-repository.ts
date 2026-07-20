import { getDatabase } from "@main/database/connection";
import type { SalaryInput } from "@shared/schemas/salary";
import type { Salary, SalaryLineItem, SalaryStatus, SalarySyncStatus } from "@shared/types/salary";

export type SalaryRow = {
  id: string;
  tenant_id: string;
  payslip_number: string;
  employee_id: string;
  pay_period: string;
  basic_salary_cents: number;
  allowances_cents: number;
  deductions_cents: number;
  allowances_json: string;
  deductions_json: string;
  net_pay_cents: number;
  payment_method_id: string | null;
  payment_reference: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sync_status: string;
  last_synced_at: string | null;
};

export type SalaryDetailRow = SalaryRow & {
  employee_name: string;
  employee_code: string;
  payment_method_name: string | null;
  created_by_name: string | null;
};

/** LEFT JOIN on payment_methods — a draft row has no payment method yet (nothing's been disbursed
 * until it's completed), so an INNER JOIN would silently hide drafts from every list/detail read. */
const DETAIL_SELECT = `
  SELECT
    s.*,
    (e.first_name || ' ' || e.last_name) AS employee_name,
    e.employee_code AS employee_code,
    pm.name AS payment_method_name,
    (creator.first_name || ' ' || creator.last_name) AS created_by_name
  FROM salaries s
  JOIN employees e ON e.id = s.employee_id
  LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
  LEFT JOIN employees creator ON creator.id = s.created_by
`;

/** Every payslip, newest first — the full HR ledger. Callers must have already verified the
 * requester is allowed to see everyone's records; this repository has no notion of "self". Pass
 * locationId to further narrow to one branch's own employees (a branch-scoped Manager's view);
 * null sees every branch (Super Admin). */
export function findAllSalaryDetailRows(tenantId: string, locationId: string | null): SalaryDetailRow[] {
  return getDatabase()
    .prepare(`${DETAIL_SELECT} WHERE s.tenant_id = ? AND (? IS NULL OR e.branch_id = ?) ORDER BY s.created_at DESC`)
    .all(tenantId, locationId, locationId) as SalaryDetailRow[];
}

/** One employee's own payslips, newest first — the self-view path. */
export function findSalaryDetailRowsForEmployee(tenantId: string, employeeId: string): SalaryDetailRow[] {
  return getDatabase()
    .prepare(`${DETAIL_SELECT} WHERE s.tenant_id = ? AND s.employee_id = ? ORDER BY s.created_at DESC`)
    .all(tenantId, employeeId) as SalaryDetailRow[];
}

export function findMaxPayslipNumberRow(tenantId: string): string | null {
  const row = getDatabase()
    .prepare(
      "SELECT MAX(payslip_number) as maxNumber FROM salaries WHERE tenant_id = ? AND payslip_number LIKE 'PAY-%'"
    )
    .get(tenantId) as { maxNumber: string | null };
  return row.maxNumber;
}

export function findActiveSalaryForEmployeePeriodRow(
  tenantId: string,
  employeeId: string,
  payPeriod: string,
  excludeId?: string
): SalaryRow | undefined {
  const excludeClause = excludeId ? "AND id != ?" : "";
  const params = excludeId
    ? [tenantId, employeeId, payPeriod, excludeId]
    : [tenantId, employeeId, payPeriod];
  return getDatabase()
    .prepare(
      `SELECT * FROM salaries WHERE tenant_id = ? AND employee_id = ? AND pay_period = ? AND status = 'active' ${excludeClause}`
    )
    .get(...params) as SalaryRow | undefined;
}

/** Same lookup, but any non-voided status (draft or active) — used before opening a NEW draft, so an
 * employee never ends up with two open (draft or active) records for the same pay period. */
export function findOpenSalaryForEmployeePeriodRow(
  tenantId: string,
  employeeId: string,
  payPeriod: string
): SalaryRow | undefined {
  return getDatabase()
    .prepare(
      "SELECT * FROM salaries WHERE tenant_id = ? AND employee_id = ? AND pay_period = ? AND status IN ('draft', 'active')"
    )
    .get(tenantId, employeeId, payPeriod) as SalaryRow | undefined;
}

export function findSalaryRowById(id: string): SalaryRow | undefined {
  return getDatabase().prepare("SELECT * FROM salaries WHERE id = ?").get(id) as SalaryRow | undefined;
}

export function findSalaryDetailRowById(id: string): SalaryDetailRow | undefined {
  return getDatabase().prepare(`${DETAIL_SELECT} WHERE s.id = ?`).get(id) as SalaryDetailRow | undefined;
}

export function insertSalaryRow(
  input: Omit<SalaryInput, "paymentMethodId"> & {
    id: string;
    tenantId: string;
    payslipNumber: string;
    allowancesCents: number;
    deductionsCents: number;
    netPayCents: number;
    paymentMethodId: string | null;
    status: SalaryStatus;
    createdBy: string | null;
  }
): SalaryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO salaries (
        id, tenant_id, payslip_number, employee_id, pay_period, basic_salary_cents, allowances_cents,
        deductions_cents, allowances_json, deductions_json, net_pay_cents, payment_method_id,
        payment_reference, status, notes, created_by, created_at, updated_at, sync_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `
    )
    .run(
      input.id,
      input.tenantId,
      input.payslipNumber,
      input.employeeId,
      input.payPeriod,
      input.basicSalaryCents,
      input.allowancesCents,
      input.deductionsCents,
      JSON.stringify(input.allowances),
      JSON.stringify(input.deductions),
      input.netPayCents,
      input.paymentMethodId,
      input.paymentReference,
      input.status,
      input.notes,
      input.createdBy,
      now,
      now
    );

  const row = findSalaryRowById(input.id);
  if (!row) {
    throw new Error("Failed to create salary record");
  }
  return row;
}

/** Completes a draft in place — the only case a salary row is legitimately edited after creation.
 * Always sets status to 'active'; the caller has already validated a full, non-negative payslip. */
export function completeSalaryRow(
  id: string,
  input: {
    basicSalaryCents: number;
    allowancesCents: number;
    deductionsCents: number;
    allowances: SalaryLineItem[];
    deductions: SalaryLineItem[];
    netPayCents: number;
    paymentMethodId: string;
    paymentReference: string | null;
    notes: string | null;
  }
): SalaryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      UPDATE salaries
      SET basic_salary_cents = ?, allowances_cents = ?, deductions_cents = ?, allowances_json = ?,
        deductions_json = ?, net_pay_cents = ?, payment_method_id = ?, payment_reference = ?,
        notes = ?, status = 'active', sync_status = 'pending', updated_at = ?
      WHERE id = ?
    `
    )
    .run(
      input.basicSalaryCents,
      input.allowancesCents,
      input.deductionsCents,
      JSON.stringify(input.allowances),
      JSON.stringify(input.deductions),
      input.netPayCents,
      input.paymentMethodId,
      input.paymentReference,
      input.notes,
      now,
      id
    );

  const row = findSalaryRowById(id);
  if (!row) {
    throw new Error("Salary not found after completion");
  }
  return row;
}

export function setSalaryStatusRow(id: string, status: SalaryStatus): SalaryRow {
  const now = new Date().toISOString();

  getDatabase()
    .prepare("UPDATE salaries SET status = ?, sync_status = 'pending', updated_at = ? WHERE id = ?")
    .run(status, now, id);

  const row = findSalaryRowById(id);
  if (!row) {
    throw new Error("Salary not found after status update");
  }
  return row;
}

/** Hard-deletes a draft — safe only for drafts, since nothing has actually been disbursed yet. An
 * active/voided salary is never deleted (voided is the correction path for those). */
export function deleteSalaryRow(id: string): void {
  getDatabase().prepare("DELETE FROM salaries WHERE id = ?").run(id);
}

function parseSalaryLineItems(raw: string): SalaryLineItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SalaryLineItem[]) : [];
  } catch {
    return [];
  }
}

export function mapSalaryDetailRow(row: SalaryDetailRow): Salary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    payslipNumber: row.payslip_number,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeCode: row.employee_code,
    payPeriod: row.pay_period,
    basicSalaryCents: row.basic_salary_cents,
    allowancesCents: row.allowances_cents,
    deductionsCents: row.deductions_cents,
    allowances: parseSalaryLineItems(row.allowances_json),
    deductions: parseSalaryLineItems(row.deductions_json),
    netPayCents: row.net_pay_cents,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name,
    paymentReference: row.payment_reference,
    status: row.status as SalaryStatus,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status as SalarySyncStatus,
    lastSyncedAt: row.last_synced_at
  };
}

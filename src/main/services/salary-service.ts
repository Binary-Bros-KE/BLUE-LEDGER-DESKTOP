import { randomUUID } from "node:crypto";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as salaryRepository from "@main/database/repositories/salary-repository";
import {
  getCurrentBranchScope,
  getCurrentEmployeeId,
  hasPermission,
  requirePermission,
  requireSignedIn
} from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { salaryAdvanceInputSchema, salaryInputSchema, type SalaryAdvanceInput, type SalaryInput } from "@shared/schemas/salary";
import type { Salary } from "@shared/types/salary";

function generatePayslipNumber(tenantId: string): string {
  const maxNumber = salaryRepository.findMaxPayslipNumberRow(tenantId);
  const currentNumber = maxNumber ? Number(maxNumber.slice("PAY-".length)) : 0;
  const nextNumber = Number.isFinite(currentNumber) ? currentNumber + 1 : 1;
  return `PAY-${String(nextNumber).padStart(6, "0")}`;
}

function assertEmployeeExists(tenantId: string, employeeId: string): void {
  const row = employeeRepository.findEmployeeRowById(employeeId);
  if (!row || row.tenant_id !== tenantId) {
    throw new Error("Employee not found");
  }
}

/** A branch-scoped caller (a Manager) can only ever process, complete, void, restore, or delete a
 * salary for an employee in THEIR OWN branch — never another storefront's, even with a known record
 * id. Only Super Admin (no branch assigned) can act across branches. */
function assertEmployeeInBranchScope(employeeId: string, branchScope: string | null): void {
  if (!branchScope) return;
  const employeeRow = employeeRepository.findEmployeeRowById(employeeId);
  if (employeeRow?.branch_id !== branchScope) {
    throw new Error("You can only manage salaries for your own branch");
  }
}

function assertValidPaymentMethod(tenantId: string, input: SalaryInput): void {
  const method = paymentMethodRepository.findPaymentMethodRowById(input.paymentMethodId);
  if (!method || method.tenant_id !== tenantId) {
    throw new Error("Payment method not found");
  }
  if (!method.is_active) {
    throw new Error(`"${method.name}" is not active`);
  }
  if (method.requires_reference && !input.paymentReference) {
    throw new Error(`${method.name} requires a transaction/reference number`);
  }
}

/** Checked before opening a new record (create or restore) — an employee should never end up with
 * two open (draft or active) salary rows for the same pay period at once. A draft found here means
 * "complete that one instead of starting a new one," which is exactly the nudge the caller wants. */
function assertNoDuplicatePeriod(tenantId: string, employeeId: string, payPeriod: string): void {
  const existing = salaryRepository.findOpenSalaryForEmployeePeriodRow(tenantId, employeeId, payPeriod);
  if (existing) {
    const described = existing.status === "draft" ? "an open draft" : "a processed salary";
    throw new Error(`This employee already has ${described} for ${payPeriod}`);
  }
}

/** Full HR visibility — seeing (and generating PDFs for) every employee's payslip requires either
 * managing payroll ("edit") or reviewing it for accounting purposes ("export"). Plain "view" only
 * grants access to the tab itself; the data returned is always self-scoped without one of these. */
function hasFullVisibility(): boolean {
  return hasPermission("salaries", "edit") || hasPermission("salaries", "export");
}

function getSalaryDetail(id: string): Salary {
  const row = salaryRepository.findSalaryDetailRowById(id);
  if (!row) {
    throw new Error("Salary record not found");
  }
  return salaryRepository.mapSalaryDetailRow(row);
}

/**
 * Every signed-in employee can call this — the scope is decided here, server-side, not by the UI:
 * HR roles (edit/export on salaries) get the full ledger, everyone else gets only their own
 * payslips. This is the actual security boundary — the renderer's admin/self layout is just a
 * presentation choice on top of whatever this function already filtered. A branch-scoped HR role
 * (a Manager) still only gets their OWN branch's ledger, never every storefront's — only Super
 * Admin (no branch assigned) sees everyone.
 */
export function listSalaries(): Salary[] {
  requireSignedIn();
  const { tenantId } = getCurrentTenant();

  if (hasFullVisibility()) {
    const locationId = getCurrentBranchScope();
    return salaryRepository.findAllSalaryDetailRows(tenantId, locationId).map(salaryRepository.mapSalaryDetailRow);
  }

  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }
  return salaryRepository.findSalaryDetailRowsForEmployee(tenantId, employeeId).map(salaryRepository.mapSalaryDetailRow);
}

/** Same boundary as listSalaries(), enforced per-record — an employee can fetch (and later
 * generate a PDF for) their own payslip by id, but never another employee's; a branch-scoped
 * Manager can fetch anyone's IN their own branch, but never another storefront's employee. */
export function getSalary(id: string): Salary {
  requireSignedIn();
  const salary = getSalaryDetail(id);

  if (!hasFullVisibility() && salary.employeeId !== getCurrentEmployeeId()) {
    throw new Error("You don't have permission to view this payslip");
  }

  const branchScope = getCurrentBranchScope();
  if (hasFullVisibility() && branchScope) {
    const employeeRow = employeeRepository.findEmployeeRowById(salary.employeeId);
    if (employeeRow?.branch_id !== branchScope) {
      throw new Error("You don't have permission to view this payslip");
    }
  }
  return salary;
}

/** Creates and immediately "pays" a salary record — there's no draft/approval workflow here, since
 * recording it IS the act of processing payroll (matching how a completed Sale works). */
export function createSalary(input: unknown): Salary {
  requirePermission("salaries", "create");
  const parsed: SalaryInput = salaryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const createdBy = getCurrentEmployeeId();

  assertEmployeeExists(tenantId, parsed.employeeId);
  assertEmployeeInBranchScope(parsed.employeeId, getCurrentBranchScope());
  assertValidPaymentMethod(tenantId, parsed);
  assertNoDuplicatePeriod(tenantId, parsed.employeeId, parsed.payPeriod);

  const allowancesCents = parsed.allowances.reduce((sum, item) => sum + item.amountCents, 0);
  const deductionsCents = parsed.deductions.reduce((sum, item) => sum + item.amountCents, 0);
  const netPayCents = parsed.basicSalaryCents + allowancesCents - deductionsCents;

  const row = salaryRepository.insertSalaryRow({
    ...parsed,
    id: `salary_${randomUUID()}`,
    tenantId,
    payslipNumber: generatePayslipNumber(tenantId),
    allowancesCents,
    deductionsCents,
    netPayCents,
    status: "active",
    createdBy
  });
  return getSalaryDetail(row.id);
}

/**
 * Opens a draft mid-month — e.g. to record a cash advance/loan as a deduction against pay that
 * hasn't been calculated yet. No basic salary, allowances, or payment method exist yet (nothing's
 * actually been disbursed for the period as a whole), so net pay is simply the negative of whatever
 * deductions are recorded — expected to be negative, that's the point. `completeSalary` later fills
 * in the rest and flips this same row to `active`.
 */
export function createSalaryAdvance(input: unknown): Salary {
  requirePermission("salaries", "create");
  const parsed: SalaryAdvanceInput = salaryAdvanceInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const createdBy = getCurrentEmployeeId();

  assertEmployeeExists(tenantId, parsed.employeeId);
  assertEmployeeInBranchScope(parsed.employeeId, getCurrentBranchScope());
  assertNoDuplicatePeriod(tenantId, parsed.employeeId, parsed.payPeriod);

  const deductionsCents = parsed.deductions.reduce((sum, item) => sum + item.amountCents, 0);

  const row = salaryRepository.insertSalaryRow({
    employeeId: parsed.employeeId,
    payPeriod: parsed.payPeriod,
    basicSalaryCents: 0,
    allowances: [],
    deductions: parsed.deductions,
    paymentMethodId: null,
    paymentReference: null,
    notes: parsed.notes,
    id: `salary_${randomUUID()}`,
    tenantId,
    payslipNumber: generatePayslipNumber(tenantId),
    allowancesCents: 0,
    deductionsCents,
    netPayCents: -deductionsCents,
    status: "draft",
    createdBy
  });
  return getSalaryDetail(row.id);
}

/** Fills in the rest of a draft (basic salary, allowances, payment method) and flips it to `active`
 * — the deductions submitted here become the FINAL set (the caller pre-fills the form with the
 * draft's existing deductions, e.g. the advance, so the admin adds to that list rather than starting
 * over). Net pay is validated non-negative here, same as a normal createSalary. */
export function completeSalary(id: string, input: unknown): Salary {
  requirePermission("salaries", "edit");
  const parsed: SalaryInput = salaryInputSchema.parse(input);
  const { tenantId } = getCurrentTenant();

  const existing = salaryRepository.findSalaryRowById(id);
  if (!existing) {
    throw new Error("Salary record not found");
  }
  if (existing.status !== "draft") {
    throw new Error("This payslip has already been processed");
  }
  if (existing.employee_id !== parsed.employeeId || existing.pay_period !== parsed.payPeriod) {
    throw new Error("Employee and pay period can't be changed while completing a draft");
  }
  assertEmployeeInBranchScope(existing.employee_id, getCurrentBranchScope());

  assertValidPaymentMethod(tenantId, parsed);

  const allowancesCents = parsed.allowances.reduce((sum, item) => sum + item.amountCents, 0);
  const deductionsCents = parsed.deductions.reduce((sum, item) => sum + item.amountCents, 0);
  const netPayCents = parsed.basicSalaryCents + allowancesCents - deductionsCents;

  const row = salaryRepository.completeSalaryRow(id, {
    basicSalaryCents: parsed.basicSalaryCents,
    allowancesCents,
    deductionsCents,
    allowances: parsed.allowances,
    deductions: parsed.deductions,
    netPayCents,
    paymentMethodId: parsed.paymentMethodId,
    paymentReference: parsed.paymentReference,
    notes: parsed.notes
  });
  return getSalaryDetail(row.id);
}

/** Hard-deletes an unwanted/mistaken draft — safe only because nothing's actually been disbursed
 * yet. An active or voided salary is never deleted this way; voiding is the correction path there. */
export function deleteSalaryAdvance(id: string): void {
  requirePermission("salaries", "delete");
  const existing = salaryRepository.findSalaryRowById(id);
  if (!existing) {
    throw new Error("Salary record not found");
  }
  if (existing.status !== "draft") {
    throw new Error("Only a draft can be deleted — void a processed payslip instead");
  }
  assertEmployeeInBranchScope(existing.employee_id, getCurrentBranchScope());
  salaryRepository.deleteSalaryRow(id);
}

/** Voids a mistaken entry without deleting it — the payslip stays visible (marked Voided) so the
 * payroll trail is never silently erased, matching the rest of Blue Ledger's financial records. */
export function voidSalary(id: string): Salary {
  requirePermission("salaries", "delete");
  const existing = salaryRepository.findSalaryRowById(id);
  if (!existing) {
    throw new Error("Salary record not found");
  }
  assertEmployeeInBranchScope(existing.employee_id, getCurrentBranchScope());

  const row = salaryRepository.setSalaryStatusRow(id, "voided");
  return getSalaryDetail(row.id);
}

export function restoreSalary(id: string): Salary {
  requirePermission("salaries", "edit");
  const { tenantId } = getCurrentTenant();
  const existing = salaryRepository.findSalaryRowById(id);
  if (!existing) {
    throw new Error("Salary record not found");
  }
  assertEmployeeInBranchScope(existing.employee_id, getCurrentBranchScope());

  assertNoDuplicatePeriod(tenantId, existing.employee_id, existing.pay_period);

  const row = salaryRepository.setSalaryStatusRow(id, "active");
  return getSalaryDetail(row.id);
}

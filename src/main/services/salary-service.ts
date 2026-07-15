import { randomUUID } from "node:crypto";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as paymentMethodRepository from "@main/database/repositories/payment-method-repository";
import * as salaryRepository from "@main/database/repositories/salary-repository";
import {
  getCurrentEmployeeId,
  hasPermission,
  requirePermission,
  requireSignedIn
} from "@main/services/auth-service";
import { getCurrentTenant } from "@main/services/tenant-service";
import { salaryInputSchema, type SalaryInput } from "@shared/schemas/salary";
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

function assertNoDuplicatePeriod(
  tenantId: string,
  employeeId: string,
  payPeriod: string,
  excludeId?: string
): void {
  const existing = salaryRepository.findActiveSalaryForEmployeePeriodRow(tenantId, employeeId, payPeriod, excludeId);
  if (existing) {
    throw new Error(`This employee already has a processed salary for ${payPeriod}`);
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
 * presentation choice on top of whatever this function already filtered.
 */
export function listSalaries(): Salary[] {
  requireSignedIn();
  const { tenantId } = getCurrentTenant();

  if (hasFullVisibility()) {
    return salaryRepository.findAllSalaryDetailRows(tenantId).map(salaryRepository.mapSalaryDetailRow);
  }

  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }
  return salaryRepository.findSalaryDetailRowsForEmployee(tenantId, employeeId).map(salaryRepository.mapSalaryDetailRow);
}

/** Same boundary as listSalaries(), enforced per-record — an employee can fetch (and later
 * generate a PDF for) their own payslip by id, but never another employee's. */
export function getSalary(id: string): Salary {
  requireSignedIn();
  const salary = getSalaryDetail(id);

  if (!hasFullVisibility() && salary.employeeId !== getCurrentEmployeeId()) {
    throw new Error("You don't have permission to view this payslip");
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
    createdBy
  });
  return getSalaryDetail(row.id);
}

/** Voids a mistaken entry without deleting it — the payslip stays visible (marked Voided) so the
 * payroll trail is never silently erased, matching the rest of Blue Ledger's financial records. */
export function voidSalary(id: string): Salary {
  requirePermission("salaries", "delete");
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

  assertNoDuplicatePeriod(tenantId, existing.employee_id, existing.pay_period, id);

  const row = salaryRepository.setSalaryStatusRow(id, "active");
  return getSalaryDetail(row.id);
}

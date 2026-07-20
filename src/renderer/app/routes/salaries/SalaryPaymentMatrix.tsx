import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Search, Users } from "lucide-react";
import type { Salary } from "@shared/types/salary";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The POS itself started operating in 2026 — there's no salary history before that, so the matrix
 * starts there and simply grows a new row each January instead of always padding out a fixed lookback
 * window (which would show empty pre-2026 years for years to come). */
const BASE_YEAR = 2026;

type CellStatus = "paid" | "pending" | "future";

type EmployeeMatrixRow = {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  paidSalaryByPeriod: Map<string, Salary>;
};

function cellStatus(year: number, month: number, currentYear: number, currentMonth: number, paidSalaryByPeriod: Map<string, Salary>): CellStatus {
  if (year > currentYear || (year === currentYear && month > currentMonth)) return "future";
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  return paidSalaryByPeriod.has(periodKey) ? "paid" : "pending";
}

/** A separate matrix — years (since BASE_YEAR, current on top) x months — showing whether each
 * employee was actually paid ("active" salary) for that period, distinct from the plain transaction
 * list above it. A pending cell for any month before the current one counts as overdue, since salaries
 * recur monthly just like a recurring bill. "Future" months (after the current one) are dashes —
 * there's nothing to report on yet. Only "active" salaries count as paid; a draft or voided one still
 * shows pending. A non-privileged viewer's `salaries` is already server-scoped to just their own
 * records (see listSalaries() in salary-service.ts), so this naturally renders as a single-employee
 * table for them without any extra filtering here. */
export function SalaryPaymentMatrix({
  salaries,
  onViewPayslip
}: {
  salaries: Salary[];
  onViewPayslip: (salary: Salary) => void;
}): React.JSX.Element | null {
  const [searchTerm, setSearchTerm] = useState("");

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const years = useMemo(() => {
    const lastYear = Math.max(BASE_YEAR, currentYear);
    return Array.from({ length: lastYear - BASE_YEAR + 1 }, (_, index) => lastYear - index);
  }, [currentYear]);

  const employeeRows = useMemo(() => {
    const byEmployee = new Map<string, EmployeeMatrixRow>();
    for (const salary of salaries) {
      const entry = byEmployee.get(salary.employeeId) ?? {
        employeeId: salary.employeeId,
        employeeName: salary.employeeName,
        employeeCode: salary.employeeCode,
        paidSalaryByPeriod: new Map<string, Salary>()
      };
      if (salary.status === "active") entry.paidSalaryByPeriod.set(salary.payPeriod, salary);
      byEmployee.set(salary.employeeId, entry);
    }
    return [...byEmployee.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  }, [salaries]);

  const overdueCount = useMemo(() => {
    let count = 0;
    for (const employee of employeeRows) {
      for (const year of years) {
        for (let month = 1; month <= 12; month += 1) {
          if (year === currentYear && month >= currentMonth) continue;
          if (year > currentYear) continue;
          if (cellStatus(year, month, currentYear, currentMonth, employee.paidSalaryByPeriod) === "pending") count += 1;
        }
      }
    }
    return count;
  }, [employeeRows, years, currentYear, currentMonth]);

  const filteredEmployees = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return employeeRows;
    return employeeRows.filter((employee) => `${employee.employeeName} ${employee.employeeCode}`.toLowerCase().includes(term));
  }, [employeeRows, searchTerm]);

  if (employeeRows.length === 0) return null;

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Team</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <Users className="size-5 text-primary" aria-hidden="true" />
            Salary Payment History
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Every employee, every month — green means paid, a gray clock means still pending.
          </p>
        </div>
        <label className="block sm:max-w-xs">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search employee..."
              className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </div>
        </label>
      </div>

      {overdueCount > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-bold text-warning">
          <AlertTriangle className="size-4 flex-none" aria-hidden="true" />
          {overdueCount} overdue salary {overdueCount === 1 ? "month" : "months"} across the team — a past month with
          no completed payslip.
        </div>
      )}

      <div className="mt-5 space-y-3">
        {filteredEmployees.map((employee) => (
          <div key={employee.employeeId} className="overflow-hidden rounded-lg border-2 border-line border-primary/60 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-soft/60 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-ink">{employee.employeeName}</p>
                <p className="text-[11px] font-semibold text-muted">{employee.employeeCode}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="w-16 px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Year</th>
                    {MONTH_LABELS.map((label) => (
                      <th key={label} className="px-2 py-2 text-center text-[10px] font-extrabold uppercase tracking-wider">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => (
                    <tr key={year} className="border-t border-line odd:bg-white even:bg-soft/40">
                      <td className="px-3 py-2 font-bold text-ink">{year}</td>
                      {MONTH_LABELS.map((_, index) => {
                        const month = index + 1;
                        const status = cellStatus(year, month, currentYear, currentMonth, employee.paidSalaryByPeriod);
                        const periodKey = `${year}-${String(month).padStart(2, "0")}`;
                        const salaryForPeriod = employee.paidSalaryByPeriod.get(periodKey);
                        return (
                          <td key={month} className="px-2 py-2 text-center">
                            {status === "paid" && salaryForPeriod && (
                              <button
                                type="button"
                                onClick={() => onViewPayslip(salaryForPeriod)}
                                title={`View ${salaryForPeriod.payslipNumber}`}
                                className="cursor-pointer rounded p-0.5 transition hover:bg-success/15"
                              >
                                <CheckCircle2 className="inline size-4 text-success" aria-label="Paid — click to view payslip" />
                              </button>
                            )}
                            {status === "pending" && <Clock className="inline size-4 text-muted/50" aria-label="Pending" />}
                            {status === "future" && <span className="text-muted/40">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

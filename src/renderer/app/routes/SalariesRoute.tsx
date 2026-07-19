import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Plus, Search, Wallet } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { SelectField } from "@renderer/shared/components/form-fields";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getDashboardVariant } from "@renderer/shared/lib/dashboard-role";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import type { EmployeeListItem } from "@shared/types/employee";
import type { ExportListRequest } from "@shared/types/export";
import { isStorefrontType, type Location } from "@shared/types/location";
import type { PaymentMethod } from "@shared/types/payment-method";
import type { Salary } from "@shared/types/salary";
import { PayslipModal } from "./salaries/PayslipModal";
import { SalaryFormModal } from "./salaries/SalaryFormModal";

function formatPayPeriodLabel(payPeriod: string): string {
  try {
    const [year, month] = payPeriod.split("-").map(Number);
    return new Date(year ?? 0, (month ?? 1) - 1, 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });
  } catch {
    return payPeriod;
  }
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

export function SalariesRoute(): React.JSX.Element {
  const { can, session } = usePermissions();
  const canProcess = can("salaries", "create");
  const canViewAll = can("salaries", "edit") || can("salaries", "export");
  const canVoid = can("salaries", "delete");
  const canRestore = can("salaries", "edit");
  const canExport = can("salaries", "export");
  const isSuperAdmin = getDashboardVariant(session) === "superAdmin";

  const [salaries, setSalaries] = useState<Salary[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [storefrontFilter, setStorefrontFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [viewingSalary, setViewingSalary] = useState<Salary | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [salaryList, methodList, locationList] = await Promise.all([
        window.blueLedger.salary.list(),
        window.blueLedger.paymentMethod.list(),
        window.blueLedger.location.list()
      ]);
      setSalaries(salaryList);
      setPaymentMethods(methodList);
      setLocations(locationList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load salaries"));
    }
    // Requires "salaries:create" server-side — kept separate so a viewer-only role (canViewAll but
    // not canProcess) doesn't fail the whole page load just because this narrower list is off-limits.
    try {
      const employeeList = await window.blueLedger.employee.listForSalaryPicker();
      setEmployees(employeeList);
    } catch {
      setEmployees([]);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const storefronts = useMemo(
    () => locations.filter((location) => isStorefrontType(location.locationType)),
    [locations]
  );

  const employeeBranchById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const employee of employees) {
      map.set(employee.id, employee.branchId);
    }
    return map;
  }, [employees]);

  const filteredSalaries = useMemo(() => {
    if (!salaries) return null;
    let list = salaries;

    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      list = list.filter((salary) => new Date(salary.createdAt).getTime() >= fromTime);
    }
    if (dateTo) {
      const toTime = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
      list = list.filter((salary) => new Date(salary.createdAt).getTime() <= toTime);
    }
    if (employeeFilter) {
      list = list.filter((salary) => salary.employeeId === employeeFilter);
    }
    if (isSuperAdmin && storefrontFilter) {
      list = list.filter((salary) => employeeBranchById.get(salary.employeeId) === storefrontFilter);
    }

    const term = searchTerm.trim().toLowerCase();
    if (!term) return list;
    return list.filter((salary) => {
      const haystack = `${salary.payslipNumber} ${salary.employeeName} ${salary.payPeriod}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [salaries, searchTerm, dateFrom, dateTo, employeeFilter, storefrontFilter, isSuperAdmin, employeeBranchById]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredSalaries) return null;
    const filterParts: string[] = [];
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);
    if (dateFrom || dateTo) filterParts.push(`Date: ${dateFrom || "…"} to ${dateTo || "…"}`);
    if (employeeFilter) {
      filterParts.push(`Employee: ${employees.find((e) => e.id === employeeFilter)?.firstName ?? employeeFilter}`);
    }
    if (isSuperAdmin && storefrontFilter) {
      filterParts.push(`Storefront: ${storefronts.find((s) => s.id === storefrontFilter)?.locationName ?? storefrontFilter}`);
    }

    return {
      module: "salaries",
      title: "Employee Salaries",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "Every processed payroll record",
      columns: canViewAll
        ? [
            { key: "payslipNumber", header: "Payslip #" },
            { key: "employee", header: "Employee" },
            { key: "payPeriod", header: "Pay Period" },
            { key: "netPay", header: "Net Pay", align: "right" },
            { key: "paymentMethod", header: "Payment Method" },
            { key: "status", header: "Status" }
          ]
        : [
            { key: "payslipNumber", header: "Payslip #" },
            { key: "payPeriod", header: "Pay Period" },
            { key: "netPay", header: "Net Pay", align: "right" },
            { key: "paymentMethod", header: "Payment Method" },
            { key: "status", header: "Status" }
          ],
      rows: filteredSalaries.map((salary) => ({
        payslipNumber: salary.payslipNumber,
        employee: salary.employeeName,
        payPeriod: formatPayPeriodLabel(salary.payPeriod),
        netPay: formatCents(salary.netPayCents),
        paymentMethod: salary.paymentMethodName,
        status: salary.status === "active" ? "Active" : "Voided"
      })),
      fileBaseName: `Salaries_${new Date().toISOString().slice(0, 10)}`
    };
  }, [
    filteredSalaries,
    canViewAll,
    searchTerm,
    dateFrom,
    dateTo,
    employeeFilter,
    storefrontFilter,
    isSuperAdmin,
    employees,
    storefronts
  ]);

  async function refreshViewing(): Promise<void> {
    await loadAll();
    if (viewingSalary) {
      const updated = await window.blueLedger.salary.get(viewingSalary.id);
      setViewingSalary(updated);
    }
  }

  async function handleProcessed(salary: Salary): Promise<void> {
    await loadAll();
    setViewingSalary(salary);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
      <span
        className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Team</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Wallet className="size-5 text-primary" aria-hidden="true" />
              Employee Salaries
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              {canViewAll
                ? "Every processed payroll record, newest first."
                : "Your own payslips — you can view and download these, but not anyone else's."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canExport && exportRequest && <ExportMenu request={exportRequest} />}
            {canProcess && (
              <Button type="button" onClick={() => setFormOpen(true)} className="h-9 text-xs">
                <Plus className="mr-1.5 size-4" aria-hidden="true" />
                Process Salary
              </Button>
            )}
          </div>
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError}
          </div>
        )}

        {salaries !== null && salaries.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block sm:max-w-xs sm:flex-1">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search payslip #, employee, or pay period"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="mt-1.5 h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="mt-1.5 h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </label>
            {canViewAll && employees.length > 0 && (
              <SelectField
                label="Employee"
                value={employeeFilter}
                onChange={setEmployeeFilter}
                options={[
                  { value: "", label: "All Employees" },
                  ...employees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.firstName} ${employee.lastName}`
                  }))
                ]}
                className="w-48"
              />
            )}
            {isSuperAdmin && storefronts.length > 0 && (
              <SelectField
                label="Storefront"
                value={storefrontFilter}
                onChange={setStorefrontFilter}
                options={[
                  { value: "", label: "All Storefronts" },
                  ...storefronts.map((location) => ({ value: location.id, label: location.locationName }))
                ]}
                className="w-48"
              />
            )}
          </div>
        )}

        <div className="mt-5">
          {salaries === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : salaries.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Wallet className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">
                {canViewAll ? "No salaries processed yet" : "No payslips yet"}
              </h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                {canViewAll
                  ? "Process your first employee salary to generate a payslip."
                  : "Your payslips will appear here once payroll has been processed for you."}
              </p>
              {canProcess && (
                <Button type="button" onClick={() => setFormOpen(true)} className="mt-5 h-9 text-xs">
                  <Plus className="mr-1.5 size-4" aria-hidden="true" />
                  Process Salary
                </Button>
              )}
            </div>
          ) : filteredSalaries && filteredSalaries.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Search className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No payslips match your search</h3>
              <Button type="button" onClick={() => setSearchTerm("")} className="mt-5 h-9 text-xs">
                Clear search
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[14%]" />
                  {canViewAll && <col className="w-[20%]" />}
                  <col className={canViewAll ? "w-[16%]" : "w-[20%]"} />
                  <col className={canViewAll ? "w-[14%]" : "w-[18%]"} />
                  <col className={canViewAll ? "w-[16%]" : "w-[20%]"} />
                  <col className={canViewAll ? "w-[10%]" : "w-[14%]"} />
                  <col className={canViewAll ? "w-[10%]" : "w-[14%]"} />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Payslip #</Th>
                    {canViewAll && <Th>Employee</Th>}
                    <Th>Pay Period</Th>
                    <Th className="text-right">Net Pay</Th>
                    <Th>Payment Method</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredSalaries ?? []).map((salary) => (
                    <tr
                      key={salary.id}
                      onClick={() => setViewingSalary(salary)}
                      className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft"
                    >
                      <td className="truncate px-3 py-2.5 text-xs font-bold tabular-nums text-ink">
                        {salary.payslipNumber}
                      </td>
                      {canViewAll && (
                        <td className="truncate px-3 py-2.5 font-extrabold">{salary.employeeName}</td>
                      )}
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {formatPayPeriodLabel(salary.payPeriod)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">
                        {formatCents(salary.netPayCents)}
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">
                        {salary.paymentMethodName}
                      </td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone={salary.status === "active" ? "success" : "neutral"}>
                          {salary.status === "active" ? "Active" : "Voided"}
                        </DashedPill>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setViewingSalary(salary);
                          }}
                          className="text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {canProcess && (
        <SalaryFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          employees={employees}
          paymentMethods={paymentMethods}
          onProcessed={handleProcessed}
        />
      )}

      {viewingSalary && (
        <PayslipModal
          salary={viewingSalary}
          canVoid={canVoid}
          canRestore={canRestore}
          onClose={() => setViewingSalary(null)}
          onChanged={refreshViewing}
        />
      )}
    </motion.div>
  );
}

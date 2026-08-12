import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { LineItemEditor, toLineDrafts, toLineItems, type LineDraft } from "@renderer/shared/components/LineItemEditor";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, fromCents, toCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { EmployeeListItem } from "@shared/types/employee";
import type { PaymentMethod } from "@shared/types/payment-method";
import type { Salary } from "@shared/types/salary";

function currentPayPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function SalaryFormModal({
  open,
  onClose,
  employees,
  paymentMethods,
  onProcessed,
  completingDraft
}: {
  open: boolean;
  onClose: () => void;
  employees: EmployeeListItem[];
  paymentMethods: PaymentMethod[];
  onProcessed: (salary: Salary) => Promise<void> | void;
  /** When set, the modal completes this existing draft (employee/pay period locked, deductions
   * pre-seeded) instead of creating a brand-new record. */
  completingDraft?: Salary | null;
}): React.JSX.Element {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [payPeriod, setPayPeriod] = useState(currentPayPeriod());
  const [basicSalary, setBasicSalary] = useState("");
  const [allowanceLines, setAllowanceLines] = useState<LineDraft[]>([]);
  const [deductionLines, setDeductionLines] = useState<LineDraft[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (completingDraft) {
      const employee = employees.find((candidate) => candidate.id === completingDraft.employeeId) ?? null;
      setEmployeeId(completingDraft.employeeId);
      setEmployeeSearch("");
      setPayPeriod(completingDraft.payPeriod);
      // Same pre-fill as picking a fresh employee below — this path just never went through that
      // click handler, since the employee here is already locked in from the draft itself.
      setBasicSalary(employee?.defaultBasicSalaryCents != null ? fromCents(employee.defaultBasicSalaryCents) : "");
      setAllowanceLines(toLineDrafts(employee?.defaultAllowances ?? []));
      // The draft's own deductions (e.g. the advance already recorded) come first and are never
      // dropped — the employee's saved default deductions are appended alongside them, not in
      // place of them.
      setDeductionLines([...toLineDrafts(completingDraft.deductions), ...toLineDrafts(employee?.defaultDeductions ?? [])]);
      setPaymentMethodId("");
      setReference("");
      setNotes(completingDraft.notes ?? "");
      setError(null);
      return;
    }
    setEmployeeId(null);
    setEmployeeSearch("");
    setPayPeriod(currentPayPeriod());
    setBasicSalary("");
    setAllowanceLines([]);
    setDeductionLines([]);
    setPaymentMethodId("");
    setReference("");
    setNotes("");
    setError(null);
  }, [open, completingDraft, employees]);

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "active"), [employees]);
  const selectedEmployee = activeEmployees.find((employee) => employee.id === employeeId) ?? null;

  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.trim().toLowerCase();
    if (!term) return activeEmployees.slice(0, 20);
    return activeEmployees
      .filter((employee) =>
        `${employee.firstName} ${employee.lastName} ${employee.employeeCode}`.toLowerCase().includes(term)
      )
      .slice(0, 20);
  }, [activeEmployees, employeeSearch]);

  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((method) => method.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [paymentMethods]
  );
  const selectedPaymentMethod = activePaymentMethods.find((method) => method.id === paymentMethodId) ?? null;

  const allowanceItems = toLineItems(allowanceLines);
  const deductionItems = toLineItems(deductionLines);
  const allowancesTotalCents = allowanceItems.reduce((sum, item) => sum + item.amountCents, 0);
  const deductionsTotalCents = deductionItems.reduce((sum, item) => sum + item.amountCents, 0);
  const netPayCents = toCents(basicSalary) + allowancesTotalCents - deductionsTotalCents;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!employeeId) {
      setError("Select an employee");
      showErrorToast("Select an employee");
      return;
    }
    if (netPayCents < 0) {
      setError("Net pay can't be negative — reduce the deductions");
      showErrorToast("Net pay can't be negative — reduce the deductions");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        employeeId,
        payPeriod,
        basicSalaryCents: toCents(basicSalary),
        allowances: allowanceItems,
        deductions: deductionItems,
        paymentMethodId,
        paymentReference: reference,
        notes
      };
      const salary = completingDraft
        ? await window.blueLedger.salary.complete(completingDraft.id, payload)
        : await window.blueLedger.salary.create(payload);
      showSuccessToast(completingDraft ? "Payslip completed" : "Salary processed");
      await onProcessed(salary);
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, completingDraft ? "Failed to complete payslip" : "Failed to process salary");
      setError(message);
      showErrorToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={completingDraft ? "Complete Payslip" : "Process Salary"}
      description={
        completingDraft
          ? "Fill in the rest to finish processing this payslip — the deductions already recorded are kept."
          : "Creates a new payroll record and generates the employee's payslip."
      }
      widthClassName="max-w-lg"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Employee</span>
          {selectedEmployee ? (
            <div className="mt-1.5 flex items-center justify-between rounded-lg border border-line bg-soft px-3.5 py-2.5">
              <div>
                <p className="text-sm font-extrabold text-ink">
                  {selectedEmployee.firstName} {selectedEmployee.lastName}
                </p>
                <p className="text-[11px] font-semibold text-muted">{selectedEmployee.employeeCode}</p>
              </div>
              {!completingDraft && (
                <button
                  type="button"
                  onClick={() => setEmployeeId(null)}
                  className="text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
                >
                  Change
                </button>
              )}
            </div>
          ) : (
            <div className="relative mt-1.5">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Search employee by name or code"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              {filteredEmployees.length > 0 && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-soft">
                  {filteredEmployees.map((employee) => (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => {
                        setEmployeeId(employee.id);
                        setEmployeeSearch("");
                        // A starting point only — the employee's own saved defaults, never touched
                        // by editing/removing a line here. Only seeds fields that are still at their
                        // untouched "just opened the form" state, so re-picking a different employee
                        // after already typing something never silently clobbers it.
                        if (basicSalary === "" && employee.defaultBasicSalaryCents !== null) {
                          setBasicSalary(fromCents(employee.defaultBasicSalaryCents));
                        }
                        if (allowanceLines.length === 0 && employee.defaultAllowances.length > 0) {
                          setAllowanceLines(toLineDrafts(employee.defaultAllowances));
                        }
                        if (deductionLines.length === 0 && employee.defaultDeductions.length > 0) {
                          setDeductionLines(toLineDrafts(employee.defaultDeductions));
                        }
                      }}
                      className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-soft cursor-pointer"
                    >
                      <span className="font-bold text-ink">
                        {employee.firstName} {employee.lastName}
                      </span>
                      <span className="text-xs font-semibold text-muted">{employee.employeeCode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Pay Period"
            type="month"
            value={payPeriod}
            onChange={setPayPeriod}
            required
            disabled={Boolean(completingDraft)}
          />
          <Field
            label="Basic Salary"
            type="number"
            value={basicSalary}
            onChange={setBasicSalary}
            placeholder="0.00"
            required
          />
        </div>

        <div className="mt-4">
          <LineItemEditor
            title="Allowances (optional)"
            addLabel="Add Allowance"
            lines={allowanceLines}
            onChange={setAllowanceLines}
          />
        </div>

        <div className="mt-4">
          <LineItemEditor
            title={completingDraft ? "Deductions (includes the advance already recorded)" : "Deductions (optional)"}
            addLabel="Add Deduction"
            lines={deductionLines}
            onChange={setDeductionLines}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label="Payment Method"
            value={paymentMethodId}
            onChange={setPaymentMethodId}
            options={[
              { value: "", label: "Select payment method" },
              ...activePaymentMethods.map((method) => ({ value: method.id, label: method.name }))
            ]}
          />
          <Field
            label={selectedPaymentMethod?.requiresReference ? "Reference" : "Reference (optional)"}
            value={reference}
            onChange={setReference}
            placeholder="Transaction code, cheque #, bank ref"
            required={Boolean(selectedPaymentMethod?.requiresReference)}
          />
        </div>

        <TextAreaField label="Notes" value={notes} onChange={setNotes} className="mt-4" rows={2} />

        <div className="mt-4 space-y-1 rounded-lg border border-line bg-soft px-3.5 py-2.5 text-sm">
          <div className="flex justify-between text-muted">
            <span className="font-semibold">Basic Salary</span>
            <span className="font-bold tabular-nums">{formatCents(toCents(basicSalary))}</span>
          </div>
          {allowancesTotalCents > 0 && (
            <div className="flex justify-between text-muted">
              <span className="font-semibold">Allowances</span>
              <span className="font-bold tabular-nums">{formatCents(allowancesTotalCents)}</span>
            </div>
          )}
          {deductionsTotalCents > 0 && (
            <div className="flex justify-between text-muted">
              <span className="font-semibold">Deductions</span>
              <span className="font-bold tabular-nums">-{formatCents(deductionsTotalCents)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-1 font-extrabold uppercase tracking-wide">
            <span className="text-muted">Net Pay</span>
            <span className={netPayCents < 0 ? "text-danger" : "text-ink"}>{formatCents(netPayCents)}</span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
          <Button
            type="button"
            onClick={onClose}
            className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? "Saving..." : completingDraft ? "Complete Payslip" : "Process Salary"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

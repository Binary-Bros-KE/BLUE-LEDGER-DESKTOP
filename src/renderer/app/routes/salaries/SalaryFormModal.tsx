import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, toCents } from "@renderer/shared/lib/money";
import type { EmployeeListItem } from "@shared/types/employee";
import type { PaymentMethod } from "@shared/types/payment-method";
import type { Salary } from "@shared/types/salary";

function currentPayPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type LineDraft = { key: string; name: string; amount: string };

function emptyLine(): LineDraft {
  return { key: crypto.randomUUID(), name: "", amount: "" };
}

function LineItemEditor({
  title,
  addLabel,
  lines,
  onChange
}: {
  title: string;
  addLabel: string;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
}): React.JSX.Element {
  function updateLine(key: string, patch: Partial<LineDraft>): void {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string): void {
    onChange(lines.filter((line) => line.key !== key));
  }

  function addLine(): void {
    onChange([...lines, emptyLine()]);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{title}</span>
        <button
          type="button"
          onClick={addLine}
          className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
        >
          <Plus className="size-3" aria-hidden="true" />
          {addLabel}
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="mt-1.5 text-xs font-semibold text-muted">None added.</p>
      ) : (
        <div className="mt-1.5 space-y-2">
          {lines.map((line) => (
            <div key={line.key} className="flex items-center gap-2">
              <input
                type="text"
                value={line.name}
                onChange={(event) => updateLine(line.key, { name: event.target.value })}
                placeholder="e.g. Transport Allowance"
                className="h-9 flex-1 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={line.amount}
                onChange={(event) => updateLine(line.key, { amount: event.target.value })}
                placeholder="0.00"
                className="h-9 w-28 flex-none rounded-lg border border-line bg-white px-2 text-right text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                aria-label="Remove"
                className="grid size-9 flex-none place-items-center rounded-lg border border-line text-muted hover:bg-danger-soft hover:text-danger cursor-pointer"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SalaryFormModal({
  open,
  onClose,
  employees,
  paymentMethods,
  onProcessed
}: {
  open: boolean;
  onClose: () => void;
  employees: EmployeeListItem[];
  paymentMethods: PaymentMethod[];
  onProcessed: (salary: Salary) => Promise<void> | void;
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
  }, [open]);

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

  function toLineItems(lines: LineDraft[]): Array<{ name: string; amountCents: number }> {
    return lines
      .filter((line) => line.name.trim() !== "" && toCents(line.amount) > 0)
      .map((line) => ({ name: line.name.trim(), amountCents: toCents(line.amount) }));
  }

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
      return;
    }
    if (netPayCents < 0) {
      setError("Net pay can't be negative — reduce the deductions");
      return;
    }

    setSaving(true);
    try {
      const salary = await window.blueLedger.salary.create({
        employeeId,
        payPeriod,
        basicSalaryCents: toCents(basicSalary),
        allowances: allowanceItems,
        deductions: deductionItems,
        paymentMethodId,
        paymentReference: reference,
        notes
      });
      await onProcessed(salary);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to process salary"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Process Salary"
      description="Creates a new payroll record and generates the employee's payslip."
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
              <button
                type="button"
                onClick={() => setEmployeeId(null)}
                className="text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
              >
                Change
              </button>
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
          <Field label="Pay Period" type="month" value={payPeriod} onChange={setPayPeriod} required />
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
            title="Deductions (optional)"
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
            {saving ? "Processing..." : "Process Salary"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

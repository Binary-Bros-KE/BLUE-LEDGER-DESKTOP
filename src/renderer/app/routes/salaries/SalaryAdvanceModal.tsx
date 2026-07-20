import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents, toCents } from "@renderer/shared/lib/money";
import type { EmployeeListItem } from "@shared/types/employee";
import type { Salary } from "@shared/types/salary";

function currentPayPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type LineDraft = { key: string; name: string; amount: string };

function emptyLine(): LineDraft {
  return { key: crypto.randomUUID(), name: `Advance — ${todayLabel()}`, amount: "" };
}

/** Records a mid-month cash advance/loan as a deduction on a draft payslip — no basic salary or
 * payment method are captured here, since nothing about the rest of the month's pay is known yet.
 * The draft is completed later (SalaryFormModal in "complete" mode) once the full payslip is ready. */
export function SalaryAdvanceModal({
  open,
  onClose,
  employees,
  onRecorded
}: {
  open: boolean;
  onClose: () => void;
  employees: EmployeeListItem[];
  onRecorded: (salary: Salary) => Promise<void> | void;
}): React.JSX.Element {
  const [employeeId, setEmployeeId] = useState("");
  const [payPeriod, setPayPeriod] = useState(currentPayPeriod());
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmployeeId("");
    setPayPeriod(currentPayPeriod());
    setLines([emptyLine()]);
    setNotes("");
    setError(null);
  }, [open]);

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "active"), [employees]);

  function updateLine(key: string, patch: Partial<LineDraft>): void {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string): void {
    setLines((prev) => prev.filter((line) => line.key !== key));
  }

  const lineItems = lines
    .filter((line) => line.name.trim() !== "" && toCents(line.amount) > 0)
    .map((line) => ({ name: line.name.trim(), amountCents: toCents(line.amount) }));
  const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!employeeId) {
      setError("Select an employee");
      return;
    }
    if (lineItems.length === 0) {
      setError("Add at least one deduction (e.g. the advance amount)");
      return;
    }

    setSaving(true);
    try {
      const salary = await window.blueLedger.salary.createAdvance({
        employeeId,
        payPeriod,
        deductions: lineItems,
        notes
      });
      await onRecorded(salary);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to record advance"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record Salary Advance"
      description="Opens a draft payslip with this as a deduction — nothing is paid out from here, and the full payslip is completed later at month-end."
      widthClassName="max-w-md"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            options={[
              { value: "", label: "Select an employee..." },
              ...activeEmployees.map((employee) => ({
                value: employee.id,
                label: `${employee.firstName} ${employee.lastName}`
              }))
            ]}
          />
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Pay Period</span>
            <input
              type="month"
              value={payPeriod}
              onChange={(event) => setPayPeriod(event.target.value)}
              required
              className="mt-1.5 h-10 w-full rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            />
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Deductions</span>
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
              className="flex items-center gap-1 text-[11px] font-extrabold uppercase text-accent hover:underline cursor-pointer"
            >
              <Plus className="size-3" aria-hidden="true" />
              Add Line
            </button>
          </div>
          <div className="mt-1.5 space-y-2">
            {lines.map((line) => (
              <div key={line.key} className="flex items-center gap-2">
                <input
                  type="text"
                  value={line.name}
                  onChange={(event) => updateLine(line.key, { name: event.target.value })}
                  placeholder="e.g. Advance — 15 Jul"
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
        </div>

        <TextAreaField
          label="Notes"
          value={notes}
          onChange={setNotes}
          placeholder="Optional — how the advance was paid out, reason, etc."
          className="mt-4"
          rows={2}
        />

        {totalCents > 0 && (
          <div className="mt-4 flex justify-between rounded-lg border border-line bg-soft px-3.5 py-2.5 text-sm">
            <span className="font-semibold text-muted">Total Advance</span>
            <span className="font-extrabold tabular-nums text-ink">{formatCents(totalCents)}</span>
          </div>
        )}

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
            {saving ? "Saving..." : "Record Advance"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

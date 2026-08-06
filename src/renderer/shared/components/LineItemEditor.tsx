import { Plus, X } from "lucide-react";
import { fromCents, toCents } from "@renderer/shared/lib/money";

export type LineDraft = { key: string; name: string; amount: string };

export function emptyLine(): LineDraft {
  return { key: crypto.randomUUID(), name: "", amount: "" };
}

/** Drops any line whose name is blank or amount is zero/invalid — used both when submitting a form
 * and when seeding one editor's drafts from another entity's already-committed line items. */
export function toLineItems(lines: LineDraft[]): Array<{ name: string; amountCents: number }> {
  return lines
    .filter((line) => line.name.trim() !== "" && toCents(line.amount) > 0)
    .map((line) => ({ name: line.name.trim(), amountCents: toCents(line.amount) }));
}

export function toLineDrafts(items: Array<{ name: string; amountCents: number }>): LineDraft[] {
  return items.map((item) => ({ key: crypto.randomUUID(), name: item.name, amount: fromCents(item.amountCents) }));
}

/** Shared name/amount repeatable-row editor — used for a salary's own allowances/deductions
 * (SalaryFormModal) and for an employee's saved default allowances/deductions (EmployeesRoute),
 * same {name, amountCents} shape either way. */
export function LineItemEditor({
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

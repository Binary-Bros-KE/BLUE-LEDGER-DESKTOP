import { DashedPill } from "@renderer/shared/components/DashedPill";
import type { ImportPreviewResult, ImportRowAction } from "@shared/types/import";

const ACTION_TONE: Record<ImportRowAction, "success" | "accent" | "danger"> = {
  create: "accent",
  update: "success",
  error: "danger"
};

const ACTION_LABEL: Record<ImportRowAction, string> = {
  create: "Create",
  update: "Update",
  error: "Error"
};

export function ImportPreviewTable({ result }: { result: ImportPreviewResult }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs font-bold">
        <span className="rounded-full bg-accent/10 px-3 py-1 text-accent">{result.summary.toCreate} to create</span>
        <span className="rounded-full bg-success/10 px-3 py-1 text-success">{result.summary.toUpdate} to update</span>
        <span className="rounded-full bg-danger/10 px-3 py-1 text-danger">{result.summary.invalid} with errors</span>
        <span className="rounded-full bg-soft px-3 py-1 text-muted">{result.summary.total} total rows</span>
      </div>

      <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="sticky top-0 bg-soft">
            <tr className="border-b border-line text-left text-[11px] font-extrabold uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5">Row</th>
              <th className="px-4 py-2.5">Action</th>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Key</th>
              <th className="px-4 py-2.5">Errors</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.rowNumber} className="border-b border-line last:border-0 odd:bg-white even:bg-soft/30">
                <td className="px-4 py-2.5 tabular-nums text-muted">{row.rowNumber}</td>
                <td className="px-4 py-2.5">
                  <DashedPill tone={ACTION_TONE[row.action]}>{ACTION_LABEL[row.action]}</DashedPill>
                </td>
                <td className="px-4 py-2.5 font-bold text-ink">{row.displayName ?? "—"}</td>
                <td className="px-4 py-2.5 text-muted">{row.naturalKey ?? "—"}</td>
                <td className="max-w-[320px] px-4 py-2.5 text-danger">{row.errors.join("; ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import type { ImportCommitResult } from "@shared/types/import";

export function ImportResultsPanel({ result }: { result: ImportCommitResult }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ResultTile label="Created" value={result.created} tone="text-success" />
        <ResultTile label="Updated" value={result.updated} tone="text-accent" />
        <ResultTile label="Skipped" value={result.skipped} tone="text-muted" />
        <ResultTile label="Failed" value={result.failed} tone="text-danger" />
      </div>

      {result.errors.length > 0 && (
        <div className="max-h-[320px] overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead className="sticky top-0 bg-soft">
              <tr className="border-b border-line text-left text-[11px] font-extrabold uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5">Row</th>
                <th className="px-4 py-2.5">Reason</th>
              </tr>
            </thead>
            <tbody>
              {result.errors.map((error) => (
                <tr key={error.rowNumber} className="border-b border-line last:border-0 odd:bg-white even:bg-soft/30">
                  <td className="px-4 py-2.5 tabular-nums text-muted">{error.rowNumber}</td>
                  <td className="px-4 py-2.5 text-danger">{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultTile({ label, value, tone }: { label: string; value: number; tone: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-soft px-3 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

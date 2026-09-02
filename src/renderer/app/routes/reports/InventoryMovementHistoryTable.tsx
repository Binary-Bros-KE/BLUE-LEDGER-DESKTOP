import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { StockMovementReportRow } from "@shared/types/inventory-report";

function money(cents: number): string {
  return formatCents(cents);
}

const MOVEMENT_LABEL: Record<string, string> = {
  purchase: "Purchase",
  sale: "Sale",
  transfer_in: "Transfer In",
  transfer_out: "Transfer Out",
  return: "Return",
  damage: "Damage",
  adjustment: "Adjustment",
  opening_stock: "Opening Stock",
  borrow_in: "Borrowed In",
  borrow_return_out: "Returned Borrowed Stock",
  loan_out: "Lent Out",
  loan_return_in: "Loan Returned",
};

const MOVEMENT_STYLE: Record<string, string> = {
  purchase: "bg-success/10 text-success",
  opening_stock: "bg-success/10 text-success",
  transfer_in: "bg-accent/10 text-accent",
  sale: "bg-soft text-muted",
  transfer_out: "bg-warning/10 text-warning",
  return: "bg-warning/10 text-warning",
  damage: "bg-danger/10 text-danger",
  adjustment: "bg-soft text-muted",
  borrow_in: "bg-success/10 text-success",
  loan_return_in: "bg-success/10 text-success",
  borrow_return_out: "bg-warning/10 text-warning",
  loan_out: "bg-warning/10 text-warning",
};

function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Every stock movement at this location — purchases received, sales,
 * transfers to/from Main Store, returns, damage write-offs — capped to the
 * most recent 50 so this stays a quick scan, not a full export. */
export function InventoryMovementHistoryTable({ rows }: { rows: StockMovementReportRow[] }): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[100px] items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 text-sm font-semibold text-muted">
        No stock movements recorded yet.
      </div>
    );
  }

  return (
    <div className="max-h-[420px] overflow-y-auto rounded-lg border border-line">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-primary text-white">
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Date</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Type</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty Change</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Value</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Performed By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line odd:bg-white even:bg-soft/50">
              <td className="px-3 py-2 text-xs font-semibold text-muted">{formatCreatedAt(row.createdAt)}</td>
              <td className="truncate px-3 py-2 font-bold text-ink">
                {row.productName}
                <span className="ml-1 font-semibold text-muted">({row.sku})</span>
              </td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    "inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    MOVEMENT_STYLE[row.movementType] ?? "bg-soft text-muted"
                  )}
                >
                  {MOVEMENT_LABEL[row.movementType] ?? row.movementType}
                </span>
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right font-bold tabular-nums",
                  row.quantityChange >= 0 ? "text-success" : "text-danger"
                )}
              >
                {row.quantityChange > 0 ? "+" : ""}
                {row.quantityChange}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{money(row.valueCents)}</td>
              <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.performedByName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

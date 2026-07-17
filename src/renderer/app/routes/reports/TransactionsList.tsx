import { useMemo } from "react";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { SalesTransactionKind, SalesTransactionRow } from "@shared/types/report";

const KIND_LABEL: Record<SalesTransactionKind, string> = {
  retail_sale: "Retail Sale",
  wholesale_sale: "Wholesale Sale",
  invoice: "Invoice",
};

const STATUS_STYLE: Record<"paid" | "partially_paid", string> = {
  paid: "bg-success/10 text-success",
  partially_paid: "bg-warning/10 text-warning",
};

/** Every row here has already collected at least some cash (unpaid invoices
 * are filtered out entirely), so the only useful distinction left is whether
 * it's fully settled or not — the raw stored status (which can include
 * stale/unrelated labels like "overdue") isn't shown here; that detail lives
 * in the Invoices tab. */
function deriveStatus(row: Pick<SalesTransactionRow, "amountCents" | "amountPaidCents">): "paid" | "partially_paid" {
  return row.amountPaidCents >= row.amountCents ? "paid" : "partially_paid";
}

function formatStatus(status: "paid" | "partially_paid"): string {
  return status === "paid" ? "Paid" : "Partially Paid";
}

function formatOccurredAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Every individual transaction in the resolved range — the detail behind the
 * summary cards above, scrollable rather than paginated so a quick scan and a
 * full audit both work in the same view. */
export function TransactionsList({ transactions }: { transactions: SalesTransactionRow[] }): React.JSX.Element {
  const receiptCount = useMemo(() => transactions.filter((t) => t.kind === "retail_sale").length, [transactions]);
  const invoiceDocumentCount = useMemo(
    () => transactions.filter((t) => t.kind === "invoice" || t.kind === "wholesale_sale").length,
    [transactions]
  );

  if (transactions.length === 0) {
    return (
      <div className="flex min-h-[140px] items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 text-sm font-semibold text-muted">
        No transactions in this period.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs font-bold text-muted">
        <span className="rounded-md border border-line bg-soft/60 px-2.5 py-1">
          Total receipts: <span className="text-ink">{receiptCount}</span>
        </span>
        <span className="rounded-md border border-line bg-soft/60 px-2.5 py-1">
          Total invoice documents: <span className="text-ink">{invoiceDocumentCount}</span>
        </span>
      </div>
      <div className="max-h-[480px] overflow-y-auto rounded-lg border border-line">
      <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-primary text-white">
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Date &amp; Time</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Document</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Type</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Location</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Employee</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Customer</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Method</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Amount</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Paid</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((row) => (
            <tr key={row.id} className="border-t border-line odd:bg-white even:bg-soft/50">
              <td className="px-3 py-2 text-xs font-semibold text-muted">{formatOccurredAt(row.occurredAt)}</td>
              <td className="truncate px-3 py-2 font-bold text-ink">{row.documentNumber ?? "—"}</td>
              <td className="px-3 py-2 text-xs font-semibold text-muted">{KIND_LABEL[row.kind]}</td>
              <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.locationName}</td>
              <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.employeeName}</td>
              <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.customerName ?? "—"}</td>
              <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.paymentMethodName ?? "Other"}</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{formatCents(row.amountCents)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{formatCents(row.amountPaidCents)}</td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    "inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    STATUS_STYLE[deriveStatus(row)]
                  )}
                >
                  {formatStatus(deriveStatus(row))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

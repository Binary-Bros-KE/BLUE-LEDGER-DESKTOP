import { useMemo, useState } from "react";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { OutstandingInvoicesSummary } from "@shared/types/customer-report";
import { OverviewCard } from "./FinancialOverviewCards";

function money(cents: number): string {
  return formatCents(cents);
}

type Filter = "all" | "overdue";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Every currently-outstanding invoice — a live balance-sheet snapshot,
 * deliberately not scoped to the period selector above (same reasoning as
 * Sales Report's Debtors section: a debt doesn't stop existing just because
 * you picked a different date range). */
export function OutstandingInvoicesSection({ summary }: { summary: OutstandingInvoicesSummary }): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>("all");

  const visibleInvoices = useMemo(
    () => (filter === "all" ? summary.invoices : summary.invoices.filter((invoice) => invoice.isOverdue)),
    [summary, filter]
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-ink">Outstanding Customer Invoices</h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">A live snapshot as of today — not scoped to the period above.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <OverviewCard
          tone="primary"
          label="Total Outstanding"
          valueCents={summary.totalOutstandingCents}
          formula="Sum of every unpaid invoice balance"
        />
        <OverviewCard
          tone="teal"
          label="Debtors"
          displayValue={String(summary.debtorCount)}
          formula="Distinct customers who owe money"
        />
        <OverviewCard
          tone="danger"
          label="Overdue Invoices"
          displayValue={String(summary.overdueCount)}
          formula="Past their due date, still unpaid"
        />
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Outstanding invoices, oldest first</p>
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-soft p-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition cursor-pointer",
                filter === "all" ? "bg-primary text-white" : "text-muted hover:bg-white"
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilter("overdue")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition cursor-pointer",
                filter === "overdue" ? "bg-primary text-white" : "text-muted hover:bg-white"
              )}
            >
              Overdue Only
            </button>
          </div>
        </div>

        {visibleInvoices.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-muted">
            {filter === "overdue" ? "No overdue invoices right now." : "No outstanding invoices right now."}
          </p>
        ) : (
          <div className="mt-3 max-h-[480px] overflow-y-auto rounded-lg border border-line">
            <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-primary text-white">
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Customer</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Document</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Issued</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Due</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Total</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Paid</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Balance</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.map((invoice) => (
                  <tr key={invoice.saleId} className={cn("border-t border-line", invoice.isOverdue ? "bg-danger-soft/40" : "odd:bg-white even:bg-soft/50")}>
                    <td className="line-clamp-2 px-3 py-2 font-bold leading-snug text-ink">{invoice.customerName}</td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{invoice.documentNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{formatDate(invoice.completedAt)}</td>
                    <td className="px-3 py-2 text-xs font-semibold">
                      <span className={invoice.isOverdue ? "font-bold text-danger" : "text-muted"}>{formatDate(invoice.dueDate)}</span>
                      {invoice.isOverdue && (
                        <span className="ml-1.5 rounded bg-danger/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-danger">
                          Overdue
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(invoice.grandTotalCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(invoice.amountPaidCents)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(invoice.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeftRight, Loader2, Search } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { StatTile } from "@renderer/shared/components/StatTile";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { todayIso } from "@renderer/app/routes/reports/salesReportDate";
import type { PaymentTransactionRow } from "@shared/types/report";

function monthStartIso(): string {
  return `${todayIso().slice(0, 7)}-01`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** Every actual payment received across the business, in one flat list — the "did we actually get
 * paid for this" answer, searched by the transaction's own unique code. Cashier-accessible (gated
 * on "sales", same as Checkout/Receipts) and always branch-scoped like everything else in this app
 * — a Cashier only ever sees their own storefront's payments here. */
export function TransactionsRoute(): React.JSX.Element {
  const [dateFrom, setDateFrom] = useState(monthStartIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [transactions, setTransactions] = useState<PaymentTransactionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const load = useCallback(async (from: string, to: string) => {
    setLoadError(null);
    try {
      const result = await window.blueLedger.report.paymentTransactions({ startDate: from, endDate: to });
      setTransactions(result);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load transactions"));
    }
  }, []);

  useEffect(() => {
    void load(dateFrom, dateTo);
  }, [load, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    if (!transactions) return null;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return transactions;
    return transactions.filter((row) => {
      const haystack = `${row.transactionCode} ${row.paymentMethodName ?? ""} ${row.processedByName} ${row.locationName}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [transactions, searchTerm]);

  const summary = useMemo(() => {
    if (!filtered) return null;
    const complete = filtered.filter((row) => row.status === "complete");
    return {
      count: filtered.length,
      completeCount: complete.length,
      failedCount: filtered.length - complete.length,
      totalCents: complete.reduce((sum, row) => sum + row.amountCents, 0)
    };
  }, [filtered]);

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
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Transactions</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <ArrowLeftRight className="size-5 text-primary" aria-hidden="true" />
            Every Payment, In One Place
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Search by transaction code to confirm whether — and when — a payment actually went through.
          </p>
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={ArrowLeftRight} label="Transactions" value={String(summary?.count ?? 0)} tone="primary" />
          <StatTile icon={ArrowLeftRight} label="Complete" value={String(summary?.completeCount ?? 0)} tone="success" />
          <StatTile icon={ArrowLeftRight} label="Failed" value={String(summary?.failedCount ?? 0)} tone="danger" />
          <StatTile icon={ArrowLeftRight} label="Total Collected" value={formatCents(summary?.totalCents ?? 0)} tone="accent" />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block sm:max-w-xs sm:flex-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search by transaction code</span>
            <div className="relative mt-1.5">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Transaction code, payment method, or who processed it"
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
        </div>

        <div className="mt-5">
          {transactions === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : filtered && filtered.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <Search className="size-7 text-muted" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-extrabold">No transactions match</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">Try a different search term or widen the date range.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Time</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Transaction Code</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Storefront</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Payment Method</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Processed By</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Amount</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(filtered ?? []).map((row) => (
                    <tr key={row.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="px-4 py-2.5 text-xs font-semibold text-muted">{formatDateTime(row.occurredAt)}</td>
                      <td className="truncate px-4 py-2.5 font-bold text-ink">{row.transactionCode}</td>
                      <td className="truncate px-4 py-2.5 text-xs font-semibold text-muted">{row.locationName}</td>
                      <td className="truncate px-4 py-2.5 text-xs font-semibold text-muted">{row.paymentMethodName ?? "—"}</td>
                      <td className="truncate px-4 py-2.5 text-xs font-semibold text-muted">{row.processedByName}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-ink">{formatCents(row.amountCents)}</td>
                      <td className="px-4 py-2.5">
                        <DashedPill tone={row.status === "complete" ? "success" : "danger"}>{row.status}</DashedPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </motion.div>
  );
}

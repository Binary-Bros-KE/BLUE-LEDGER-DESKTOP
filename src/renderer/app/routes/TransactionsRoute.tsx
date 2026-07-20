import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeftRight, Loader2, Search } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getDashboardVariant } from "@renderer/shared/lib/dashboard-role";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { todayIso } from "@renderer/app/routes/reports/salesReportDate";
import { ALL_YEARS_VALUE, currentYear, yearFilterOptions } from "@renderer/shared/lib/year-filter";
import type { ExportListRequest } from "@shared/types/export";
import type { PaymentTransactionRow } from "@shared/types/report";

const ALL_VALUE = "__all__";
const EARLIEST_DATE = "2000-01-01";
const YEAR_LOOKBACK = 5;

/** Transactions already fetches server-side by date range, so the Year filter drives dateFrom/dateTo
 * directly instead of filtering an already-loaded list — the same lever the From/To inputs use, just
 * a one-click preset for the common case. */
function boundsForYear(value: string): { from: string; to: string } {
  if (value === ALL_YEARS_VALUE) return { from: EARLIEST_DATE, to: todayIso() };
  const year = Number(value);
  return { from: `${year}-01-01`, to: year === currentYear() ? todayIso() : `${year}-12-31` };
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
  const { can, session } = usePermissions();
  const isSuperAdmin = getDashboardVariant(session) === "superAdmin";
  const canExport = can("sales", "export");

  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));
  const [dateFrom, setDateFrom] = useState(() => boundsForYear(String(currentYear())).from);
  const [dateTo, setDateTo] = useState(() => boundsForYear(String(currentYear())).to);
  const [transactions, setTransactions] = useState<PaymentTransactionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState(ALL_VALUE);
  const [cashierFilter, setCashierFilter] = useState(ALL_VALUE);
  const [locationFilter, setLocationFilter] = useState(ALL_VALUE);

  const yearOptions = useMemo(
    () => yearFilterOptions(Array.from({ length: YEAR_LOOKBACK + 1 }, (_, index) => currentYear() - index)),
    []
  );

  function handleYearFilterChange(value: string): void {
    setYearFilter(value);
    const bounds = boundsForYear(value);
    setDateFrom(bounds.from);
    setDateTo(bounds.to);
  }

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

  const paymentMethodOptions = useMemo(() => {
    if (!transactions) return [];
    return Array.from(new Set(transactions.map((row) => row.paymentMethodName).filter((name): name is string => Boolean(name)))).sort();
  }, [transactions]);

  const cashierOptions = useMemo(() => {
    if (!transactions) return [];
    return Array.from(new Set(transactions.map((row) => row.processedByName))).sort();
  }, [transactions]);

  const locationOptions = useMemo(() => {
    if (!transactions) return [];
    return Array.from(new Set(transactions.map((row) => row.locationName))).sort();
  }, [transactions]);

  const filtered = useMemo(() => {
    if (!transactions) return null;
    let list = transactions;

    if (paymentMethodFilter !== ALL_VALUE) {
      list = list.filter((row) => row.paymentMethodName === paymentMethodFilter);
    }
    if (cashierFilter !== ALL_VALUE) {
      list = list.filter((row) => row.processedByName === cashierFilter);
    }
    if (isSuperAdmin && locationFilter !== ALL_VALUE) {
      list = list.filter((row) => row.locationName === locationFilter);
    }

    const term = searchTerm.trim().toLowerCase();
    if (!term) return list;
    return list.filter((row) => {
      const haystack = `${row.transactionCode} ${row.paymentMethodName ?? ""} ${row.processedByName} ${row.locationName}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [transactions, searchTerm, paymentMethodFilter, cashierFilter, locationFilter, isSuperAdmin]);

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

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filtered) return null;
    const filterParts: string[] = [`Date: ${dateFrom} to ${dateTo}`];
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);
    if (paymentMethodFilter !== ALL_VALUE) filterParts.push(`Payment Method: ${paymentMethodFilter}`);
    if (cashierFilter !== ALL_VALUE) filterParts.push(`Cashier: ${cashierFilter}`);
    if (isSuperAdmin && locationFilter !== ALL_VALUE) filterParts.push(`Storefront: ${locationFilter}`);

    return {
      module: "sales",
      title: "Transactions",
      subtitle: filterParts.join(" · "),
      columns: [
        { key: "time", header: "Time" },
        { key: "code", header: "Transaction Code" },
        { key: "storefront", header: "Storefront" },
        { key: "paymentMethod", header: "Payment Method" },
        { key: "processedBy", header: "Processed By" },
        { key: "amount", header: "Amount", align: "right" },
        { key: "status", header: "Status" }
      ],
      rows: filtered.map((row) => ({
        time: formatDateTime(row.occurredAt),
        code: row.transactionCode,
        storefront: row.locationName,
        paymentMethod: row.paymentMethodName ?? "—",
        processedBy: row.processedByName,
        amount: formatCents(row.amountCents),
        status: row.status
      })),
      stats: summary
        ? [
            { label: "Transactions", value: String(summary.count) },
            { label: "Complete", value: String(summary.completeCount) },
            { label: "Failed", value: String(summary.failedCount) },
            { label: "Total Collected", value: formatCents(summary.totalCents) }
          ]
        : [],
      fileBaseName: `Transactions_${dateFrom}_to_${dateTo}`
    };
  }, [filtered, summary, dateFrom, dateTo, searchTerm, paymentMethodFilter, cashierFilter, locationFilter, isSuperAdmin]);

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
        <div className="flex flex-wrap items-start justify-between gap-4">
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
          {canExport && exportRequest && <ExportMenu request={exportRequest} />}
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
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Year</span>
            <select
              value={yearFilter}
              onChange={(event) => handleYearFilterChange(event.target.value)}
              className="mt-1.5 h-10 w-32 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            >
              {yearOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Payment Method</span>
            <select
              value={paymentMethodFilter}
              onChange={(event) => setPaymentMethodFilter(event.target.value)}
              className="mt-1.5 h-10 min-w-[160px] rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            >
              <option value={ALL_VALUE}>All Payment Methods</option>
              {paymentMethodOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Cashier</span>
            <select
              value={cashierFilter}
              onChange={(event) => setCashierFilter(event.target.value)}
              className="mt-1.5 h-10 min-w-[160px] rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
            >
              <option value={ALL_VALUE}>All Cashiers</option>
              {cashierOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {isSuperAdmin && (
            <label className="block">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Storefront</span>
              <select
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
                className="mt-1.5 h-10 min-w-[160px] rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              >
                <option value={ALL_VALUE}>All Storefronts</option>
                {locationOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(paymentMethodFilter !== ALL_VALUE || cashierFilter !== ALL_VALUE || locationFilter !== ALL_VALUE) && (
            <button
              type="button"
              onClick={() => {
                setPaymentMethodFilter(ALL_VALUE);
                setCashierFilter(ALL_VALUE);
                setLocationFilter(ALL_VALUE);
              }}
              className="h-10 rounded-lg border border-line bg-white px-3 text-xs font-bold text-ink shadow-none transition hover:bg-soft cursor-pointer"
            >
              Clear filters
            </button>
          )}
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Loader2, Search, Tag, WifiOff } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ReportExportMenu } from "@renderer/shared/components/ReportExportMenu";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import { formatDocumentDateTime } from "@shared/lib/date";
import type { DropshipPriceReport, DropshipPriceReportQuery, DropshipPriceReportRow } from "@shared/types/dropship";
import type { DateRangeInput, SalesReportMode } from "@shared/types/report";
import type { ReportExportRequest } from "@shared/types/report-export";
import { defaultAnchorForMode, rangeForAnchor, shiftAnchor, todayIso } from "./reports/salesReportDate";
import { SalesModeSelector } from "./reports/SalesModeSelector";

type Direction = NonNullable<DropshipPriceReportQuery["direction"]>;
type Outcome = NonNullable<DropshipPriceReportQuery["outcome"]>;

const DIRECTIONS: Array<{ key: Direction; label: string }> = [
  { key: "all", label: "All changes" },
  { key: "raised", label: "Supplier raised" },
  { key: "lowered", label: "Supplier lowered" }
];
const OUTCOMES: Array<{ key: Outcome; label: string }> = [
  { key: "all", label: "Any outcome" },
  { key: "updated", label: "My price updated" },
  { key: "kept", label: "My price kept" }
];

function roundingLabel(cents: number): string {
  return cents <= 100 ? "whole shillings" : `rounded up to ${formatCents(cents)}`;
}

function percentChange([before, after]: [number, number]): string {
  if (before === 0) return "";
  const pct = ((after - before) / before) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}

function PriceChange({ value, strong }: { value: [number, number]; strong?: boolean }): React.JSX.Element {
  const [before, after] = value;
  if (before === after) {
    return <span className="text-xs font-semibold tabular-nums text-muted">{formatCents(after)}</span>;
  }
  const Icon = after > before ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1 text-xs tabular-nums">
      <span className="font-semibold text-muted line-through decoration-muted/60">{formatCents(before)}</span>
      <ArrowRight className="size-3 text-muted" aria-hidden="true" />
      <span className={cn("font-bold", strong ? "text-ink" : "text-ink/80")}>{formatCents(after)}</span>
      <span className={cn("inline-flex items-center text-[10px] font-extrabold", after > before ? "text-danger" : "text-success")}>
        <Icon className="size-3" aria-hidden="true" />
        {percentChange(value)}
      </span>
    </span>
  );
}

function OutcomePill({ row }: { row: DropshipPriceReportRow }): React.JSX.Element {
  if (row.kind === "rule_applied") return <DashedPill tone="accent">Rule applied</DashedPill>;
  return row.outcome === "updated" ? <DashedPill tone="success">Updated</DashedPill> : <DashedPill tone="warning">Kept the same</DashedPill>;
}

function priceText([before, after]: [number, number]): string {
  return before === after ? formatCents(after) : `${formatCents(before)} → ${formatCents(after)}`;
}

/** Dropship-only: every price change a supplier made on a linked product, and whether this store's own
 * prices moved with it. Server-side history, so it needs a connection. */
export function DropshipPricesReportRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canExport = can("reports", "export");

  const [mode, setMode] = useState<SalesReportMode>("monthly");
  const [anchor, setAnchor] = useState<string>(() => defaultAnchorForMode("monthly"));
  const [customRange, setCustomRange] = useState<DateRangeInput>(() => ({
    startDate: shiftAnchor("daily", todayIso(), -29),
    endDate: todayIso()
  }));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [outcome, setOutcome] = useState<Outcome>("all");

  function handleModeChange(nextMode: SalesReportMode): void {
    setMode(nextMode);
    if (nextMode !== "custom") setAnchor(defaultAnchorForMode(nextMode));
  }

  const resolvedRange = useMemo<DateRangeInput>(
    () => (mode === "custom" ? customRange : rangeForAnchor(mode, anchor)),
    [mode, anchor, customRange]
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [data, setData] = useState<DropshipPriceReport | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo<DropshipPriceReportQuery>(
    () => ({ startDate: resolvedRange.startDate, endDate: resolvedRange.endDate, ...(search ? { search } : {}), direction, outcome }),
    [resolvedRange.startDate, resolvedRange.endDate, search, direction, outcome]
  );

  const load = useCallback(async (q: DropshipPriceReportQuery) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.blueLedger.dropship.priceReport(q);
      setOffline(result === null);
      setData(result);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to load supplier price changes");
      setError(message);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(query);
  }, [query, load]);

  async function loadMore(): Promise<void> {
    if (!data) return;
    setLoadingMore(true);
    try {
      const next = await window.blueLedger.dropship.priceReport({ ...query, offset: data.rows.length });
      if (next) setData({ ...next, rows: [...data.rows, ...next.rows] });
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to load more"));
    } finally {
      setLoadingMore(false);
    }
  }

  const reportExportRequest = useMemo<ReportExportRequest | null>(() => {
    if (!data) return null;
    return {
      module: "reports",
      title: "Supplier Price Changes",
      subtitle: `${resolvedRange.startDate} to ${resolvedRange.endDate}`,
      sections: [
        {
          type: "tiles",
          title: "Period Summary",
          tiles: [
            { label: "Supplier changes", value: String(data.summary.supplierChanges) },
            { label: "Raised", value: String(data.summary.raised) },
            { label: "Lowered", value: String(data.summary.lowered) },
            { label: "My price updated", value: String(data.summary.updated) },
            { label: "My price kept", value: String(data.summary.kept) }
          ]
        },
        {
          type: "table",
          title: "Price Changes",
          columns: [
            { key: "date", header: "Date" },
            { key: "product", header: "Product" },
            { key: "supplier", header: "Supplier" },
            { key: "theirs", header: "Their selling", align: "right" },
            { key: "selling", header: "My selling", align: "right" },
            { key: "buying", header: "My buying", align: "right" },
            { key: "outcome", header: "Outcome" }
          ],
          rows: data.rows.map((row) => ({
            date: formatDocumentDateTime(row.at),
            product: row.sku ? `${row.productName} (${row.sku})` : row.productName,
            supplier: row.supplierName,
            theirs: priceText(row.supplierSellingCents),
            selling: priceText(row.sellingCents),
            buying: priceText(row.buyingCents),
            outcome: row.kind === "rule_applied" ? "Rule applied" : row.outcome === "updated" ? "Updated" : "Kept the same"
          }))
        }
      ],
      fileBaseName: `SupplierPriceChanges_${resolvedRange.startDate}_to_${resolvedRange.endDate}`
    };
  }, [data, resolvedRange]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Insights</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <Tag className="size-5 text-primary" aria-hidden="true" />
            Supplier Prices
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Every price change your dropship supplier made on a linked product, and whether your own price moved with it.
          </p>
        </div>
        {canExport && reportExportRequest && <ReportExportMenu request={reportExportRequest} />}
      </div>

      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <SalesModeSelector
            mode={mode}
            onModeChange={handleModeChange}
            anchor={anchor}
            onAnchorChange={setAnchor}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search product or SKU"
              className="h-9 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold outline-none focus:border-primary"
            />
          </label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold outline-none focus:border-primary"
          >
            {DIRECTIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as Outcome)}
            className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold outline-none focus:border-primary"
          >
            {OUTCOMES.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>}

        {offline && !loading && (
          <div className="mt-5 flex min-h-[160px] flex-col items-center justify-center gap-2 text-center text-muted">
            <WifiOff className="size-6" aria-hidden="true" />
            <p className="text-sm font-bold">Can&apos;t reach the server</p>
            <p className="text-xs font-semibold">This report is kept online — connect to the internet and it will load.</p>
          </div>
        )}

        <div className={cn("mt-5 space-y-4 transition-opacity", loading && "opacity-60")}>
          {loading && !data && !offline && (
            <div className="flex min-h-[200px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          )}
          {data && (
            <>
              <div className="space-y-1">
                {data.suppliers.map((s) => (
                  <p key={s.name} className="text-xs font-semibold text-muted">
                    <span className="font-extrabold text-ink">{s.name}</span>
                    {s.followPrices
                      ? ` — your prices follow theirs: buying = their buying price, selling = their selling + ${s.sellingMarkupBp / 100}% (${roundingLabel(s.priceRoundingCents)}).`
                      : " — your prices are your own; their changes are listed here but not applied."}
                  </p>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <StatTile icon={Tag} label="Supplier changes" value={String(data.summary.supplierChanges)} tone="primary" />
                <StatTile icon={ArrowUpRight} label="Raised" value={String(data.summary.raised)} tone="danger" />
                <StatTile icon={ArrowDownRight} label="Lowered" value={String(data.summary.lowered)} tone="success" />
                <StatTile icon={ArrowRight} label="My price updated" value={String(data.summary.updated)} tone="accent" />
                <StatTile icon={ArrowRight} label="My price kept" value={String(data.summary.kept)} tone="warning" />
              </div>

              {data.rows.length === 0 ? (
                <p className="py-8 text-center text-xs font-semibold text-muted">No supplier price changes in this period.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full min-w-[920px] table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="w-[13%]" />
                      <col className="w-[27%]" />
                      <col className="w-[17%]" />
                      <col className="w-[17%]" />
                      <col className="w-[14%]" />
                      <col className="w-[12%]" />
                    </colgroup>
                    <thead>
                      <tr className="bg-primary text-white">
                        <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Date</th>
                        <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                        <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Their selling</th>
                        <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">My selling</th>
                        <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">My buying</th>
                        <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.id} className="border-t border-line align-top odd:bg-white even:bg-soft/50">
                          <td className="px-3 py-2 text-xs font-semibold tabular-nums text-muted">{formatDocumentDateTime(row.at)}</td>
                          <td className="px-3 py-2 text-xs font-bold text-ink">
                            <p className="line-clamp-2 leading-snug" title={row.productName}>
                              {row.productName}
                            </p>
                            <p className="mt-0.5 font-semibold text-muted">
                              {[row.sku, row.supplierName].filter(Boolean).join(" · ")}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <PriceChange value={row.supplierSellingCents} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <PriceChange value={row.sellingCents} strong />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <PriceChange value={row.buyingCents} />
                          </td>
                          <td className="px-3 py-2">
                            <OutcomePill row={row} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.total > data.rows.length && (
                <div className="flex items-center justify-center gap-3 text-xs font-semibold text-muted">
                  Showing {data.rows.length} of {data.total}
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="rounded-lg border border-line px-3 py-1.5 font-bold text-ink transition hover:bg-soft disabled:opacity-60"
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

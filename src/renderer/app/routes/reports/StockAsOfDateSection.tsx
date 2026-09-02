import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { ReportExportMenu } from "@renderer/shared/components/ReportExportMenu";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type { ReportExportRequest } from "@shared/types/report-export";
import type { StockAsOfDateData } from "@shared/types/inventory-report";

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string): string {
  try {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch {
    return dateStr;
  }
}

/** "What was on hand at close of business on [date]" — a much simpler sibling to the live report's
 * per-location sections: just quantity, since value/allocation-bucket breakdowns don't have a clean
 * historical meaning (see shared/types/inventory-report.ts's StockAsOfDateRow doc comment). Shares
 * the parent route's own storefront filter — only owns the date picker and its own data/table. */
export function StockAsOfDateSection({
  locationId,
  canExport
}: {
  locationId: string | null;
  canExport: boolean;
}): React.JSX.Element {
  const [date, setDate] = useState(todayIso());
  const [searchTerm, setSearchTerm] = useState("");
  const [data, setData] = useState<StockAsOfDateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.blueLedger.report.stockAsOfDate({ date, locationId });
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          const message = getErrorMessage(err, "Failed to load stock as of that date");
          setError(message);
          showErrorToast(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, locationId]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return data.rows;
    return data.rows.filter((row) => `${row.productName} ${row.sku} ${row.locationName}`.toLowerCase().includes(term));
  }, [data, searchTerm]);

  const totalUnits = useMemo(() => filteredRows.reduce((sum, row) => sum + row.quantity, 0), [filteredRows]);

  const exportRequest = useMemo<ReportExportRequest | null>(() => {
    if (!data) return null;
    return {
      module: "reports",
      title: `Stock as of ${formatDateLabel(date)}`,
      sections: [
        {
          type: "table",
          title: `Stock as of ${date}`,
          columns: [
            { key: "product", header: "Product" },
            { key: "sku", header: "SKU" },
            { key: "category", header: "Category" },
            { key: "location", header: "Location" },
            { key: "quantity", header: "Quantity", align: "right" }
          ],
          rows: filteredRows.map((row) => ({
            product: row.productName,
            sku: row.sku,
            category: row.categoryName ?? "—",
            location: row.locationName,
            quantity: String(row.quantity)
          }))
        }
      ],
      fileBaseName: `StockAsOf_${date}`
    };
  }, [data, filteredRows, date]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Date</span>
              <input
                type="date"
                value={date}
                max={todayIso()}
                onChange={(event) => setDate(event.target.value)}
                className="mt-1.5 h-10 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search product, SKU, location"
                  className="h-10 w-64 rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
            </label>
          </div>
          {canExport && exportRequest && <ReportExportMenu request={exportRequest} />}
        </div>
        <p className="mt-3 text-xs font-semibold text-muted">
          Ending stock at close of business, {formatDateLabel(date)} — computed from every stock movement recorded up
          to that moment, so this works for any past date, including before this report existed.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex min-h-[240px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-white shadow-soft">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <p className="text-sm font-extrabold text-ink">{filteredRows.length} product rows</p>
            <p className="text-sm font-extrabold tabular-nums text-ink">{totalUnits} units total</p>
          </div>
          {filteredRows.length === 0 ? (
            <p className="p-6 text-center text-sm font-semibold text-muted">
              {data && data.rows.length === 0
                ? "No stock movements exist for this date yet."
                : "No products match your search."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">SKU</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Category</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Location</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={`${row.productId}:${row.locationId}`}
                      className="border-t border-line odd:bg-white even:bg-soft/50"
                    >
                      <td className="line-clamp-2 px-4 py-2.5 font-bold leading-snug text-ink" title={row.productName}>
                        {row.productName}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-semibold text-muted">{row.sku}</td>
                      <td className="truncate px-4 py-2.5 text-xs font-semibold text-muted">{row.categoryName ?? "—"}</td>
                      <td className="truncate px-4 py-2.5 text-xs font-semibold text-muted">{row.locationName}</td>
                      <td
                        className={
                          row.quantity <= 0
                            ? "px-4 py-2.5 text-right font-extrabold tabular-nums text-danger"
                            : "px-4 py-2.5 text-right font-extrabold tabular-nums text-ink"
                        }
                      >
                        {row.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

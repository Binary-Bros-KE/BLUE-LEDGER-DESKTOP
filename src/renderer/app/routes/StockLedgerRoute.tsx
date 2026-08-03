import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { ArrowDownCircle, ArrowUpCircle, Loader2, Search, Warehouse } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { SelectField } from "@renderer/shared/components/form-fields";
import { StatTile } from "@renderer/shared/components/StatTile";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import {
  ALL_YEARS_VALUE,
  buildAvailableYears,
  currentYear,
  matchesYearFilter,
  yearFilterOptions
} from "@renderer/shared/lib/year-filter";
import { useAppStore } from "@renderer/shared/stores/app-store";
import type { ExportListRequest } from "@shared/types/export";
import { STOCK_MOVEMENT_TYPE_OPTIONS, type StockMovementFeedItem, type StockMovementType } from "@shared/types/stock-movement";

const INCREASING_TYPES = new Set<StockMovementType>(["purchase", "transfer_in", "return", "opening_stock"]);

function movementTone(type: StockMovementType): "success" | "danger" | "neutral" {
  if (INCREASING_TYPES.has(type)) return "success";
  if (type === "adjustment") return "neutral";
  return "danger";
}

function movementTypeLabel(type: StockMovementType): string {
  return STOCK_MOVEMENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

export function StockLedgerRoute(): React.JSX.Element {
  const currency = useAppStore((state) => state.context?.tenant.currency ?? "");
  const { can } = usePermissions();
  const canExport = can("inventory", "export");

  const [movements, setMovements] = useState<StockMovementFeedItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<StockMovementType | "all">("all");
  const [yearFilter, setYearFilter] = useState<string>(String(currentYear()));

  const loadMovements = useCallback(async (limit: number) => {
    setLoadError(null);
    try {
      const result = await window.blueLedger.stockMovement.listAll({ limit });
      setMovements(result);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load stock movements"));
    }
  }, []);

  useEffect(() => {
    // The default (current year) only needs the recent-300 feed; picking "All Years" or a past year
    // re-fetches with a much wider cap so older movements are actually there to filter into view.
    void loadMovements(yearFilter === String(currentYear()) ? 300 : 5000);
  }, [loadMovements, yearFilter]);

  const availableYears = useMemo(
    () => buildAvailableYears((movements ?? []).map((movement) => movement.createdAt)),
    [movements]
  );

  const filteredMovements = useMemo(() => {
    if (!movements) return null;
    let list = movements;

    if (typeFilter !== "all") {
      list = list.filter((movement) => movement.movementType === typeFilter);
    }

    list = list.filter((movement) => matchesYearFilter(movement.createdAt, yearFilter));

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((movement) =>
        `${movement.productName} ${movement.sku} ${movement.locationName}`.toLowerCase().includes(term)
      );
    }

    return list;
  }, [movements, searchTerm, typeFilter, yearFilter]);

  const summary = useMemo(() => {
    if (!movements) return null;
    let stockInValueCents = 0;
    let stockOutValueCents = 0;
    for (const movement of movements) {
      if (INCREASING_TYPES.has(movement.movementType)) stockInValueCents += movement.valueCents;
      else if (movement.movementType !== "adjustment") stockOutValueCents += movement.valueCents;
    }
    return { totalMovements: movements.length, stockInValueCents, stockOutValueCents };
  }, [movements]);

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!filteredMovements) return null;
    const filterParts: string[] = [];
    if (typeFilter !== "all") filterParts.push(`Type: ${movementTypeLabel(typeFilter)}`);
    if (searchTerm.trim()) filterParts.push(`Search: "${searchTerm.trim()}"`);
    if (yearFilter !== ALL_YEARS_VALUE) filterParts.push(`Year: ${yearFilter}`);

    return {
      module: "inventory",
      title: "Stock Ledger",
      subtitle: filterParts.length > 0 ? filterParts.join(" · ") : "Every stock movement",
      columns: [
        { key: "date", header: "Date" },
        { key: "product", header: "Product" },
        { key: "sku", header: "SKU" },
        { key: "storefront", header: "Storefront" },
        { key: "type", header: "Type" },
        { key: "change", header: "Change", align: "right" },
        { key: "value", header: "Value", align: "right" },
        { key: "notes", header: "Notes" }
      ],
      rows: filteredMovements.map((movement) => ({
        date: format(new Date(movement.createdAt), "MMM d, yyyy · HH:mm"),
        product: movement.productName,
        sku: movement.sku,
        storefront: movement.locationName,
        type: movementTypeLabel(movement.movementType),
        change: `${movement.quantityChange > 0 ? "+" : ""}${movement.quantityChange}`,
        value: `${currency} ${formatCents(movement.valueCents)}`,
        notes: movement.notes ?? "—"
      })),
      stats: summary
        ? [
            { label: "Total Movements", value: String(summary.totalMovements) },
            { label: "Stock In Value", value: `${currency} ${formatCents(summary.stockInValueCents)}` },
            { label: "Stock Out Value", value: `${currency} ${formatCents(summary.stockOutValueCents)}` }
          ]
        : [],
      fileBaseName: `StockLedger_${new Date().toISOString().slice(0, 10)}`
    };
  }, [filteredMovements, summary, typeFilter, searchTerm, yearFilter, currency]);

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
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Inventory</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <Warehouse className="size-5 text-primary" aria-hidden="true" />
              Stock Ledger
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Every stock movement across every product.
            </p>
          </div>
          {canExport && exportRequest && <ExportMenu request={exportRequest} />}
        </div>

        {loadError && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError}
          </div>
        )}

        {summary && (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile icon={Warehouse} label="Total Movements" value={String(summary.totalMovements)} tone="primary" />
            <StatTile
              icon={ArrowUpCircle}
              label="Stock In Value"
              value={`${currency} ${formatCents(summary.stockInValueCents)}`}
              tone="success"
            />
            <StatTile
              icon={ArrowDownCircle}
              label="Stock Out Value"
              value={`${currency} ${formatCents(summary.stockOutValueCents)}`}
              tone="danger"
            />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-b border-line pb-3">
          <button
            type="button"
            onClick={() => setTypeFilter("all")}
            className={cn(
              "h-8 rounded-lg px-3 text-xs font-extrabold transition cursor-pointer",
              typeFilter === "all" ? "bg-primary text-white" : "text-muted hover:bg-soft"
            )}
          >
            All
          </button>
          {STOCK_MOVEMENT_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTypeFilter(option.value)}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-extrabold transition cursor-pointer",
                typeFilter === option.value ? "bg-primary text-white" : "text-muted hover:bg-soft"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block sm:max-w-xs sm:flex-1">
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
                placeholder="Search by product, SKU, or storefront"
                className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
            </div>
          </label>
          <SelectField
            label="Year"
            value={yearFilter}
            onChange={setYearFilter}
            options={yearFilterOptions(availableYears)}
            className="w-32"
          />
        </div>

        <div className="mt-5">
          {movements === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : filteredMovements && filteredMovements.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <Warehouse className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No stock movements found</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                {movements.length === 0 ? "Nothing recorded yet." : "Try a different filter or search term."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[12%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" /> 
                  <col className="w-[10%]" />
                  <col className="w-[5%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Date</Th>
                    <Th>Product</Th>
                    <Th>Storefront</Th>
                    <Th>Type</Th>
                    <Th className="text-right">Change</Th>
                    <Th className="text-right">Value</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredMovements ?? []).map((movement) => (
                    <tr key={movement.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="px-3 py-2.5 text-xs tabular-nums text-muted">
                        {format(new Date(movement.createdAt), "MMM d, yyyy · HH:mm")}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-bold text-ink">{movement.productName}</p>
                        <p className="text-[11px] text-muted">{movement.sku}</p>
                      </td>
                      <td className="truncate px-3 py-2.5 text-xs font-semibold text-muted">{movement.locationName}</td>
                      <td className="px-3 py-2.5">
                        <DashedPill tone={movementTone(movement.movementType)}>
                          {movementTypeLabel(movement.movementType)}
                        </DashedPill>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-extrabold tabular-nums",
                          movement.quantityChange > 0 ? "text-success" : "text-danger"
                        )}
                      >
                        {movement.quantityChange > 0 ? "+" : ""}
                        {movement.quantityChange}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-ink">
                        {currency} {formatCents(movement.valueCents)}
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

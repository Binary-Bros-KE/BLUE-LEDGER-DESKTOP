import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2, PackageSearch } from "lucide-react";
import { format } from "date-fns";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { HorizontalBarList } from "@renderer/shared/components/charts/HorizontalBarList";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { DashboardActionCard } from "@renderer/app/routes/dashboard/DashboardActionCard";
import { DashboardShell } from "@renderer/app/routes/dashboard/DashboardShell";
import { SyncStatusCard } from "@renderer/app/routes/dashboard/SyncStatusCard";
import { OverviewCard } from "@renderer/app/routes/reports/FinancialOverviewCards";
import type { InventoryReportData } from "@shared/types/inventory-report";
import type { MainStoreProductRow } from "@shared/types/main-store";
import { STOCK_MOVEMENT_TYPE_OPTIONS, type StockMovementType } from "@shared/types/stock-movement";
import type { OutstandingPurchasesSummary } from "@shared/types/supplier-report";

function money(cents: number): string {
  return formatCents(cents);
}

const INCREASING_TYPES = new Set<StockMovementType>(["purchase", "transfer_in", "return", "opening_stock"]);

function movementTone(type: StockMovementType): "success" | "danger" | "neutral" {
  if (INCREASING_TYPES.has(type)) return "success";
  if (type === "adjustment") return "neutral";
  return "danger";
}

function movementTypeLabel(type: StockMovementType): string {
  return STOCK_MOVEMENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

type StorekeeperData = {
  inventoryData: InventoryReportData;
  productsNeedingReallocation: MainStoreProductRow[];
  outstandingPurchases: OutstandingPurchasesSummary;
};

function SectionHeading({ title, action }: { title: string; action?: { label: string; onClick: () => void } }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-extrabold text-ink">{title}</h3>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline cursor-pointer"
        >
          {action.label}
          <ArrowRight className="size-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The storekeeper's view: Main Store's own physical stock health, what needs
 * to move out to storefronts before they run dry, how much is already
 * earmarked vs. sitting free, and what's still owed to suppliers. Sales
 * figures don't belong here — the storekeeper's world is what's on the
 * shelves, not what's in the till. */
export function StorekeeperDashboard(): React.JSX.Element {
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);
  const [data, setData] = useState<StorekeeperData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [inventoryData, mainStoreRows, outstandingPurchases] = await Promise.all([
          window.blueLedger.report.inventoryData(),
          window.blueLedger.mainStore.listProductRows(),
          window.blueLedger.report.outstandingPurchases(),
        ]);

        if (cancelled) return;

        const productsNeedingReallocation = mainStoreRows
          .filter((row) => row.hasLowStock)
          .sort((a, b) => b.unallocatedQuantity - a.unallocatedQuantity);

        setData({ inventoryData, productsNeedingReallocation, outstandingPurchases });
      } catch (err) {
        if (!cancelled) {
          const message = getErrorMessage(err, "Failed to load the dashboard");
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
  }, []);

  const mainStoreSection = data?.inventoryData.sections.find((section) => section.isMainStore) ?? null;
  const storefrontSections = data?.inventoryData.sections.filter((section) => !section.isMainStore) ?? [];
  const seesAllStorefronts = storefrontSections.length > 0;

  const allocationBars = useMemo(
    () =>
      (mainStoreSection?.allocation?.byStorefront ?? []).map((row) => ({
        key: row.storefrontId,
        label: row.storefrontName,
        value: row.allocatedQuantity,
      })),
    [mainStoreSection]
  );
  const storefrontValueBars = useMemo(
    () => storefrontSections.map((section) => ({ key: section.locationId, label: section.locationName, value: section.stockValueCents })),
    [storefrontSections]
  );

  if (error) {
    return <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>;
  }

  if (loading || !data || !mainStoreSection) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-muted">
        <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <DashboardShell
      main={
        <>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {seesAllStorefronts ? "All storefronts" : mainStoreSection.locationName}
          </p>

          <div>
            <SectionHeading
              title={seesAllStorefronts ? "Stock health, across the business" : "Main Store stock health"}
              action={{ label: "Full Inventory Report", onClick: () => setActiveNavKey("reports-inventory") }}
            />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <OverviewCard tone="primary" label="Distinct Products" displayValue={String(data.inventoryData.overview.distinctProductCount)} formula="Unique SKUs tracked" />
              <OverviewCard tone="teal" label="Total Units" displayValue={String(data.inventoryData.overview.totalUnits)} formula="Every unit on the shelf" />
              <OverviewCard tone="success" label="Stock Value" valueCents={data.inventoryData.overview.totalStockValueCents} formula="At buying price" />
            </div>
          </div>

          {seesAllStorefronts && (
            <div className="rounded-lg border border-line bg-white p-4">
              <SectionHeading title="Stock value by storefront" action={{ label: "Full Inventory Report", onClick: () => setActiveNavKey("reports-inventory") }} />
              <div className="mt-3">
                <HorizontalBarList items={storefrontValueBars} formatValue={money} categorical emptyMessage="No storefronts have received stock yet." />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-line bg-white p-4">
            <SectionHeading title="Allocated to storefronts, awaiting distribution" action={{ label: "Main Store", onClick: () => setActiveNavKey("main-store") }} />
            <p className="mt-1 text-xs font-semibold text-muted">
              {mainStoreSection.allocation?.totalUnallocated ?? 0} units still unallocated ·{" "}
              {mainStoreSection.allocation?.totalAllocated ?? 0} units earmarked for a storefront
            </p>
            <div className="mt-3">
              <HorizontalBarList
                items={allocationBars}
                formatValue={(value) => `${value} units`}
                categorical
                emptyMessage="Nothing has been allocated to a storefront yet."
              />
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <PackageSearch className="size-4 text-warning" aria-hidden="true" />
                <h3 className="text-sm font-extrabold text-ink">Needs reallocation — low at a storefront</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveNavKey("main-store")}
                className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline cursor-pointer"
              >
                Go to Main Store
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            </div>
            {data.productsNeedingReallocation.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-muted">Every storefront is stocked above its reorder level. Nothing urgent.</p>
            ) : (
              <div className="mt-3 max-h-[320px] overflow-y-auto rounded-lg border border-line">
                <table className="w-full table-fixed border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line bg-soft/60 text-[11px] font-bold uppercase tracking-wide text-muted">
                      <th className="w-[50%] px-3 py-2 text-left">Product</th>
                      <th className="w-28 px-3 py-2 text-right">At Main Store</th>
                      <th className="px-3 py-2 text-left">Low at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.productsNeedingReallocation.slice(0, 12).map((row) => {
                      const lowStorefronts = row.storefronts.filter((sf) => sf.isLow).map((sf) => sf.storefrontName);
                      return (
                        <tr key={row.productId} className="border-t border-line odd:bg-white even:bg-soft/50 first:border-t-0">
                          <td className="line-clamp-2 px-3 py-2 leading-snug font-bold text-ink" title={row.productName}>
                            {row.productName}
                          </td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{row.unallocatedQuantity}</td>
                          <td className="truncate px-3 py-2 text-xs font-semibold text-warning" title={lowStorefronts.join(", ")}>
                            {lowStorefronts.join(", ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line bg-white">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <h3 className="text-sm font-extrabold text-ink">Recent stock movements at Main Store</h3>
              <button
                type="button"
                onClick={() => setActiveNavKey("stock")}
                className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline cursor-pointer"
              >
                Stock Ledger
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            </div>
            {mainStoreSection.movements.length === 0 ? (
              <p className="px-4 pb-4 text-sm font-semibold text-muted">No stock movements recorded yet.</p>
            ) : (
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[40%]" />
                    <col className="w-[24%]" />
                    <col className="w-[20%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <thead className="sticky top-0">
                    <tr className="bg-primary text-white">
                      <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                      <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Type</th>
                      <th className="px-4 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Date</th>
                      <th className="px-4 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mainStoreSection.movements.slice(0, 12).map((movement) => {
                      const type = movement.movementType as StockMovementType;
                      return (
                        <tr key={movement.id} className="border-t border-line odd:bg-white even:bg-soft/50">
                          <td className="px-4 py-2.5 font-bold text-ink" title={movement.productName}>
                            <p className="line-clamp-2 leading-snug">{movement.productName}</p>
                            {movement.performedByName && (
                              <p className="mt-0.5 text-[11px] font-semibold text-muted">{movement.performedByName}</p>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <DashedPill tone={movementTone(type)}>{movementTypeLabel(type)}</DashedPill>
                          </td>
                          <td className="px-4 py-2.5 text-xs font-semibold text-muted">{format(new Date(movement.createdAt), "d MMM, HH:mm")}</td>
                          <td
                            className={cn(
                              "px-4 py-2.5 text-right font-bold tabular-nums",
                              movement.quantityChange >= 0 ? "text-success" : "text-danger"
                            )}
                          >
                            {movement.quantityChange > 0 ? "+" : ""}
                            {movement.quantityChange}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      }
      aside={
        <>
          <DashboardActionCard
            tone="warning"
            label="Low Stock"
            value={String(data.inventoryData.overview.lowStockProductCount)}
            sublabel={seesAllStorefronts ? "Products low anywhere" : "Products low at Main Store"}
            actionLabel="Check inventory"
            onAction={() => setActiveNavKey("reports-inventory")}
          />
          <DashboardActionCard
            tone="danger"
            label="Out of Stock"
            value={String(data.inventoryData.overview.outOfStockProductCount)}
            sublabel={seesAllStorefronts ? "Products at zero anywhere" : "Products at zero at Main Store"}
            actionLabel="Check inventory"
            onAction={() => setActiveNavKey("reports-inventory")}
          />
          <SyncStatusCard />
        </>
      }
    />
  );
}

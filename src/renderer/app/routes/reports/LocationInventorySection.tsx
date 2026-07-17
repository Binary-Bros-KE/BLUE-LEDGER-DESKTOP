import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { LocationInventorySection as LocationInventorySectionData, LocationProductRow } from "@shared/types/inventory-report";
import { InventoryMovementHistoryTable } from "./InventoryMovementHistoryTable";

function money(cents: number): string {
  return formatCents(cents);
}

type StorefrontFilter = "all" | "low" | "out";
type MainStoreFilter = "all" | "low-store" | "low-shop" | "low-either";

function Severity({ isLow, isOutOfStock, tone }: { isLow: boolean; isOutOfStock: boolean; tone: "amber" | "shop" }): React.JSX.Element | null {
  if (isOutOfStock) {
    return (
      <span
        className={cn(
          "ml-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
          tone === "shop" ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"
        )}
      >
        Out
      </span>
    );
  }
  if (isLow) {
    return <span className="ml-1.5 inline-block rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-warning">Low</span>;
  }
  return null;
}

function rowToneClass(row: LocationProductRow, isMainStore: boolean): string {
  if (isMainStore) {
    if (row.storefrontIsOutOfStock) return "bg-danger-soft/40";
    if (row.storefrontIsLow || row.isLow || row.isOutOfStock) return "bg-warning/5";
    return "";
  }
  if (row.isOutOfStock) return "bg-danger-soft/40";
  if (row.isLow) return "bg-warning/5";
  return "";
}

function filterMainStoreRows(rows: LocationProductRow[], filter: MainStoreFilter): LocationProductRow[] {
  if (filter === "all") return rows;
  if (filter === "low-store") return rows.filter((r) => r.isLow || r.isOutOfStock);
  if (filter === "low-shop") return rows.filter((r) => r.storefrontIsLow || r.storefrontIsOutOfStock);
  return rows.filter((r) => r.isLow || r.isOutOfStock || r.storefrontIsLow || r.storefrontIsOutOfStock);
}

function filterStorefrontRows(rows: LocationProductRow[], filter: StorefrontFilter): LocationProductRow[] {
  if (filter === "all") return rows;
  if (filter === "low") return rows.filter((r) => r.isLow);
  return rows.filter((r) => r.isOutOfStock);
}

function SegmentedButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition cursor-pointer",
        active ? "bg-primary text-white" : "text-muted hover:bg-white"
      )}
    >
      {children}
    </button>
  );
}

/** Everything about one location, self-contained: stats, a filterable
 * product table with store/shop severity badges, and a collapsible stock
 * movement history. The Main Store section additionally shows each
 * product's total quantity out across every storefront, with the shop side
 * winning any color/priority conflict — an empty store shelf backed by full
 * storefronts is a caution; an empty storefront shelf is the real alarm. A
 * storefront section shows Main Store's own quantity and how much of it is
 * earmarked for this specific shop, alongside what's actually on its shelf. */
export function LocationInventorySection({
  section,
  onSelectProduct,
}: {
  section: LocationInventorySectionData;
  onSelectProduct: (productId: string) => void;
}): React.JSX.Element {
  const [mainStoreFilter, setMainStoreFilter] = useState<MainStoreFilter>("all");
  const [storefrontFilter, setStorefrontFilter] = useState<StorefrontFilter>("all");
  const [showMovements, setShowMovements] = useState(true);

  const visibleRows = useMemo(
    () => (section.isMainStore ? filterMainStoreRows(section.products, mainStoreFilter) : filterStorefrontRows(section.products, storefrontFilter)),
    [section, mainStoreFilter, storefrontFilter]
  );

  const showMainStoreReference = !section.isMainStore && section.products.some((p) => p.mainStoreQuantity !== null);

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-extrabold text-ink">{section.locationName}</h4>
          {section.isMainStore && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">Main Store</span>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-line bg-soft/60 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-muted">Products</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-ink">{section.productCount}</p>
        </div>
        <div className="rounded-md border border-line bg-soft/60 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-muted">Low Stock</p>
          <p className={cn("mt-0.5 text-lg font-bold tabular-nums", section.lowStockCount > 0 ? "text-warning" : "text-ink")}>
            {section.lowStockCount}
          </p>
        </div>
        <div className="rounded-md border border-line bg-soft/60 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-muted">Out of Stock</p>
          <p className={cn("mt-0.5 text-lg font-bold tabular-nums", section.outOfStockCount > 0 ? "text-danger" : "text-ink")}>
            {section.outOfStockCount}
          </p>
        </div>
        <div className="rounded-md border border-line bg-soft/60 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-muted">Stock Value</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-ink">{money(section.stockValueCents)}</p>
        </div>
      </div>

      {section.allocation && (
        <div className="mt-3 rounded-md border border-line bg-soft/40 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Allocated but not yet distributed — earmarked here, no physical movement yet
          </p>
          <p className="mt-1 text-xs font-bold text-ink">
            {section.allocation.totalAllocated} units allocated to storefronts, {section.allocation.totalUnallocated} unallocated
          </p>
          {section.allocation.byStorefront.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {section.allocation.byStorefront.map((entry) => (
                <span
                  key={entry.storefrontId}
                  className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-bold text-ink"
                >
                  {entry.storefrontName}: {entry.allocatedQuantity}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 rounded-lg border border-line bg-soft p-1">
        {section.isMainStore ? (
          <>
            <SegmentedButton active={mainStoreFilter === "all"} onClick={() => setMainStoreFilter("all")}>
              All
            </SegmentedButton>
            <SegmentedButton active={mainStoreFilter === "low-store"} onClick={() => setMainStoreFilter("low-store")}>
              Low/Out in Store
            </SegmentedButton>
            <SegmentedButton active={mainStoreFilter === "low-shop"} onClick={() => setMainStoreFilter("low-shop")}>
              Low/Out in Shop
            </SegmentedButton>
            <SegmentedButton active={mainStoreFilter === "low-either"} onClick={() => setMainStoreFilter("low-either")}>
              Either
            </SegmentedButton>
          </>
        ) : (
          <>
            <SegmentedButton active={storefrontFilter === "all"} onClick={() => setStorefrontFilter("all")}>
              All
            </SegmentedButton>
            <SegmentedButton active={storefrontFilter === "low"} onClick={() => setStorefrontFilter("low")}>
              Low Stock
            </SegmentedButton>
            <SegmentedButton active={storefrontFilter === "out"} onClick={() => setStorefrontFilter("out")}>
              Out of Stock
            </SegmentedButton>
          </>
        )}
      </div>

      {section.products.length === 0 ? (
        <p className="mt-4 text-sm font-semibold text-muted">
          No stock has physically moved into this location yet.
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="mt-4 text-sm font-semibold text-muted">No products match this filter.</p>
      ) : (
        <>
          {showMainStoreReference && (
            <p className="mt-3 text-[11px] font-semibold text-muted">
              Value and % below combine this shop&rsquo;s own stock with Main Store&rsquo;s stock of the same product —
              the Stock Value tile above is this shop&rsquo;s own stock only.
            </p>
          )}
          <div className="mt-3 max-h-[480px] overflow-y-auto rounded-lg border border-line">
            <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-primary text-white">
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Product</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">SKU</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Category</th>
                  {showMainStoreReference && (
                    <>
                      <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty in Main Store</th>
                      <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Allocated to This Shop</th>
                    </>
                  )}
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">
                    {section.isMainStore ? "Qty in Store" : "Qty Available Here"}
                  </th>
                  {section.isMainStore && (
                    <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Qty in Storefronts</th>
                  )}
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Unit Cost</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Value</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">%</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.productId} className={cn("border-t border-line", rowToneClass(row, section.isMainStore))}>
                    <td className="px-3 py-2 font-bold text-ink">
                      <button
                        type="button"
                        onClick={() => onSelectProduct(row.productId)}
                        className="line-clamp-2 text-left leading-snug text-ink underline decoration-line decoration-dotted underline-offset-2 hover:text-accent cursor-pointer"
                        title={row.productName}
                      >
                        {row.productName}
                      </button>
                    </td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.sku}</td>
                    <td className="truncate px-3 py-2 text-xs font-semibold text-muted">{row.categoryName ?? "—"}</td>
                    {showMainStoreReference && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{row.mainStoreQuantity ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{row.allocatedToThisStorefront ?? "—"}</td>
                      </>
                    )}
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                      {row.quantity}
                      <Severity isLow={row.isLow} isOutOfStock={row.isOutOfStock} tone="amber" />
                    </td>
                    {section.isMainStore && (
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">
                        {row.storefrontTotalQuantity}
                        <Severity isLow={row.storefrontIsLow ?? false} isOutOfStock={row.storefrontIsOutOfStock ?? false} tone="shop" />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(row.buyingPriceCents)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(row.valueCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{row.percentOfLocationValue.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setShowMovements((prev) => !prev)}
        className="mt-4 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-accent hover:underline cursor-pointer"
      >
        {showMovements ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
        Stock movement history ({section.movements.length})
      </button>
      {showMovements && (
        <div className="mt-3">
          <InventoryMovementHistoryTable rows={section.movements} />
        </div>
      )}
    </div>
  );
}

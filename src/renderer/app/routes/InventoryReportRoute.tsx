import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Boxes, Loader2 } from "lucide-react";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { InventoryReportData } from "@shared/types/inventory-report";
import { OverviewCard } from "./reports/FinancialOverviewCards";
import { InventoryStockValueSection } from "./reports/InventoryStockValueSection";
import { LocationInventorySection } from "./reports/LocationInventorySection";
import { ProductDetailModal } from "./reports/ProductDetailModal";

export function InventoryReportRoute(): React.JSX.Element {
  const [data, setData] = useState<InventoryReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.blueLedger.report.inventoryData();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, "Failed to load the inventory report"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 space-y-5 pb-10">
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Insights</p>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
          <Boxes className="size-5 text-primary" aria-hidden="true" />
          Inventory Report
        </h2>
        <p className="mt-1 text-xs font-semibold text-muted">
          Stock on hand, low and out-of-stock alerts, stock value, and movement history — Main Store first, then each
          storefront, however your stock is organized.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
      )}

      {loading && !data && (
        <div className="flex min-h-[240px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewCard
              tone="primary"
              label="Total Products"
              displayValue={String(data.overview.distinctProductCount)}
              formula="Distinct products, across Main Store and every storefront"
            />
            <OverviewCard
              tone="teal"
              label="Total Units On Hand"
              displayValue={String(data.overview.totalUnits)}
              formula="Every unit, everywhere it's held"
            />
            <OverviewCard
              tone="warning"
              label="Low Stock"
              displayValue={String(data.overview.lowStockProductCount)}
              formula="Distinct products low anywhere — store or storefront"
            />
            <OverviewCard
              tone="danger"
              label="Out of Stock"
              displayValue={String(data.overview.outOfStockProductCount)}
              formula="Distinct products at zero anywhere — store or storefront"
            />
          </div>

          <InventoryStockValueSection entries={data.categoryValueBreakdown} />

          <div className="space-y-4">
            {data.sections.map((section) => (
              <LocationInventorySection key={section.locationId} section={section} onSelectProduct={setSelectedProductId} />
            ))}
          </div>

          <ProductDetailModal productId={selectedProductId} sections={data.sections} onClose={() => setSelectedProductId(null)} />
        </>
      )}
    </motion.div>
  );
}

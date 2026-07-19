import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Boxes, Loader2 } from "lucide-react";
import { ExportMenu } from "@renderer/shared/components/ExportMenu";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import type { ExportListRequest } from "@shared/types/export";
import type { InventoryReportData } from "@shared/types/inventory-report";
import { OverviewCard } from "./reports/FinancialOverviewCards";
import { InventoryStockValueSection } from "./reports/InventoryStockValueSection";
import { LocationInventorySection } from "./reports/LocationInventorySection";
import { ProductDetailModal } from "./reports/ProductDetailModal";

export function InventoryReportRoute(): React.JSX.Element {
  const { can } = usePermissions();
  const canExport = can("reports", "export");
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

  const exportRequest = useMemo<ExportListRequest | null>(() => {
    if (!data) return null;
    return {
      module: "reports",
      title: "Inventory Report — Stock Value by Category",
      columns: [
        { key: "category", header: "Category" },
        { key: "units", header: "Units", align: "right" },
        { key: "value", header: "Value", align: "right" },
        { key: "percentOfTotal", header: "% of Total", align: "right" }
      ],
      rows: data.categoryValueBreakdown.map((entry) => ({
        category: entry.name,
        units: String(entry.quantity),
        value: formatCents(entry.valueCents),
        percentOfTotal: `${entry.percentOfTotal.toFixed(1)}%`
      })),
      stats: [
        { label: "Total Products", value: String(data.overview.distinctProductCount) },
        { label: "Total Units On Hand", value: String(data.overview.totalUnits) },
        { label: "Low Stock", value: String(data.overview.lowStockProductCount) },
        { label: "Out of Stock", value: String(data.overview.outOfStockProductCount) }
      ],
      fileBaseName: `InventoryReport_${new Date().toISOString().slice(0, 10)}`
    };
  }, [data]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
        {canExport && exportRequest && <ExportMenu request={exportRequest} />}
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

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Truck } from "lucide-react";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { OutstandingPurchasesSummary } from "@shared/types/supplier-report";
import { OutstandingPurchasesSection } from "./reports/OutstandingPurchasesSection";
import { SupplierPurchaseHistorySection } from "./reports/SupplierPurchaseHistorySection";

export function SuppliersReportRoute(): React.JSX.Element {
  const [outstanding, setOutstanding] = useState<OutstandingPurchasesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.blueLedger.report.outstandingPurchases();
        if (!cancelled) setOutstanding(result);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err, "Failed to load the suppliers report"));
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
          <Truck className="size-5 text-primary" aria-hidden="true" />
          Suppliers Report
        </h2>
        <p className="mt-1 text-xs font-semibold text-muted">
          Every outstanding supplier payment right now, plus a full purchase history for any single supplier.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
      )}

      {loading && !outstanding && (
        <div className="flex min-h-[240px] items-center justify-center text-muted">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
        </div>
      )}

      {outstanding && <OutstandingPurchasesSection summary={outstanding} />}

      <SupplierPurchaseHistorySection />
    </motion.div>
  );
}

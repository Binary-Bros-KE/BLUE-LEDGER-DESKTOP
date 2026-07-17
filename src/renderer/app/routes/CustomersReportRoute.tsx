import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Users } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import type { DateRangeInput, SalesReportMode } from "@shared/types/report";
import type { OutstandingInvoicesSummary, TopCustomerRow } from "@shared/types/customer-report";
import { CustomerPurchaseHistorySection } from "./reports/CustomerPurchaseHistorySection";
import { OutstandingInvoicesSection } from "./reports/OutstandingInvoicesSection";
import { defaultAnchorForMode, rangeForAnchor, shiftAnchor, todayIso } from "./reports/salesReportDate";
import { SalesModeSelector } from "./reports/SalesModeSelector";
import { TopCustomersTable } from "./reports/TopCustomersTable";

export function CustomersReportRoute(): React.JSX.Element {
  const [mode, setMode] = useState<SalesReportMode>("monthly");
  const [anchor, setAnchor] = useState<string>(() => defaultAnchorForMode("monthly"));
  const [customRange, setCustomRange] = useState<DateRangeInput>(() => ({
    startDate: shiftAnchor("daily", todayIso(), -29),
    endDate: todayIso(),
  }));

  function handleModeChange(nextMode: SalesReportMode): void {
    setMode(nextMode);
    if (nextMode !== "custom") setAnchor(defaultAnchorForMode(nextMode));
  }

  const resolvedRange = useMemo<DateRangeInput>(
    () => (mode === "custom" ? customRange : rangeForAnchor(mode, anchor)),
    [mode, anchor, customRange]
  );

  const [topCustomers, setTopCustomers] = useState<TopCustomerRow[] | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingInvoicesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: DateRangeInput) => {
    setLoading(true);
    setError(null);
    try {
      const [topCustomersResult, outstandingResult] = await Promise.all([
        window.blueLedger.report.topCustomers(range),
        window.blueLedger.report.outstandingInvoices(),
      ]);
      setTopCustomers(topCustomersResult);
      setOutstanding(outstandingResult);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load the customers report"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(resolvedRange);
  }, [resolvedRange.startDate, resolvedRange.endDate, load]);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-6 space-y-5 pb-10">
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Insights</p>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
          <Users className="size-5 text-primary" aria-hidden="true" />
          Customers Report
        </h2>
        <p className="mt-1 text-xs font-semibold text-muted">
          Top customers for a period you pick, every outstanding invoice right now, and a full purchase history for
          any single customer.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <SalesModeSelector
          mode={mode}
          onModeChange={handleModeChange}
          anchor={anchor}
          onAnchorChange={setAnchor}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
        />

        {error && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>
        )}

        <div className={cn("mt-5 space-y-4 transition-opacity", loading && "opacity-60")}>
          {loading && !topCustomers && (
            <div className="flex min-h-[200px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          )}
          {topCustomers && <TopCustomersTable rows={topCustomers} />}
        </div>
      </div>

      {outstanding && <OutstandingInvoicesSection summary={outstanding} />}

      <CustomerPurchaseHistorySection />
    </motion.div>
  );
}

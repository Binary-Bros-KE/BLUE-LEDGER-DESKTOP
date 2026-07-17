import { ArrowRight } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { SalesCategoryBreakdownEntry, SalesFinancialOverview } from "@shared/types/report";

function money(cents: number): string {
  return formatCents(cents);
}

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

function FormulaLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-ink">{children}</div>;
}

function CategoryBreakdownTable({
  entries,
  nameHeader,
  emptyMessage,
}: {
  entries: SalesCategoryBreakdownEntry[];
  nameHeader: string;
  emptyMessage: string;
}): React.JSX.Element {
  if (entries.length === 0) {
    return <p className="mt-4 text-sm font-semibold text-muted">{emptyMessage}</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] table-fixed border-collapse text-sm">
        <thead>
          <tr className="bg-primary text-white">
            <Th>{nameHeader}</Th>
            <Th className="text-right">Times Paid</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">% of Total</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-line odd:bg-white even:bg-soft/50">
              <td className="truncate px-3 py-2 font-bold text-ink">{entry.name}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.documentCount}</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{money(entry.totalCents)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{entry.percentOfTotal.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BreakdownCard({
  label,
  onNavigate,
  navigateLabel,
  children,
}: {
  label: string;
  onNavigate: () => void;
  navigateLabel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <button
          type="button"
          onClick={onNavigate}
          className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline cursor-pointer"
        >
          {navigateLabel}
          <ArrowRight className="size-3" aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  );
}

/** Where the cash came from (retail/wholesale + invoice payments, net of
 * refunds), tax/discount reference figures, and the Top 10 products behind
 * it — the revenue half of "how we calculate this". Exported standalone so
 * Finance Report can present it under its own "Revenue Summary" heading. */
export function RevenueSummaryBlock({
  overview,
  onNavigateToProducts,
}: {
  overview: SalesFinancialOverview;
  onNavigateToProducts: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="rounded-lg border border-line bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Total Revenue — where the cash came from</p>
        <FormulaLine>
          <span>{money(overview.retailWholesaleRevenueCents)}</span>
          <span className="text-xs font-semibold text-muted">({overview.retailWholesaleDocumentCount} retail/wholesale sales)</span>
          <span className="text-muted">+</span>
          <span>{money(overview.invoicePaymentRevenueCents)}</span>
          <span className="text-xs font-semibold text-muted">({overview.invoicePaymentDocumentCount} invoice payments received)</span>
          {overview.returnRefundCents > 0 && (
            <>
              <span className="text-muted">−</span>
              <span className="text-danger">{money(overview.returnRefundCents)}</span>
              <span className="text-xs font-semibold text-muted">
                ({overview.returnRefundDocumentCount} approved return{overview.returnRefundDocumentCount === 1 ? "" : "s"} refunded)
              </span>
            </>
          )}
          <span className="text-muted">=</span>
          <span className="text-accent">{money(overview.totalRevenueCents)}</span>
        </FormulaLine>
        <p className="mt-2 text-xs font-semibold text-muted">
          Only cash actually received counts, net of anything refunded — an invoice&rsquo;s unpaid balance isn&rsquo;t
          revenue yet, and voided or cancelled sales are never counted.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-line bg-soft/60 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Tax collected</p>
            <p className="mt-0.5 text-sm font-bold text-ink">{money(overview.taxCollectedCents)}</p>
            <p className="text-[11px] font-semibold text-muted">
              From {overview.transactionCount} document{overview.transactionCount === 1 ? "" : "s"} — accounted for in sale
              receipts, shown here for reference only.
            </p>
          </div>
          <div className="rounded-md border border-line bg-soft/60 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Discounts given</p>
            <p className="mt-0.5 text-sm font-bold text-ink">{money(overview.discountGivenCents)}</p>
            <p className="text-[11px] font-semibold text-muted">
              From {overview.transactionCount} document{overview.transactionCount === 1 ? "" : "s"} — accounted for in sale
              receipts, shown here for reference only.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Top 10 products sold</p>
          <button
            type="button"
            onClick={onNavigateToProducts}
            className="flex items-center gap-1 text-[11px] font-bold text-accent hover:underline cursor-pointer"
          >
            Full breakdown in Products Report
            <ArrowRight className="size-3" aria-hidden="true" />
          </button>
        </div>
        {overview.topProducts.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-muted">No products sold in this period.</p>
        ) : (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-3 rounded-t-lg bg-primary px-3 py-2.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
              <span>Product</span>
              <div className="flex flex-none items-center gap-3">
                <span>Qty Sold</span>
                <span className="w-20 text-right">Revenue</span>
              </div>
            </div>
            <ol className="mt-2 space-y-2">
              {overview.topProducts.map((product, index) => (
                <li key={product.productId} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-5 flex-none place-items-center rounded-full bg-soft text-[10px] font-extrabold text-muted">
                      {index + 1}
                    </span>
                    <span className="truncate font-bold text-ink">{product.productName}</span>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    <span className="text-xs font-semibold text-muted">{product.quantitySold} sold</span>
                    <span className="w-20 text-right text-xs font-bold tabular-nums text-ink">{money(product.revenueCents)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </>
  );
}

/** Gross margin on everything sold, and how much of it is actually
 * recognized as profit so far — the bridge between "goods sold" and Net
 * Revenue/Net Profit. Exported standalone so Finance Report can present it
 * under its own "Profit Summary" heading. */
export function NetRevenueBlock({ overview }: { overview: SalesFinancialOverview }): React.JSX.Element {
  const fullMarginCents = overview.grossSalesCents - overview.costOfGoodsSoldCents;
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Net Revenue — profit on goods sold</p>
      <FormulaLine>
        <span>{money(overview.grossSalesCents)}</span>
        <span className="text-xs font-semibold text-muted">gross sales</span>
        <span className="text-muted">−</span>
        <span>{money(overview.costOfGoodsSoldCents)}</span>
        <span className="text-xs font-semibold text-muted">cost of goods sold</span>
        <span className="text-muted">=</span>
        <span>{money(fullMarginCents)}</span>
        <span className="text-xs font-semibold text-muted">full margin on everything sold this period</span>
      </FormulaLine>
      <p className="mt-2 text-xs font-semibold text-muted">
        Of that {money(fullMarginCents)}, only the portion already paid for in cash counts as real profit right now —
        that recognized amount, <span className="font-bold text-ink">{money(overview.netRevenueCents)}</span>, is the Net
        Revenue shown above. If a partly-paid invoice from this period gets paid off later, this period&rsquo;s Net Revenue
        will rise the next time you check. See the accuracy notice above the trend graph for why this can never be
        perfectly exact.
      </p>
    </div>
  );
}

/** Where the money went (general expenses + supplier payments + salaries),
 * broken down by category/supplier/employee. Exported standalone so Finance
 * Report can present it under its own "Expense Summary" heading. */
export function ExpenseSummaryBlock({
  overview,
  onNavigateToExpenses,
  onNavigateToPurchases,
  onNavigateToSalaries,
}: {
  overview: SalesFinancialOverview;
  onNavigateToExpenses: () => void;
  onNavigateToPurchases: () => void;
  onNavigateToSalaries: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="rounded-lg border border-line bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Total Expenses — where the money went</p>
        <FormulaLine>
          <span>{money(overview.generalExpensesCents)}</span>
          <span className="text-xs font-semibold text-muted">({overview.generalExpensesDocumentCount} expense records)</span>
          <span className="text-muted">+</span>
          <span>{money(overview.purchasesPaidCents)}</span>
          <span className="text-xs font-semibold text-muted">({overview.purchasesPaidDocumentCount} supplier payments)</span>
          <span className="text-muted">+</span>
          <span>{money(overview.salariesPaidCents)}</span>
          <span className="text-xs font-semibold text-muted">({overview.salariesPaidDocumentCount} payslips)</span>
          {overview.deliveryServiceCostsCents > 0 && (
            <>
              <span className="text-muted">+</span>
              <span>{money(overview.deliveryServiceCostsCents)}</span>
              <span className="text-xs font-semibold text-muted">
                (hidden cost on {overview.deliveryServiceCostsDocumentCount} delivery/service charge
                {overview.deliveryServiceCostsDocumentCount === 1 ? "" : "s"})
              </span>
            </>
          )}
          <span className="text-muted">=</span>
          <span className="text-danger">{money(overview.totalExpensesCents)}</span>
        </FormulaLine>
        <p className="mt-2 text-xs font-semibold text-muted">
          Only cash actually paid out counts — an unpaid supplier bill isn&rsquo;t an expense yet (see Creditors below).
          Delivery/service costs are the internal, never-printed cost side of any delivery fee or custom charge added
          on a sale — this is what tells you whether delivery and services are actually profitable.
        </p>
      </div>

      <BreakdownCard label="Expenses by category" onNavigate={onNavigateToExpenses} navigateLabel="Full expenses report">
        <CategoryBreakdownTable entries={overview.expensesByCategory} nameHeader="Category" emptyMessage="No expenses recorded in this period." />
      </BreakdownCard>

      <BreakdownCard label="Purchases by supplier" onNavigate={onNavigateToPurchases} navigateLabel="Full purchases report">
        <CategoryBreakdownTable
          entries={overview.purchasesBySupplier}
          nameHeader="Supplier"
          emptyMessage="No supplier payments made in this period."
        />
      </BreakdownCard>

      <BreakdownCard label="Salaries by employee" onNavigate={onNavigateToSalaries} navigateLabel="Full salaries report">
        <CategoryBreakdownTable
          entries={overview.salariesByEmployee}
          nameHeader="Employee"
          emptyMessage="No salaries paid in this period."
        />
      </BreakdownCard>
    </>
  );
}

/** The "how we calculate this" section that sits before the trend graph —
 * every headline card above traces back to real documents here, so nothing
 * on this page is a black box. Composes the three blocks above in the order
 * Sales Report reads best in (revenue → profit → expenses); Finance Report
 * imports the same three blocks directly under its own section headings. */
export function RevenueExpenseBreakdown({
  overview,
  onNavigateToProducts,
  onNavigateToExpenses,
  onNavigateToPurchases,
  onNavigateToSalaries,
}: {
  overview: SalesFinancialOverview;
  onNavigateToProducts: () => void;
  onNavigateToExpenses: () => void;
  onNavigateToPurchases: () => void;
  onNavigateToSalaries: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-4 rounded-lg border border-line bg-soft/40 p-5">
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">How We Calculate This</p>
        <h3 className="mt-1 text-base font-extrabold text-ink">Revenue &amp; Expense Breakdown</h3>
        <p className="mt-1 text-xs font-semibold text-muted">
          Every figure above traces back to real documents — here's exactly where each number comes from.
        </p>
      </div>

      <RevenueSummaryBlock overview={overview} onNavigateToProducts={onNavigateToProducts} />
      <NetRevenueBlock overview={overview} />
      <ExpenseSummaryBlock
        overview={overview}
        onNavigateToExpenses={onNavigateToExpenses}
        onNavigateToPurchases={onNavigateToPurchases}
        onNavigateToSalaries={onNavigateToSalaries}
      />
    </div>
  );
}

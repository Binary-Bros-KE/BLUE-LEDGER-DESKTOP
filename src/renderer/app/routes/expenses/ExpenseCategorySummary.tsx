import { useMemo } from "react";
import { formatCents } from "@renderer/shared/lib/money";
import type { Expense } from "@shared/types/expense";

type CategoryBreakdownRow = {
  categoryId: string;
  categoryName: string;
  timesPaid: number;
  totalCents: number;
  percentOfTotal: number;
};

/** Category breakdown for whatever's currently filtered above (year, storefront, status, etc.) — not
 * an all-time total, so it naturally resets to the current year's picture once the year filter above
 * defaults there. Mirrors the same "category / times paid / total / % of total" shape as the Sales
 * Report's expense breakdown. */
export function ExpenseCategorySummary({ expenses }: { expenses: Expense[] }): React.JSX.Element | null {
  const rows = useMemo<CategoryBreakdownRow[]>(() => {
    const byCategory = new Map<string, { categoryName: string; timesPaid: number; totalCents: number }>();
    for (const expense of expenses) {
      const entry = byCategory.get(expense.categoryId) ?? {
        categoryName: expense.categoryName,
        timesPaid: 0,
        totalCents: 0
      };
      entry.timesPaid += 1;
      entry.totalCents += expense.amountCents;
      byCategory.set(expense.categoryId, entry);
    }

    const totalCents = [...byCategory.values()].reduce((sum, entry) => sum + entry.totalCents, 0);

    return [...byCategory.entries()]
      .map(([categoryId, entry]) => ({
        categoryId,
        categoryName: entry.categoryName,
        timesPaid: entry.timesPaid,
        totalCents: entry.totalCents,
        percentOfTotal: totalCents > 0 ? Math.round((entry.totalCents / totalCents) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [expenses]);

  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Summary</p>
      <h2 className="mt-1 text-lg font-extrabold">Expenses by Category</h2>
      <p className="mt-1 text-xs font-semibold text-muted">Reflects every filter above, including the Year filter.</p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-white">
              <th className="px-3 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider">Category</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Times Paid</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">Total</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-extrabold uppercase tracking-wider">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.categoryId} className="border-t border-line odd:bg-white even:bg-soft/50">
                <td className="px-3 py-2 font-bold text-ink">{row.categoryName}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{row.timesPaid}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{formatCents(row.totalCents)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{row.percentOfTotal.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

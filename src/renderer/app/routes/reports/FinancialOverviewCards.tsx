import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import type { SalesFinancialOverview } from "@shared/types/report";

export type CardTone = "primary" | "teal" | "danger" | "success" | "warning";

export const CARD_TONE_CYCLE: CardTone[] = ["primary", "teal", "warning", "success", "danger"];

export const TONE_BG: Record<CardTone, string> = {
  primary: "bg-[#061e64]",
  teal: "bg-[#0e7a5a]",
  danger: "bg-[#ad3a29]",
  success: "bg-[#15915f]",
  warning: "bg-[#c1791f]",
};

/** Concentric rings bleeding off the top-right corner — the "fingerprint" texture
 * the reference asked for, adapted to a solid brand color instead of a gradient. */
export function CardTexture(): React.JSX.Element {
  const radii = [14, 28, 42, 56, 70, 84, 98, 112];
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 200 140"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {radii.map((r) => (
        <circle key={r} cx={190} cy={-10} r={r} fill="none" stroke="#fffdf7" strokeWidth={1.25} opacity={0.16} />
      ))}
    </svg>
  );
}

function DeltaBadge({ percent }: { percent: number | null }): React.JSX.Element {
  if (percent === null) {
    return <span className="text-[11px] font-semibold text-white/60">No prior data to compare</span>;
  }
  const isFlat = Math.abs(percent) < 0.05;
  const isUp = percent > 0 && !isFlat;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white/85">
      {isFlat ? (
        <Minus className="size-3" aria-hidden="true" />
      ) : isUp ? (
        <TrendingUp className="size-3" aria-hidden="true" />
      ) : (
        <TrendingDown className="size-3" aria-hidden="true" />
      )}
      {percent > 0 ? "+" : ""}
      {percent.toFixed(1)}% vs previous period
    </span>
  );
}

/** A solid-color, fingerprint-textured card for one headline figure — shared
 * by the 4-card Financial Overview, the Debtors/Creditors/Expected Profit
 * snapshot, and the Inventory overview, so all three families read as one
 * visual system. Pass `valueCents` for a money figure, or `displayValue` to
 * show something else (a plain count) verbatim. Pass either `deltaPercent`
 * (a period-over-period comparison) or `footnote` (a plain caption, for
 * point-in-time figures that have no "previous period"). */
export function OverviewCard({
  tone,
  label,
  valueCents,
  displayValue,
  formula,
  deltaPercent,
  footnote,
}: {
  tone: CardTone;
  label: string;
  valueCents?: number;
  displayValue?: string;
  formula: string;
  deltaPercent?: number | null;
  footnote?: string;
}): React.JSX.Element {
  const headline = displayValue ?? formatCents(valueCents ?? 0);
  return (
    <div className={cn("relative overflow-hidden rounded-lg p-4 shadow-soft", TONE_BG[tone])}>
      <CardTexture />
      <div className="relative">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/75">{label}</p>
        <p className="mt-2 text-2xl font-bold tabular-nums text-white">{headline}</p>
        <p className="mt-1.5 text-[11px] font-semibold text-white/60">{formula}</p>
        <div className="mt-2.5">
          {footnote !== undefined ? (
            <span className="text-[11px] font-semibold text-white/60">{footnote}</span>
          ) : (
            <DeltaBadge percent={deltaPercent ?? null} />
          )}
        </div>
      </div>
    </div>
  );
}

/** The 4-card "Financial Overview": all cash in, profit on goods sold, what it
 * cost to run the business, and what's left — each card names its own formula
 * so the numbers are never a black box. Net Profit's tone follows its sign. */
export function FinancialOverviewCards({ overview }: { overview: SalesFinancialOverview }): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OverviewCard
        tone="primary"
        label="Total Revenue"
        valueCents={overview.totalRevenueCents}
        formula="Retail/wholesale sales + invoice payments actually received"
        deltaPercent={overview.totalRevenueChangePercent}
      />
      <OverviewCard
        tone="teal"
        label="Net Revenue"
        valueCents={overview.netRevenueCents}
        formula="(Sale price − cost of goods) on the cash collected so far"
        deltaPercent={overview.netRevenueChangePercent}
      />
      <OverviewCard
        tone="danger"
        label="Total Expenses"
        valueCents={overview.totalExpensesCents}
        formula="Expenses + supplier payments + salaries actually paid"
        deltaPercent={overview.totalExpensesChangePercent}
      />
      <OverviewCard
        tone={overview.netProfitCents >= 0 ? "success" : "danger"}
        label="Net Profit"
        valueCents={overview.netProfitCents}
        formula="Net Revenue − Total Expenses"
        deltaPercent={overview.netProfitChangePercent}
      />
    </div>
  );
}

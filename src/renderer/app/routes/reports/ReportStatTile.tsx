import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";

/** A KPI stat tile with an optional signed delta vs a named comparison period —
 * up is colored good/bad by `upIsGood` (revenue up = good; nothing in the
 * Sales report currently wants the inverse, but the flag keeps the component honest). */
export function ReportStatTile({
  label,
  value,
  deltaPercent,
  deltaLabel = "vs previous period",
  upIsGood = true,
}: {
  label: string;
  value: string;
  deltaPercent?: number | null;
  deltaLabel?: string;
  upIsGood?: boolean;
}): React.JSX.Element {
  const hasDelta = deltaPercent !== undefined && deltaPercent !== null;
  const isFlat = hasDelta && Math.abs(deltaPercent) < 0.05;
  const isUp = hasDelta && deltaPercent > 0 && !isFlat;
  const isGood = isUp ? upIsGood : !upIsGood;

  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-soft">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {hasDelta && (
        <div
          className={cn(
            "mt-1.5 flex items-center gap-1 text-xs font-bold",
            isFlat ? "text-muted" : isGood ? "text-success" : "text-danger"
          )}
        >
          {isFlat ? (
            <Minus className="size-3.5" aria-hidden="true" />
          ) : isUp ? (
            <TrendingUp className="size-3.5" aria-hidden="true" />
          ) : (
            <TrendingDown className="size-3.5" aria-hidden="true" />
          )}
          <span>
            {deltaPercent > 0 ? "+" : ""}
            {deltaPercent.toFixed(1)}%
          </span>
          <span className="font-semibold text-muted">{deltaLabel}</span>
        </div>
      )}
      {!hasDelta && <p className="mt-1.5 text-xs font-semibold text-muted">No prior data to compare</p>}
    </div>
  );
}

import { useState } from "react";
import { categoricalColor, CHART_SEQUENTIAL_HUE } from "./chartTokens";

export type HorizontalBarItem = {
  key: string;
  label: string;
  sublabel?: string | undefined;
  value: number;
};

/**
 * A ranked horizontal-bar comparison. Single-hue by default (magnitude across
 * nominal categories — one color for every bar, never a value-ramp); pass
 * `categorical` when the bars themselves are the distinct entities the reader
 * needs to tell apart (e.g. payment methods). Every bar carries its own direct
 * label, so color is never the only way to identify it.
 */
export function HorizontalBarList({
  items,
  formatValue,
  categorical = false,
  emptyMessage = "No data for this period.",
}: {
  items: HorizontalBarItem[];
  formatValue: (value: number) => string;
  categorical?: boolean;
  emptyMessage?: string;
}): React.JSX.Element {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const maxValue = Math.max(1, ...items.map((item) => item.value));

  if (items.length === 0) {
    return (
      <div className="flex min-h-[140px] items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 text-sm font-semibold text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {items.map((item, index) => {
        const widthPercent = Math.max(2, (item.value / maxValue) * 100);
        const color = categorical ? categoricalColor(index) : CHART_SEQUENTIAL_HUE;
        const isHovered = hoveredKey === item.key;

        return (
          <div key={item.key} className="flex items-center gap-3">
            <div className="w-32 flex-none truncate text-xs font-bold text-ink sm:w-40" title={item.label}>
              {item.label}
              {item.sublabel && <span className="ml-1 font-semibold text-muted">{item.sublabel}</span>}
            </div>
            <div
              className="relative h-6 flex-1 cursor-default rounded-sm bg-soft"
              onMouseEnter={() => setHoveredKey(item.key)}
              onMouseLeave={() => setHoveredKey((prev) => (prev === item.key ? null : prev))}
              onFocus={() => setHoveredKey(item.key)}
              onBlur={() => setHoveredKey((prev) => (prev === item.key ? null : prev))}
              tabIndex={0}
              role="img"
              aria-label={`${item.label}: ${formatValue(item.value)}`}
            >
              <div
                className="h-full rounded-r-[4px] transition-[filter]"
                style={{
                  width: `${widthPercent}%`,
                  backgroundColor: color,
                  filter: isHovered ? "brightness(1.12)" : "none",
                }}
              />
              {isHovered && (
                <div
                  className="pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-ink px-2 py-1 text-[11px] font-bold text-white shadow-soft"
                  style={{ left: `calc(${widthPercent}% + 8px)` }}
                >
                  {formatValue(item.value)}
                </div>
              )}
            </div>
            <div className="w-20 flex-none text-right text-xs font-bold tabular-nums text-ink sm:w-24">
              {formatValue(item.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import type { DateRangeInput, SalesReportMode } from "@shared/types/report";
import { isoWeekFromMonday, maxAnchorForMode, mondayFromIsoWeek, periodLabelForAnchor, shiftAnchor, todayIso } from "./salesReportDate";

const MODES: { key: SalesReportMode; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
  { key: "custom", label: "Custom" },
];

/** The one period control every Sales-report section below it re-renders
 * against. Daily/Weekly/Monthly/Yearly each get a native picker matched to
 * their grain plus prev/next stepping (clamped so you can't step into the
 * future); Custom keeps a plain start/end date pair. */
export function SalesModeSelector({
  mode,
  onModeChange,
  anchor,
  onAnchorChange,
  customRange,
  onCustomRangeChange,
}: {
  mode: SalesReportMode;
  onModeChange: (mode: SalesReportMode) => void;
  anchor: string;
  onAnchorChange: (anchor: string) => void;
  customRange: DateRangeInput;
  onCustomRangeChange: (range: DateRangeInput) => void;
}): React.JSX.Element {
  const isWindowed = mode !== "custom";
  const maxAnchor = isWindowed ? maxAnchorForMode(mode) : todayIso();
  const canStepForward = isWindowed && shiftAnchor(mode, anchor, 1) <= maxAnchor;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-soft p-1">
        {MODES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onModeChange(item.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition cursor-pointer",
              mode === item.key ? "bg-primary text-white" : "text-muted hover:bg-white"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {isWindowed && (
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5">
          <button
            type="button"
            onClick={() => onAnchorChange(shiftAnchor(mode, anchor, -1))}
            className="rounded p-1 text-muted hover:bg-soft hover:text-ink cursor-pointer"
            aria-label="Previous period"
          >
            <ChevronLeft className="size-4" />
          </button>

          {mode === "daily" && (
            <input
              type="date"
              value={anchor}
              max={maxAnchor}
              onChange={(event) => event.target.value && onAnchorChange(event.target.value)}
              className="border-none bg-transparent text-xs font-bold text-ink outline-none"
            />
          )}
          {mode === "weekly" && (
            <input
              type="week"
              value={isoWeekFromMonday(anchor)}
              max={isoWeekFromMonday(maxAnchor)}
              onChange={(event) => {
                const monday = mondayFromIsoWeek(event.target.value);
                if (monday) onAnchorChange(monday);
              }}
              className="border-none bg-transparent text-xs font-bold text-ink outline-none"
            />
          )}
          {mode === "monthly" && (
            <input
              type="month"
              value={anchor}
              max={maxAnchor}
              onChange={(event) => event.target.value && onAnchorChange(event.target.value)}
              className="border-none bg-transparent text-xs font-bold text-ink outline-none"
            />
          )}
          {mode === "yearly" && (
            <input
              type="number"
              value={anchor}
              max={maxAnchor}
              min={2000}
              onChange={(event) => {
                const value = event.target.value;
                if (/^\d{4}$/.test(value)) onAnchorChange(value);
              }}
              className="w-16 border-none bg-transparent text-xs font-bold text-ink outline-none"
            />
          )}

          <button
            type="button"
            onClick={() => canStepForward && onAnchorChange(shiftAnchor(mode, anchor, 1))}
            disabled={!canStepForward}
            className="rounded p-1 text-muted hover:bg-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
            aria-label="Next period"
          >
            <ChevronRight className="size-4" />
          </button>

          <span className="ml-1 whitespace-nowrap text-xs font-semibold text-muted">{periodLabelForAnchor(mode, anchor)}</span>
        </div>
      )}

      {mode === "custom" && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5">
          <input
            type="date"
            value={customRange.startDate}
            max={customRange.endDate}
            onChange={(event) => onCustomRangeChange({ ...customRange, startDate: event.target.value })}
            className="border-none bg-transparent text-xs font-bold text-ink outline-none"
          />
          <span className="text-xs font-bold text-muted">to</span>
          <input
            type="date"
            value={customRange.endDate}
            min={customRange.startDate}
            max={todayIso()}
            onChange={(event) => onCustomRangeChange({ ...customRange, endDate: event.target.value })}
            className="border-none bg-transparent text-xs font-bold text-ink outline-none"
          />
        </div>
      )}
    </div>
  );
}

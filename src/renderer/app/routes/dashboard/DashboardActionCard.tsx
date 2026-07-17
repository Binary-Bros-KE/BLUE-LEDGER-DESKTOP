import { ArrowRight } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";
import { CardTexture, TONE_BG, type CardTone } from "@renderer/app/routes/reports/FinancialOverviewCards";

/** A colored, fingerprint-textured card for the dashboard's aside rail — a
 * headline number, an optional money sublabel, and a button straight to
 * where that number can be acted on (Approvals, Debtors, Low Stock, ...). */
export function DashboardActionCard({
  tone,
  label,
  value,
  sublabel,
  actionLabel,
  onAction,
}: {
  tone: CardTone;
  label: string;
  value: string;
  sublabel?: string;
  actionLabel: string;
  onAction: () => void;
}): React.JSX.Element {
  return (
    <div className={cn("relative overflow-hidden rounded-lg shadow-soft", TONE_BG[tone])}>
      <CardTexture />
      <div className="relative p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/75">{label}</p>
        <p className="mt-2 text-2xl font-bold tabular-nums text-white">{value}</p>
        {sublabel && <p className="mt-1 text-xs font-semibold text-white/70">{sublabel}</p>}
      </div>
      <button
        type="button"
        onClick={onAction}
        className="relative flex w-full items-center justify-between gap-2 border-t border-white/15 bg-black/10 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-black/20 cursor-pointer"
      >
        {actionLabel}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

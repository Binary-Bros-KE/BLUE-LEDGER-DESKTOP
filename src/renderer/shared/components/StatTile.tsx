import type { LucideIcon } from "lucide-react";
import { cn } from "@renderer/shared/lib/cn";

const toneClass = {
  primary: "bg-primary text-white",
  accent: "bg-accent text-white",
  success: "bg-success text-white",
  warning: "bg-white text-ink border border-line",
  danger: "bg-danger text-white"
} as const;

const mutedClass = {
  primary: "text-white/60",
  accent: "text-white/60",
  success: "text-white/60",
  warning: "text-muted",
  danger: "text-white/60"
} as const;

export function StatTile({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: keyof typeof toneClass;
}): React.JSX.Element {
  return (
    <div className={cn("relative rounded-lg p-3.5 shadow-soft", toneClass[tone])}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-[10px] font-extrabold uppercase tracking-wide", mutedClass[tone])}>
          {label}
        </p>
        <Icon className={cn("size-3.5 flex-none", mutedClass[tone])} aria-hidden="true" />
      </div>
      <p className="mt-3 text-2xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

import type { PropsWithChildren } from "react";
import { cn } from "@renderer/shared/lib/cn";

const toneClass = {
  success: "border-success text-success",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
  neutral: "border-line text-muted",
  accent: "border-accent text-accent",
  ink: "border-ink text-ink"
} as const;

export function DashedPill({
  tone = "neutral",
  className,
  children
}: PropsWithChildren<{
  tone?: keyof typeof toneClass;
  className?: string;
}>): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-dashed bg-white/60 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide",
        toneClass[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

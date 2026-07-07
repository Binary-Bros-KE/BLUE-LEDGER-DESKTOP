import { cn } from "@renderer/shared/lib/cn";

const toneClass = {
  success: "border-success text-success",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
  ink: "border-ink text-ink"
} as const;

export function StampBadge({
  label,
  sublabel,
  tone = "success",
  rotate = -8,
  className
}: {
  label: string;
  sublabel?: string;
  tone?: keyof typeof toneClass;
  rotate?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "grid aspect-square w-24 flex-none place-items-center rounded-full border-2 border-dashed bg-white/40 text-center leading-none shadow-stamp",
        toneClass[tone],
        className
      )}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-wide">{label}</p>
        {sublabel && (
          <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wide opacity-70">{sublabel}</p>
        )}
      </div>
    </div>
  );
}

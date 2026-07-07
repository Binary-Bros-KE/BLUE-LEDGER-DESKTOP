import type { ButtonHTMLAttributes } from "react";
import { cn } from "@renderer/shared/lib/cn";

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-ink px-4 text-xs font-extrabold uppercase tracking-wide text-white shadow-soft transition hover:bg-primary focus:outline-none focus:ring-4 focus:ring-accent/20",
        className
      )}
      type="button"
      {...props}
    />
  );
}

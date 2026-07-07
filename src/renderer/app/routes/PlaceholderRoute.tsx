import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { StampBadge } from "@renderer/shared/components/StampBadge";

export function PlaceholderRoute({
  icon: Icon,
  title,
  description
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-6 flex min-h-[380px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-white/60 p-10 text-center shadow-soft"
    >
      <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
        <Icon className="size-7" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-xl font-extrabold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm font-semibold text-muted">{description}</p>
      <StampBadge label="Coming" sublabel="Soon" tone="ink" rotate={6} className="mt-5 w-16" />
    </motion.div>
  );
}

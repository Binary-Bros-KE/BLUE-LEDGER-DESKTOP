import { Cloud } from "lucide-react";
import { motion } from "framer-motion";
import { StampBadge } from "@renderer/shared/components/StampBadge";
import { useAppStore } from "@renderer/shared/stores/app-store";

function MiniMetric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-soft px-3.5 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

/** Restored, unchanged from the original dashboard design — queued/failed
 * counts are the only part of the sync snapshot that's genuinely live-computed
 * today; the Synced/Offline stamp will start meaning something once server
 * sync queues exist. Shown on every dashboard variant. */
export function SyncStatusCard(): React.JSX.Element {
  const sync = useAppStore((state) => state.sync);
  const isSynced = sync?.status === "online";

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-line bg-white p-4 shadow-soft"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 flex-none place-items-center rounded-lg bg-soft text-primary">
            <Cloud className="size-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-teal">Cloud Sync</p>
            <h2 className="text-base font-extrabold capitalize">{sync?.status ?? "checking"}</h2>
          </div>
        </div>
        <StampBadge label={isSynced ? "Synced" : "Offline"} tone={isSynced ? "success" : "warning"} rotate={-6} className="w-16" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <MiniMetric label="Queued" value={String(sync?.queuedCount ?? 0)} />
        <MiniMetric label="Failed" value={String(sync?.failedCount ?? 0)} />
      </div>
    </motion.section>
  );
}

import { Activity, Banknote, Cloud, Receipt, ShoppingBag, Users } from "lucide-react";
import { motion } from "framer-motion";
import { SalesTerminal } from "@renderer/features/sales/SalesTerminal";
import { StampBadge } from "@renderer/shared/components/StampBadge";
import { StatTile } from "@renderer/shared/components/StatTile";
import { useAppStore } from "@renderer/shared/stores/app-store";

export function DashboardRoute(): React.JSX.Element {
  const context = useAppStore((state) => state.context);
  const sync = useAppStore((state) => state.sync);
  const isSynced = sync?.status === "online";

  return (
    <div className="mt-6 grid grid-cols-[1fr_380px] gap-5">
      <section className="space-y-5">
        <div className="grid grid-cols-4 gap-3.5">
          <StatTile icon={Banknote} label="Today Sales" value="KES 0" tone="primary" />
          <StatTile icon={Receipt} label="Receipts" value="0" tone="accent" />
          <StatTile icon={ShoppingBag} label="Products" value="Ready" tone="success" />
          <StatTile icon={Users} label="Customers" value="Local" tone="warning" />
        </div>

        <SalesTerminal />
      </section>

      <aside className="relative space-y-3.5 pl-4">
        <span
          className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
          aria-hidden="true"
        />

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-line bg-white p-4 shadow-soft"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-teal">
                Tenant Identity
              </p>
              <h2 className="mt-1 text-base font-extrabold">
                {context?.tenant.businessName ?? "Loading"}
              </h2>
            </div>
            <Activity className="size-4 text-accent" aria-hidden="true" />
          </div>
          <dl className="mt-4 space-y-2.5 text-sm">
            <Info label="Client ID" value={context?.tenant.clientId ?? null} />
            <Info label="Tenant ID" value={context?.tenant.tenantId ?? null} />
            <Info label="Server ID" value={context?.tenant.serverId ?? "Not linked"} />
            <Info label="Station ID" value={context?.tenant.workstationId ?? null} />
          </dl>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="rounded-lg border border-line bg-white p-4 shadow-soft"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 flex-none place-items-center rounded-lg bg-soft text-primary">
                <Cloud className="size-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-teal">
                  Cloud Sync
                </p>
                <h2 className="text-base font-extrabold capitalize">{sync?.status ?? "checking"}</h2>
              </div>
            </div>
            <StampBadge
              label={isSynced ? "Synced" : "Offline"}
              tone={isSynced ? "success" : "warning"}
              rotate={-6}
              className="w-16"
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <MiniMetric label="Queued" value={String(sync?.queuedCount ?? 0)} />
            <MiniMetric label="Failed" value={String(sync?.failedCount ?? 0)} />
          </div>
        </motion.section>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }): React.JSX.Element {
  return (
    <div>
      <dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-xs text-ink">{value ?? "..."}</dd>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-soft px-3.5 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

import type { PropsWithChildren } from "react";
import { Download } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { formatRelativeSyncTime, SYNC_STATUS_COPY } from "@renderer/shared/lib/sync-status";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { computeGraceStatus } from "@shared/lib/grace-period";
import { navGroups, navItemsByKey } from "./navigation";
import { Sidebar } from "./Sidebar";
import { useSyncStatusWidget } from "./useSyncStatusWidget";
import { useUpdateStatusWidget } from "./useUpdateStatusWidget";

export function AppShell({ children }: PropsWithChildren): React.JSX.Element {
  const activeNavKey = useUiStore((state) => state.activeNavKey);
  const activeItem = navItemsByKey[activeNavKey];
  const activeGroup = navGroups.find((group) =>
    group.items.some((item) => item.key === activeNavKey)
  );

  const flatItems = navGroups.flatMap((group) => group.items);
  const activeIndex = flatItems.findIndex((item) => item.key === activeNavKey);
  const indexLabel = String(activeIndex >= 0 ? activeIndex + 1 : flatItems.length).padStart(2, "0");

  const isDashboard = activeNavKey === "dashboard";
  const eyebrow = isDashboard ? "Daily Focus" : (activeGroup?.title ?? "Blue Ledger");
  const title = isDashboard ? "Command Center" : (activeItem?.label ?? "Blue Ledger");

  const snapshot = useSyncStatusWidget();
  const updateStatus = useUpdateStatusWidget();

  // A MONTHLY tenant past grace never reaches this component at all (App.tsx routes to
  // LicenseBlockedRoute first) — this only ever fires for LIFETIME/CUSTOM, matching sync-engine.ts's
  // own isSyncDisabledByGracePeriod() gate exactly (same computeGraceStatus call, same fields), so
  // the widget can never claim sync is disabled when it isn't, or vice versa.
  const tenant = useAppStore((state) => state.context?.tenant ?? null);
  const grace = tenant ? computeGraceStatus(tenant.nextDueDate, tenant.subscriptionType) : null;
  const syncDisabledByGrace = grace?.state === "expired" && !grace.hardLock;

  return (
    <div className="flex h-screen bg-app text-ink">
      <Sidebar />

      <main className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
        <header className="flex items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">
              {indexLabel} &middot; {eyebrow}
            </p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-3.5 py-2.5 shadow-soft">
            {syncDisabledByGrace ? (
              <>
                <DashedPill tone="warning">Cloud Sync Disabled</DashedPill>
                <p className="text-xs font-bold text-muted">Maintenance fee overdue — pay to re-enable</p>
              </>
            ) : snapshot ? (
              <>
                <DashedPill tone={SYNC_STATUS_COPY[snapshot.status].tone}>
                  {SYNC_STATUS_COPY[snapshot.status].label}
                </DashedPill>
                <p className="text-xs font-bold text-muted">
                  {snapshot.status === "not_activated"
                    ? "Cloud sync not set up yet"
                    : `Synced ${formatRelativeSyncTime(
                        [snapshot.lastPushAt, snapshot.lastPullAt].filter(Boolean).sort().at(-1) ?? null
                      )}`}
                  {snapshot.queuedCount > 0 ? ` · ${snapshot.queuedCount} pending` : ""}
                  {snapshot.failedCount > 0 ? ` · ${snapshot.failedCount} failed` : ""}
                </p>
              </>
            ) : (
              <DashedPill tone="warning">Loading sync status&hellip;</DashedPill>
            )}
          </div>
        </header>

        {updateStatus?.status === "downloaded" && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Download className="size-4 flex-none text-accent" aria-hidden="true" />
              <p className="text-xs font-bold text-ink">
                Version {updateStatus.version} is ready to install. Restart whenever's convenient —
                nothing is lost, your work is saved automatically.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void window.blueLedger.update.installNow()}
              className="h-8 flex-none text-xs"
            >
              Restart &amp; Update
            </Button>
          </div>
        )}

        {children}
      </main>
    </div>
  );
}

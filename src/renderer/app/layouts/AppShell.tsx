import type { PropsWithChildren } from "react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { formatRelativeSyncTime, SYNC_STATUS_COPY } from "@renderer/shared/lib/sync-status";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { navGroups, navItemsByKey } from "./navigation";
import { Sidebar } from "./Sidebar";
import { useSyncStatusWidget } from "./useSyncStatusWidget";

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
            {snapshot ? (
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

        {children}
      </main>
    </div>
  );
}

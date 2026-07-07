import type { PropsWithChildren } from "react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import { navGroups, navItemsByKey } from "./navigation";
import { Sidebar } from "./Sidebar";

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
            <DashedPill tone="warning">Local Mode</DashedPill>
            <p className="text-xs font-bold text-muted">SQLite ready &middot; cloud sync staged</p>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}

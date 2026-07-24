import { useEffect, useState } from "react";
import type { SyncSnapshot } from "@shared/types/sync";

const POLL_INTERVAL_MS = 15_000;

/** Backs the persistent header widget in AppShell — a cheap local DB read (see sync-service.ts's
 * getSyncSnapshot; the sync cycle's own network calls happen independently on their own timer,
 * this never triggers one), polled often enough that "Online"/"Offline" and the pending count feel
 * live without needing every page to wire this up itself. Returns null only until the very first
 * read resolves; a failed read just keeps showing whatever was last known rather than flashing
 * back to a loading state. */
export function useSyncStatusWidget(): SyncSnapshot | null {
  const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      try {
        const result = await window.blueLedger.sync.getSnapshot();
        if (!cancelled) setSnapshot(result);
      } catch {
        // Best-effort — keep showing the last known snapshot rather than an error state for what's
        // meant to be a lightweight, always-present widget, not another place sync errors surface.
      }
    }

    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return snapshot;
}

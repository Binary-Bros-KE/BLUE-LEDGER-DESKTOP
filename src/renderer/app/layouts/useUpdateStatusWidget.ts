import { useEffect, useState } from "react";
import type { UpdateStatusResult } from "@shared/types/update";

const POLL_INTERVAL_MS = 30_000;

/** Same shape as useSyncStatusWidget.ts — a cheap in-memory read (see update-service.ts's own
 * getUpdateStatus, never triggers a real network check itself), polled slower than the sync widget
 * since a new app version isn't time-sensitive. Returns null only until the first read resolves. */
export function useUpdateStatusWidget(): UpdateStatusResult | null {
  const [status, setStatus] = useState<UpdateStatusResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      try {
        const result = await window.blueLedger.update.getStatus();
        if (!cancelled) setStatus(result);
      } catch {
        // Best-effort — same tolerance as the sync widget.
      }
    }

    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}

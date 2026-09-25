import { useEffect, useRef } from "react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { showInfoToast } from "@renderer/shared/lib/toast";
import { useStockRequestAlertsStore } from "@renderer/shared/stores/stock-request-alerts-store";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import type { StockRequestListItem } from "@shared/types/stock-request";

// A request reaches this PC via cloud sync (~20s push from the requester + ~20s pull here), and this
// poll is only a cheap local-database read — it can be much tighter than the sync interval.
const POLL_INTERVAL_MS = 10 * 1000;

function describe(newOnes: StockRequestListItem[]): { title: string; body: string } {
  if (newOnes.length === 1) {
    const [request] = newOnes;
    return {
      title: "New stock request",
      body: `${request!.requestNumber} from ${request!.storefrontName} — ${request!.itemCount} item${request!.itemCount === 1 ? "" : "s"}`
    };
  }
  return {
    title: `${newOnes.length} new stock requests`,
    body: newOnes.map((request) => `${request.requestNumber} (${request.storefrontName})`).join(", ")
  };
}

function playBeep(): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.5);
    oscillator.onended = () => void context.close();
  } catch {
    // Audio is a nicety — never let it break the alert itself.
  }
}

/**
 * Keeps the approver's pending stock requests fresh and alerts on new ones: in-app toast + beep
 * always, plus a Windows notification when the app isn't the focused window (an in-app toast is
 * enough while they're looking at it). Mounted once in AppShell; does nothing for anyone without
 * "stock_requests:approve". The first fetch after login only sets the baseline — requests already
 * waiting then are shown by the sidebar badge/dashboard card, not announced as "new".
 */
export function useStockRequestAlerts(): void {
  const { can, session } = usePermissions();
  const canApprove = can("stock_requests", "approve");
  const employeeId = session?.employee.id ?? null;
  const setPending = useStockRequestAlertsStore((state) => state.setPending);
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    knownIds.current = null;
    if (!canApprove || !employeeId) {
      setPending([]);
      return undefined;
    }

    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const pending = await window.blueLedger.stockRequest.listPending();
        if (cancelled) return;
        setPending(pending);

        const known = knownIds.current;
        knownIds.current = new Set(pending.map((request) => request.id));
        if (known === null) return;

        const newOnes = pending.filter((request) => !known.has(request.id));
        if (newOnes.length === 0) return;

        const { title, body } = describe(newOnes);
        showInfoToast(`${title}: ${body}`);
        playBeep();
        if (!document.hasFocus()) {
          try {
            const notification = new Notification(title, { body });
            notification.onclick = () => {
              window.focus();
              setActiveNavKey("stock-requests");
            };
          } catch {
            // Notifications unavailable — the in-app toast and badge still cover it.
          }
        }
      } catch {
        // Transient (mid-sync, permission changed) — try again next tick.
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [canApprove, employeeId, setPending, setActiveNavKey]);
}

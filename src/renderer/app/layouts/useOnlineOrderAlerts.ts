import { useEffect, useRef } from "react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { showInfoToast } from "@renderer/shared/lib/toast";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { useOnlineOrderAlertsStore } from "@renderer/shared/stores/online-order-alerts-store";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import type { OnlineOrder } from "@shared/types/online-store";

// Web orders live in the cloud (not synced), so this is a real network call — a minute is plenty
// for "someone ordered on the website" while staying well inside /shop-admin's rate limit.
const POLL_INTERVAL_MS = 60 * 1000;

function describe(newOnes: OnlineOrder[]): { title: string; body: string } {
  if (newOnes.length === 1) {
    const [o] = newOnes;
    return {
      title: "New online order",
      body: `${o!.orderNumber} from ${o!.customerName} — ${o!.items.length} item${o!.items.length === 1 ? "" : "s"}`
    };
  }
  return {
    title: `${newOnes.length} new online orders`,
    body: newOnes.map((o) => `${o.orderNumber} (${o.customerName})`).join(", ")
  };
}

function playChime(): void {
  try {
    const context = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * 0.18;
      oscillator.type = "sine";
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.4);
      if (i === 1) oscillator.onended = () => void context.close();
    });
  } catch {
    // Audio is a nicety — never let it break the alert itself.
  }
}

/**
 * Keeps the "new web orders" count fresh (sidebar badge + dashboard card) and announces orders that
 * arrive while the app is open: in-app toast + chime, plus a Windows notification when the app is not
 * focused. Mirrors useStockRequestAlerts. Only runs for someone who can view the online store, on a
 * tenant with e-commerce. The first poll after login only sets the baseline — orders already waiting
 * then show in the badge/card rather than being announced as new. Offline or not-yet-linked devices
 * keep the last count (the call fails quietly and retries next tick).
 */
export function useOnlineOrderAlerts(): void {
  const { can, session } = usePermissions();
  const canView = can("online_store", "view");
  const ecommerceEnabled = useAppStore((state) => state.context?.tenant.ecommerceEnabled ?? false);
  const employeeId = session?.employee.id ?? null;
  const setNewCount = useOnlineOrderAlertsStore((state) => state.setNewCount);
  const setActiveNavKey = useUiStore((state) => state.setActiveNavKey);
  const knownIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    knownIds.current = null;
    if (!canView || !ecommerceEnabled || !employeeId) {
      setNewCount(0);
      return undefined;
    }

    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const summary = await window.blueLedger.onlineOrders.summary();
        if (cancelled) return;
        setNewCount(summary.newCount);

        const known = knownIds.current;
        const unseen = summary.latestUnseen;
        knownIds.current = new Set([...(known ?? []), ...unseen.map((o) => o.id)]);
        if (known === null) return;

        const newOnes = unseen.filter((o) => !known.has(o.id));
        if (newOnes.length === 0) return;

        const { title, body } = describe(newOnes);
        showInfoToast(`${title}: ${body}`);
        playChime();
        if (!document.hasFocus()) {
          try {
            const notification = new Notification(title, { body });
            notification.onclick = () => {
              window.focus();
              setActiveNavKey("online-orders");
            };
          } catch {
            // Notifications unavailable — the in-app toast and badge still cover it.
          }
        }
      } catch {
        // Offline / device not linked / transient — keep the last count, try again next tick.
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [canView, ecommerceEnabled, employeeId, setNewCount, setActiveNavKey]);
}

import { useEffect, useRef } from "react";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { showInfoToast } from "@renderer/shared/lib/toast";
import { usePurchaseRequisitionAlertsStore } from "@renderer/shared/stores/purchase-requisition-alerts-store";
import { useUiStore } from "@renderer/shared/stores/ui-store";
import type { PurchaseRequisitionListItem } from "@shared/types/purchase-requisition";
import { playBeep } from "./useStockRequestAlerts";

// Same cadence and reasoning as useStockRequestAlerts: a cheap local read, tighter than sync.
const POLL_INTERVAL_MS = 10 * 1000;

function describe(newOnes: PurchaseRequisitionListItem[]): { title: string; body: string } {
  if (newOnes.length === 1) {
    const [requisition] = newOnes;
    return {
      title: "New purchase requisition",
      body: `${requisition!.requisitionNumber} from ${requisition!.requestedByName} (${requisition!.storefrontName}) — ${requisition!.itemCount} item${requisition!.itemCount === 1 ? "" : "s"}`
    };
  }
  return {
    title: `${newOnes.length} new purchase requisitions`,
    body: newOnes.map((requisition) => `${requisition.requisitionNumber} (${requisition.storefrontName})`).join(", ")
  };
}

/** Same behaviour as useStockRequestAlerts, for purchase requisitions: keeps the approver's pending
 * list fresh (sidebar badge) and announces new ones — toast + beep always, plus a Windows
 * notification when the app isn't focused. The first fetch after login only sets the baseline. */
export function usePurchaseRequisitionAlerts(): void {
  const { can, session } = usePermissions();
  const canApprove = can("purchase_requisitions", "approve");
  const employeeId = session?.employee.id ?? null;
  const setPending = usePurchaseRequisitionAlertsStore((state) => state.setPending);
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
        const pending = await window.blueLedger.purchaseRequisition.listPending();
        if (cancelled) return;
        setPending(pending);

        const known = knownIds.current;
        knownIds.current = new Set(pending.map((requisition) => requisition.id));
        if (known === null) return;

        // Never announce your own requisition back to you.
        const newOnes = pending.filter((requisition) => !known.has(requisition.id) && requisition.requestedBy !== employeeId);
        if (newOnes.length === 0) return;

        const { title, body } = describe(newOnes);
        showInfoToast(`${title}: ${body}`);
        playBeep();
        if (!document.hasFocus()) {
          try {
            const notification = new Notification(title, { body });
            notification.onclick = () => {
              window.focus();
              setActiveNavKey("local-supplier-purchases");
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

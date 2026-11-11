import { useEffect, useState } from "react";
import { Ban, Pencil, RefreshCcw, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { useConfirm } from "@renderer/shared/components/ConfirmModal";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { SUBSCRIPTION_NOTICE_LABELS, SUBSCRIPTION_NOTICE_STAGES, type SubscriptionNoticeStage } from "@shared/lib/subscription-schedule";
import type { Subscription } from "@shared/types/subscription";
import { NoticeTrack, StagePill, formatAmount, formatSubscriptionDate } from "./subscription-ui";

function Detail({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-soft/50 px-3 py-2">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

const CHANNEL_LABEL = { whatsapp: "WhatsApp", email: "Email", other: "Called / in person" } as const;

/** One period in full: who, what, when, the reminders sent (by whom), every earlier period this
 * customer has had, and the actions their role allows. */
export function SubscriptionDetailModal({
  subscription,
  onClose,
  onChanged,
  onEdit,
  onRenew,
  onSend
}: {
  subscription: Subscription | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onEdit: (subscription: Subscription) => void;
  onRenew: (subscription: Subscription) => void;
  onSend: (subscription: Subscription, stage: SubscriptionNoticeStage) => void;
}): React.JSX.Element {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const [history, setHistory] = useState<Subscription[]>([]);

  useEffect(() => {
    if (!subscription) return;
    void window.blueLedger.subscription
      .customerHistory(subscription.customerId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [subscription]);

  async function run(action: () => Promise<unknown>, success: string, failure: string): Promise<void> {
    try {
      await action();
      showSuccessToast(success);
      await onChanged();
    } catch (err) {
      showErrorToast(getErrorMessage(err, failure));
    }
  }

  async function handleCancel(target: Subscription): Promise<void> {
    const ok = await confirm({
      title: "Cancel subscription?",
      message: `${target.customerName}'s ${target.serviceName} stops getting reminders. You can reactivate it later.`,
      tone: "danger"
    });
    if (ok) await run(() => window.blueLedger.subscription.setStatus(target.id, "cancelled"), "Subscription cancelled", "Couldn't cancel it");
  }

  async function handleDelete(target: Subscription): Promise<void> {
    const ok = await confirm({
      title: "Delete subscription?",
      message: target.renewedFromId
        ? "This removes this renewal and puts the previous period back. Only possible before it syncs."
        : "Only possible for a mistake made moments ago, before it syncs. Otherwise cancel it.",
      tone: "danger"
    });
    if (!ok) return;
    try {
      await window.blueLedger.subscription.delete(target.id);
      showSuccessToast("Subscription deleted");
      onClose();
      await onChanged();
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't delete it"));
    }
  }

  const current = subscription;
  const others = history.filter((period) => period.id !== current?.id);

  return (
    <Modal
      open={current !== null}
      onClose={onClose}
      title={current ? `${current.serviceName} — ${current.customerName}` : "Subscription"}
      description={current ? [current.customerPhone, current.accountNumber && `Account ${current.accountNumber}`].filter(Boolean).join(" · ") : ""}
      widthClassName="max-w-3xl"
    >
      {current && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <StagePill subscription={current} />
            <NoticeTrack subscription={current} />
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Detail label="Started" value={formatSubscriptionDate(current.startDate)} />
            <Detail label="Ends" value={formatSubscriptionDate(current.endDate)} />
            <Detail label="Period" value={`${current.periodDays} days`} />
            <Detail label="Amount" value={formatAmount(current.amountCents)} />
            <Detail label="Storefront" value={current.locationName ?? "—"} />
            <Detail label="Added by" value={current.createdByName ?? "—"} />
          </div>
          {current.notes && <p className="whitespace-pre-line rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink">{current.notes}</p>}

          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Reminders</p>
            <div className="mt-2 space-y-1.5">
              {SUBSCRIPTION_NOTICE_STAGES.map((stage) => {
                const sent = current.notices.find((notice) => notice.stage === stage);
                const due = current.pendingNotice === stage;
                return (
                  <div key={stage} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                    <span className="text-xs font-extrabold text-ink">{SUBSCRIPTION_NOTICE_LABELS[stage]}</span>
                    {sent ? (
                      <span className="text-xs font-semibold text-success">
                        Sent {new Date(sent.sentAt).toLocaleString()} · {CHANNEL_LABEL[sent.channel]}
                        {sent.sentByName ? ` · ${sent.sentByName}` : ""}
                      </span>
                    ) : due && can("subscriptions", "edit") ? (
                      <Button type="button" onClick={() => onSend(current, stage)} className="h-8 bg-danger text-[11px] hover:bg-danger/90">
                        <Send className="mr-1.5 size-3.5" aria-hidden="true" />
                        Send now
                      </Button>
                    ) : (
                      <span className="text-xs font-semibold text-muted">{due ? "Due now" : "Not sent"}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {others.length > 0 && (
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">This customer's other periods</p>
              <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                {others.map((period) => (
                  <div key={period.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs">
                    <span className="font-bold text-ink">
                      {period.serviceName}
                      {period.accountNumber ? ` · ${period.accountNumber}` : ""}
                    </span>
                    <span className="font-semibold text-muted">
                      {formatSubscriptionDate(period.startDate)} → {formatSubscriptionDate(period.endDate)}
                    </span>
                    <StagePill subscription={period} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {current.status === "active" && can("subscriptions", "create") && (
              <Button type="button" onClick={() => onRenew(current)} className="h-9 text-xs">
                <RefreshCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                Renew
              </Button>
            )}
            {current.status !== "renewed" && can("subscriptions", "edit") && (
              <Button type="button" onClick={() => onEdit(current)} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
                <Pencil className="mr-1.5 size-3.5" aria-hidden="true" />
                Edit
              </Button>
            )}
            {current.status === "active" && can("subscriptions", "edit") && (
              <Button
                type="button"
                onClick={() => void handleCancel(current)}
                className="h-9 border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft"
              >
                <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
                Cancel Subscription
              </Button>
            )}
            {current.status === "cancelled" && can("subscriptions", "edit") && (
              <Button
                type="button"
                onClick={() => void run(() => window.blueLedger.subscription.setStatus(current.id, "active"), "Subscription reactivated", "Couldn't reactivate it")}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                Reactivate
              </Button>
            )}
            {can("subscriptions", "delete") && current.status !== "renewed" && (
              <Button
                type="button"
                onClick={() => void handleDelete(current)}
                className="ml-auto h-9 border border-line bg-white text-xs text-muted shadow-none hover:bg-soft"
              >
                <Trash2 className="mr-1.5 size-3.5" aria-hidden="true" />
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

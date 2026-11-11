import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, MessageCircle, Phone } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Field, SelectField, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { EA_COUNTRY_CODES, normalizePhoneForWhatsApp } from "@renderer/shared/lib/phone";
import { getSharePreferences } from "@renderer/shared/lib/share-preferences";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { useAppStore } from "@renderer/shared/stores/app-store";
import { SUBSCRIPTION_NOTICE_LABELS, type SubscriptionNoticeStage } from "@shared/lib/subscription-schedule";
import type { Subscription, SubscriptionNoticeChannel } from "@shared/types/subscription";
import { buildNoticeMessage } from "./subscription-ui";

const CHANNELS: Array<{ value: SubscriptionNoticeChannel; label: string; icon: typeof Mail }> = [
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { value: "email", label: "Email", icon: Mail },
  { value: "other", label: "Called / in person", icon: Phone }
];

/**
 * Manual reminders, by client spec: this opens WhatsApp or the mail app with the message ready, and the
 * person sending confirms it went out. We can't see what happens inside WhatsApp, so nothing is marked
 * sent until they say so — that's what keeps the "already sent" markers honest.
 */
export function SendReminderModal({
  target,
  onClose,
  onSent
}: {
  target: { subscription: Subscription; stage: SubscriptionNoticeStage } | null;
  onClose: () => void;
  onSent: (updated: Subscription) => void;
}): React.JSX.Element {
  const businessName = useAppStore((state) => state.context?.tenant.businessName ?? "");
  const [channel, setChannel] = useState<SubscriptionNoticeChannel>("whatsapp");
  const [recipient, setRecipient] = useState("");
  const [countryCode, setCountryCode] = useState<string>(EA_COUNTRY_CODES[0].code);
  const [message, setMessage] = useState("");
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setChannel("whatsapp");
    setRecipient(target.subscription.customerPhone ?? "");
    setMessage(buildNoticeMessage(target.subscription, target.stage, businessName));
    setOpened(false);
    setError(null);
  }, [target, businessName]);

  function switchChannel(next: SubscriptionNoticeChannel): void {
    setChannel(next);
    setOpened(false);
    if (!target) return;
    if (next === "whatsapp") setRecipient(target.subscription.customerPhone ?? "");
    if (next === "email") setRecipient(target.subscription.customerEmail ?? "");
  }

  function openApp(): void {
    if (!target) return;
    if (!recipient.trim()) return setError(channel === "email" ? "Enter an email address." : "Enter a phone number.");
    setError(null);
    if (channel === "whatsapp") {
      const digits = normalizePhoneForWhatsApp(recipient, countryCode);
      const text = encodeURIComponent(message);
      window.open(
        getSharePreferences().whatsappInstalled
          ? `whatsapp://send?phone=${digits}&text=${text}`
          : `https://api.whatsapp.com/send?phone=${digits}&text=${text}`
      );
    } else {
      const subject = encodeURIComponent(`${target.subscription.serviceName} subscription`);
      window.open(`mailto:${recipient.trim()}?subject=${subject}&body=${encodeURIComponent(message)}`);
    }
    setOpened(true);
  }

  async function markSent(): Promise<void> {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await window.blueLedger.subscription.recordNotice(target.subscription.id, {
        stage: target.stage,
        channel,
        recipient: channel === "other" ? null : recipient.trim() || null
      });
      showSuccessToast(`"${SUBSCRIPTION_NOTICE_LABELS[target.stage]}" reminder marked as sent`);
      onSent(updated);
    } catch (err) {
      const text = getErrorMessage(err, "Couldn't mark this reminder as sent");
      setError(text);
      showErrorToast(text);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? `Send "${SUBSCRIPTION_NOTICE_LABELS[target.stage]}" reminder` : "Send reminder"}
      description={
        target ? `${target.subscription.customerName} · ${target.subscription.serviceName}${target.subscription.accountNumber ? ` · ${target.subscription.accountNumber}` : ""}` : ""
      }
      widthClassName="max-w-xl"
    >
      {target && (
        <div className="space-y-4">
          {error && <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">{error}</div>}

          <div className="grid grid-cols-3 gap-2">
            {CHANNELS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => switchChannel(option.value)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-extrabold transition cursor-pointer",
                  channel === option.value ? "border-primary bg-primary text-white" : "border-line text-ink hover:border-accent"
                )}
              >
                <option.icon className="size-4" aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>

          {channel === "whatsapp" && (
            <div className="grid grid-cols-[9rem_1fr] gap-3">
              <SelectField
                label="Country"
                value={countryCode}
                onChange={setCountryCode}
                options={EA_COUNTRY_CODES.map((c) => ({ value: c.code, label: `${c.label} +${c.code}` }))}
              />
              <Field label="Phone" value={recipient} onChange={setRecipient} placeholder="e.g. 0712 345 678" />
            </div>
          )}
          {channel === "email" && <Field label="Email" type="email" value={recipient} onChange={setRecipient} placeholder="customer@example.com" />}

          {channel !== "other" ? (
            <TextAreaField label="Message" value={message} onChange={setMessage} rows={5} />
          ) : (
            <p className="rounded-lg border border-dashed border-line bg-soft/60 px-4 py-3 text-xs font-semibold text-muted">
              For a customer you reminded by phone or in person. Marking it sent stops this reminder being offered again.
            </p>
          )}

          {channel !== "other" && opened && (
            <div className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-xs font-semibold text-ink">
              <CheckCircle2 className="mt-0.5 size-4 flex-none text-accent" aria-hidden="true" />
              {channel === "whatsapp" ? "WhatsApp" : "Your mail app"} opened with the message. Once you've pressed send there, mark it as sent here.
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" onClick={onClose} className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft">
              Close
            </Button>
            {channel !== "other" && (
              <Button
                type="button"
                onClick={openApp}
                className={cn("h-9 text-xs", opened && "border border-line bg-white text-ink shadow-none hover:bg-soft")}
              >
                {opened ? "Open again" : channel === "whatsapp" ? "Open WhatsApp" : "Open Email"}
              </Button>
            )}
            {(channel === "other" || opened) && (
              <Button type="button" onClick={() => void markSent()} disabled={saving} className="h-9 bg-success text-xs hover:bg-success/90">
                {saving && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
                Mark as Sent
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

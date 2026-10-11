import { useEffect, useState } from "react";
import { Mail, MessageCircle, Send } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { EA_COUNTRY_CODES, normalizePhoneForWhatsApp } from "@renderer/shared/lib/phone";
import { getSharePreferences } from "@renderer/shared/lib/share-preferences";
import { showSuccessToast } from "@renderer/shared/lib/toast";
import type { OnlineOrder } from "@shared/types/online-store";

type Channel = "whatsapp" | "email";

export type OrderMessageRequest = {
  order: OnlineOrder;
  /** shown in the modal header, e.g. "Order confirmed" */
  heading: string;
  subject: string;
  text: string;
};

/**
 * Sends a web-order update to the customer over WhatsApp or email — the same channel picker and
 * link format as the document ShareModal (whatsapp:// vs api.whatsapp.com follows the user's Share
 * setting), but the message is plain text built from the order and editable before sending: an
 * order isn't a document yet, so there's no share link to send.
 */
export function OrderMessageModal({
  request,
  onClose
}: {
  request: OrderMessageRequest | null;
  onClose: () => void;
}): React.JSX.Element {
  const order = request?.order ?? null;
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [countryCode, setCountryCode] = useState<string>(EA_COUNTRY_CODES[0].code);
  const [recipient, setRecipient] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (!request) return;
    setChannel("whatsapp");
    setCountryCode(EA_COUNTRY_CODES[0].code);
    setRecipient(request.order.customerPhone);
    setText(request.text);
  }, [request]);

  function pick(next: Channel): void {
    if (!order) return;
    setChannel(next);
    setRecipient(next === "whatsapp" ? order.customerPhone : (order.customerEmail ?? ""));
  }

  function send(): void {
    if (!request || !recipient.trim() || !text.trim()) return;
    if (channel === "whatsapp") {
      const digits = normalizePhoneForWhatsApp(recipient, countryCode);
      const body = encodeURIComponent(text);
      window.open(
        getSharePreferences().whatsappInstalled
          ? `whatsapp://send?phone=${digits}&text=${body}`
          : `https://api.whatsapp.com/send?phone=${digits}&text=${body}`
      );
    } else {
      const subject = encodeURIComponent(`${request.subject} — ${request.order.orderNumber}`);
      window.open(`mailto:${recipient.trim()}?subject=${subject}&body=${encodeURIComponent(text)}`);
    }
    showSuccessToast(`${channel === "whatsapp" ? "WhatsApp" : "Email"} opened with the message ready to send.`);
    onClose();
  }

  const channels: { key: Channel; label: string; icon: typeof Mail; hint: string }[] = [
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle, hint: order?.customerPhone ?? "" },
    { key: "email", label: "Email", icon: Mail, hint: order?.customerEmail ?? "No email on the order" }
  ];

  return (
    <Modal
      open={request !== null}
      onClose={onClose}
      title={request ? `${request.heading} — tell the customer?` : "Message customer"}
      description={order ? `Send ${order.customerName} an update about ${order.orderNumber}.` : ""}
      widthClassName="max-w-lg"
    >
      <div className="grid grid-cols-2 gap-3">
        {channels.map((c) => {
          const Icon = c.icon;
          const active = channel === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => pick(c.key)}
              className={cn(
                "flex items-center gap-3 rounded-lg border-2 px-3 py-3 text-left transition cursor-pointer",
                active ? "border-accent bg-accent/10" : "border-line bg-soft hover:border-accent/50"
              )}
            >
              <span
                className={cn(
                  "grid size-9 flex-none place-items-center rounded-full",
                  active ? "bg-accent text-white" : "bg-white text-ink"
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-extrabold", active ? "text-accent" : "text-ink")}>{c.label}</span>
                <span className="block truncate text-[11px] font-semibold text-muted">{c.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {channel === "whatsapp" ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[11px] font-bold tracking-wide text-muted uppercase">Country</span>
            <select
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line px-2 py-2.5 text-sm outline-none focus:border-accent"
            >
              {EA_COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} (+{c.code})
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="text-[11px] font-bold tracking-wide text-muted uppercase">Phone number</span>
            <input
              type="tel"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
          </label>
        </div>
      ) : (
        <label className="mt-4 block">
          <span className="text-[11px] font-bold tracking-wide text-muted uppercase">Email address</span>
          <input
            type="email"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="e.g. customer@email.com"
            className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
        </label>
      )}

      <label className="mt-4 block">
        <span className="text-[11px] font-bold tracking-wide text-muted uppercase">Message</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={9}
          className="mt-1.5 w-full resize-y rounded-lg border border-line bg-soft/40 px-3 py-2.5 font-mono text-xs leading-relaxed outline-none focus:border-accent"
        />
      </label>

      <div className="mt-5 flex gap-2">
        <Button
          type="button"
          onClick={onClose}
          className="h-10 flex-1 border border-line bg-white text-ink shadow-none hover:bg-soft"
        >
          Skip
        </Button>
        <Button
          type="button"
          onClick={send}
          disabled={!recipient.trim() || !text.trim()}
          className="h-10 flex-[2] gap-1.5 bg-accent text-white shadow-none hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="size-4" aria-hidden="true" />
          Send via {channel === "whatsapp" ? "WhatsApp" : "Email"}
        </Button>
      </div>
    </Modal>
  );
}

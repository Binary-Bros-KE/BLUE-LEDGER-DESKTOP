import { useEffect, useState } from "react";
import { Loader2, Mail, MessageCircle, Send } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { ShareDocumentEntity } from "@shared/types/share";

type Channel = "whatsapp" | "email";

/** WhatsApp/mailto: deep links only ever pre-fill a TEXT message — neither can attach a file, a
 * platform limitation, not something this app can work around. The link itself IS the share; the
 * public page it points to (the SHARE app) is what actually renders the document. */
export function ShareModal({
  open,
  onClose,
  entity,
  entityId,
  documentLabel,
  customerId
}: {
  open: boolean;
  onClose: () => void;
  entity: ShareDocumentEntity;
  entityId: string;
  documentLabel: string;
  customerId: string | null;
}): React.JSX.Element {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChannel("whatsapp");
    setCustomerPhone("");
    setCustomerEmail("");
    setRecipient("");
    if (!customerId) return;

    let cancelled = false;
    void window.blueLedger.customer.get(customerId).then((customer) => {
      if (cancelled || !customer) return;
      setCustomerPhone(customer.phone ?? "");
      setCustomerEmail(customer.email ?? "");
      setRecipient(customer.phone ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [open, customerId]);

  function handleChannelChange(next: Channel): void {
    setChannel(next);
    setRecipient(next === "whatsapp" ? customerPhone : customerEmail);
  }

  async function handleSend(): Promise<void> {
    if (!recipient.trim()) return;
    setSending(true);
    try {
      const url = await window.blueLedger.share.createLink(entity, entityId);
      const message = `Here's your ${documentLabel} — view or download it here: ${url}`;

      if (channel === "whatsapp") {
        const digits = recipient.replace(/[^\d+]/g, "");
        window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, "_blank");
      } else {
        const subject = encodeURIComponent(documentLabel);
        window.open(`mailto:${recipient}?subject=${subject}&body=${encodeURIComponent(message)}`, "_blank");
      }

      showSuccessToast(`${channel === "whatsapp" ? "WhatsApp" : "Email"} opened with the share link ready to send.`);
      onClose();
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Couldn't create a share link"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share" description={`Send ${documentLabel} to your customer.`}>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => handleChannelChange("whatsapp")}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-xs font-bold transition cursor-pointer",
            channel === "whatsapp"
              ? "border-accent bg-accent/10 text-accent"
              : "border-line bg-soft text-ink hover:border-accent/50 hover:bg-accent/5"
          )}
        >
          <MessageCircle className="size-5" aria-hidden="true" />
          WhatsApp
        </button>
        <button
          type="button"
          onClick={() => handleChannelChange("email")}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-xs font-bold transition cursor-pointer",
            channel === "email"
              ? "border-accent bg-accent/10 text-accent"
              : "border-line bg-soft text-ink hover:border-accent/50 hover:bg-accent/5"
          )}
        >
          <Mail className="size-5" aria-hidden="true" />
          Email
        </button>
      </div>

      <label className="mt-4 block">
        <span className="text-[11px] font-bold tracking-wide text-muted uppercase">
          {channel === "whatsapp" ? "Phone number" : "Email address"}
        </span>
        <input
          type={channel === "whatsapp" ? "tel" : "email"}
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder={channel === "whatsapp" ? "e.g. 0791880000" : "e.g. customer@email.com"}
          className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <p className="mt-3 text-xs font-semibold text-muted">
        {channel === "whatsapp"
          ? "Opens WhatsApp with a message containing a link to view/download the document — WhatsApp can't attach files automatically."
          : "Opens your email app with the message and link pre-filled."}
      </p>

      <Button
        type="button"
        onClick={() => void handleSend()}
        disabled={sending || !recipient.trim()}
        className="mt-5 h-10 w-full bg-accent text-white shadow-none hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="mr-1.5 size-4" aria-hidden="true" />
        )}
        {sending ? "Preparing link…" : `Send via ${channel === "whatsapp" ? "WhatsApp" : "Email"}`}
      </Button>
    </Modal>
  );
}

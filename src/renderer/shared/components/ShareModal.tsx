import { useEffect, useState } from "react";
import { Loader2, Mail, MessageCircle, Send } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { EA_COUNTRY_CODES, normalizePhoneForWhatsApp } from "@renderer/shared/lib/phone";
import { getSharePreferences, setSharePreferences } from "@renderer/shared/lib/share-preferences";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { ShareDocumentEntity } from "@shared/types/share";

type Channel = "whatsapp" | "email";
const CUSTOM_COUNTRY = "custom";

/** WhatsApp/mailto: deep links only ever pre-fill a TEXT message — neither can attach a file, a
 * platform limitation, not something this app can work around. The link itself IS the share; the
 * public page it points to (the SHARE app) is what actually renders the document.
 *
 * The WhatsApp link is deliberately `https://wa.me/...`, NOT `whatsapp://send?...` — wa.me is
 * WhatsApp's own real HTTPS page: its own JavaScript detects whether the app responded and
 * redirects to web.whatsapp.com if not. A bare `whatsapp://` custom URI scheme has no such
 * fallback logic of its own — if nothing on the machine has registered a handler for it, Windows
 * just shows its own "no app found" dialog instead. wa.me's "extra hop" IS that same app-detection
 * redirect, just done properly, so there's no reliability to trade away by using it. */
export function ShareModal({
  open,
  onClose,
  entity,
  entityId,
  documentLabel,
  customerId,
  hasDeliveryNote = false,
  deliveryOnly = false
}: {
  open: boolean;
  onClose: () => void;
  entity: ShareDocumentEntity;
  entityId: string;
  documentLabel: string;
  customerId: string | null;
  /** Whether this sale/quotation has a delivery note attached — shows the "Include delivery note"
   * checkbox when true, hidden entirely otherwise (most documents have no delivery to attach). */
  hasDeliveryNote?: boolean;
  /** Shares ONLY the delivery note (entityId is still the PARENT sale/quotation's id — SERVER
   * resolves it the same way as the "Include delivery note" checkbox does) instead of the priced
   * document — used when sharing is launched from the delivery note's own preview modal, which has
   * no document of its own to attach. Hides the checkbox (there's nothing else to toggle here). */
  deliveryOnly?: boolean;
}): React.JSX.Element {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [countryCode, setCountryCode] = useState<string>(EA_COUNTRY_CODES[0].code);
  const [customCode, setCustomCode] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [recipient, setRecipient] = useState("");
  const [includeDelivery, setIncludeDelivery] = useState(true);
  const [includeWhatsappPreview, setIncludeWhatsappPreview] = useState(false);
  const [sending, setSending] = useState(false);

  function handleIncludeDeliveryChange(checked: boolean): void {
    setIncludeDelivery(checked);
    setSharePreferences({ includeDelivery: checked, includeWhatsappPreview });
  }

  function handleIncludeWhatsappPreviewChange(checked: boolean): void {
    setIncludeWhatsappPreview(checked);
    setSharePreferences({ includeDelivery, includeWhatsappPreview: checked });
  }

  useEffect(() => {
    if (!open) return;
    setChannel("whatsapp");
    setCountryCode(EA_COUNTRY_CODES[0].code);
    setCustomCode("");
    setCustomerPhone("");
    setCustomerEmail("");
    setRecipient("");
    // Remembered from the last time this user shared anything, not reset to a hardcoded default —
    // client feedback was that re-unchecking the same box every single share got old fast.
    const preferences = getSharePreferences();
    setIncludeDelivery(preferences.includeDelivery);
    setIncludeWhatsappPreview(preferences.includeWhatsappPreview);
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
      let message: string;
      if (deliveryOnly) {
        message = (await window.blueLedger.share.createDeliveryLink(entity, entityId, includeWhatsappPreview)).message;
      } else {
        const primary = await window.blueLedger.share.createLink(entity, entityId, includeWhatsappPreview);
        message = primary.message;
        // The delivery note gets its own link/token (SERVER resolves it via the same sale/quotation
        // id, tagged as `${entity}_delivery`) — its message is appended right after the document's
        // own, so the recipient reads both in one message with two separate download links.
        if (hasDeliveryNote && includeDelivery) {
          const delivery = await window.blueLedger.share.createDeliveryLink(entity, entityId, includeWhatsappPreview);
          message = `${primary.message}\n\n${delivery.message}`;
        }
      }

      if (channel === "whatsapp") {
        const effectiveCode = countryCode === CUSTOM_COUNTRY ? customCode : countryCode;
        const digits = normalizePhoneForWhatsApp(recipient, effectiveCode);
        window.open(`whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}`);
      } else {
        const subject = encodeURIComponent(documentLabel);
        window.open(`mailto:${recipient}?subject=${subject}&body=${encodeURIComponent(message)}`);
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
              <option value={CUSTOM_COUNTRY}>Custom…</option>
            </select>
          </label>
          <label className="col-span-2 block">
            <span className="text-[11px] font-bold tracking-wide text-muted uppercase">Phone number</span>
            <input
              type="tel"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="e.g. 0791880000"
              className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
          </label>
          {countryCode === CUSTOM_COUNTRY && (
            <label className="col-span-3 block">
              <span className="text-[11px] font-bold tracking-wide text-muted uppercase">Country code</span>
              <input
                type="text"
                inputMode="numeric"
                value={customCode}
                onChange={(event) => setCustomCode(event.target.value)}
                placeholder="e.g. 44 for the UK"
                className="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </label>
          )}
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

      <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-soft px-3 py-2.5">
        <input
          type="checkbox"
          checked={includeWhatsappPreview}
          onChange={(event) => handleIncludeWhatsappPreviewChange(event.target.checked)}
          className="size-4 accent-accent"
        />
        <span className="text-xs font-bold text-ink">Include WhatsApp preview</span>
      </label>

      {hasDeliveryNote && !deliveryOnly && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-soft px-3 py-2.5">
          <input
            type="checkbox"
            checked={includeDelivery}
            onChange={(event) => handleIncludeDeliveryChange(event.target.checked)}
            className="size-4 accent-accent"
          />
          <span className="text-xs font-bold text-ink">Include delivery note</span>
        </label>
      )}

      <p className="mt-3 text-xs font-semibold text-muted">
        {channel === "whatsapp"
          ? "Opens WhatsApp with a formatted message containing a link to view/download the document — WhatsApp can't attach files automatically."
          : "Opens your email app with the message and link pre-filled."}
      </p>

      <Button
        type="button"
        onClick={() => void handleSend()}
        disabled={
          sending || !recipient.trim() || (channel === "whatsapp" && countryCode === CUSTOM_COUNTRY && !customCode.trim())
        }
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

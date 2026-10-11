import { useEffect, useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { Modal } from "@renderer/shared/components/Modal";
import { StorefrontPicker } from "@renderer/shared/components/StorefrontPicker";
import type { OnlineOrder } from "@shared/types/online-store";

/** Confirming holds the order's items out of a branch's stock. A signed-in user with no branch of
 * their own (e.g. Super Admin), on a store with no fulfilment branch set, picks which branch here. */
export function HoldStorefrontModal({
  order,
  open,
  busy,
  onClose,
  onChoose
}: {
  order: OnlineOrder;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onChoose: (storefrontId: string) => void;
}): React.JSX.Element {
  const [storefrontId, setStorefrontId] = useState("");

  useEffect(() => {
    if (open) setStorefrontId("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Hold stock for ${order.orderNumber}`}
      description="Confirming takes the order's items out of a branch's stock so nobody sells them at the till. Which branch is it coming from?"
      widthClassName="max-w-md"
    >
      <div className="space-y-4">
        <StorefrontPicker value={storefrontId} onChange={setStorefrontId} />
        <p className="text-xs font-semibold text-muted">
          Tip: set a fulfilment branch for the website in Online Store settings and this won&apos;t be asked again.
        </p>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" onClick={onClose} className="border border-line bg-white text-ink shadow-none hover:bg-soft">
            Cancel
          </Button>
          <Button type="button" onClick={() => onChoose(storefrontId)} disabled={busy || !storefrontId} className="gap-2 bg-primary">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PackageCheck className="size-4" aria-hidden="true" />}
            Hold stock &amp; continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}

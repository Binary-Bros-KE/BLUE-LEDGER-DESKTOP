import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { DeliveryNotePreview } from "@renderer/shared/components/DeliveryNotePreview";
import { Modal } from "@renderer/shared/components/Modal";
import { ReceiptPreview } from "@renderer/shared/components/ReceiptPreview";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { useAppStore } from "@renderer/shared/stores/app-store";
import type { OnlineOrder } from "@shared/types/online-store";
import type { Sale, SaleDelivery } from "@shared/types/sale";

export type OrderDocument = "receipt" | "delivery";

/** The receipt / delivery note a completed web order became — the same previews (print, PDF,
 * share) as the Receipts screen. Needs the sale on this computer: one completed on another till
 * shows up here after Cloud Sync. */
export function OrderDocumentsModal({
  order,
  document,
  onClose
}: {
  order: OnlineOrder;
  document: OrderDocument | null;
  onClose: () => void;
}): React.JSX.Element {
  const tenant = useAppStore((state) => state.context?.tenant ?? null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [delivery, setDelivery] = useState<SaleDelivery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saleId = order.linkedSaleId;

  useEffect(() => {
    if (!document || !saleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      window.blueLedger.sale.get(saleId),
      window.blueLedger.deliveryNote.getForSale(saleId).catch(() => null)
    ])
      .then(([s, d]) => {
        if (cancelled) return;
        setSale(s);
        setDelivery(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSale(null);
        setError(
          getErrorMessage(err, "Couldn't open the sale").includes("not found")
            ? `Receipt ${order.linkedReceiptNumber ?? ""} was recorded on another computer — run Cloud Sync to see it here.`
            : getErrorMessage(err, "Couldn't open the sale")
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [document, saleId, order.linkedReceiptNumber]);

  const title =
    document === "delivery"
      ? `Delivery note — ${order.orderNumber}`
      : `Receipt ${order.linkedReceiptNumber ?? ""} — ${order.orderNumber}`;

  return (
    <Modal open={document !== null} onClose={onClose} title={title} widthClassName="max-w-3xl">
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted" aria-hidden="true" />
        </div>
      ) : error ? (
        <p className="rounded-lg border border-line bg-soft p-4 text-sm font-semibold text-muted">{error}</p>
      ) : !sale || !tenant ? null : document === "delivery" ? (
        delivery ? (
          <DeliveryNotePreview
            delivery={delivery}
            tenant={tenant}
            locationId={sale.locationId}
            sourceDocumentLabel="Receipt"
            sourceDocumentNumber={sale.receiptNumber}
            parentEntity="sale"
            parentEntityId={sale.id}
            onDeliveredChange={setDelivery}
          />
        ) : (
          <p className="rounded-lg border border-line bg-soft p-4 text-sm font-semibold text-muted">
            This sale has no delivery note.
          </p>
        )
      ) : (
        <ReceiptPreview sale={sale} tenant={tenant} />
      )}
    </Modal>
  );
}

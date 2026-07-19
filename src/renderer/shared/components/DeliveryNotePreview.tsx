import { useState } from "react";
import { CheckCircle2, Download, Loader2, Printer, RotateCcw, Share2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { SaleDelivery } from "@shared/types/sale";
import type { TenantContext } from "@shared/types/tenant";

/**
 * Wide/landscape-styled, mirrors ReceiptPreview's structure — but Share actually works here (via the
 * payslip pattern), and it never shows a fee/cost figure since SaleDelivery/DeliveryNoteViewModel
 * carry none. Delivery status is fully independent of the sale's own revenue recognition.
 */
export function DeliveryNotePreview({
  delivery,
  tenant,
  sourceDocumentLabel,
  sourceDocumentNumber,
  onDeliveredChange
}: {
  delivery: SaleDelivery;
  tenant: TenantContext;
  sourceDocumentLabel: string;
  sourceDocumentNumber: string | null;
  onDeliveredChange?: (next: SaleDelivery) => void;
}): React.JSX.Element {
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [togglingDelivered, setTogglingDelivered] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePrint(): Promise<void> {
    setPrinting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.blueLedger.printer.printDeliveryNote(delivery.id);
      if (result.success) setNotice(result.message);
      else setError(result.message);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to print delivery note"));
    } finally {
      setPrinting(false);
    }
  }

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setError(null);
    setNotice(null);
    try {
      const savedPath = await window.blueLedger.printer.generateDeliveryNotePdf(delivery.id);
      if (savedPath) setNotice(`Saved to ${savedPath}`);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to generate PDF"));
    } finally {
      setDownloading(false);
    }
  }

  async function handleShare(): Promise<void> {
    setSharing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.blueLedger.printer.shareDeliveryNote(delivery.id);
      if (result.success) setNotice(result.message);
      else setError(result.message);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to share delivery note"));
    } finally {
      setSharing(false);
    }
  }

  async function handleToggleDelivered(): Promise<void> {
    setTogglingDelivered(true);
    setError(null);
    try {
      const updated = await window.blueLedger.deliveryNote.setDelivered(delivery.id, !delivery.isDelivered);
      onDeliveredChange?.(updated);
      showSuccessToast(updated.isDelivered ? "Marked as delivered" : "Marked as not delivered");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to update delivery status");
      setError(message);
      showErrorToast(message);
    } finally {
      setTogglingDelivered(false);
    }
  }

  const addressLine = [delivery.town, delivery.country].filter(Boolean).join(", ");

  return (
    <div>
      {notice && (
        <div className="mb-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold text-success">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-dashed border-line bg-soft/40 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-ink">{tenant.businessName}</p>
            {tenant.physicalAddress && <p className="text-[11px] text-muted">{tenant.physicalAddress}</p>}
            {tenant.primaryPhone && <p className="text-[11px] text-muted">{tenant.primaryPhone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Delivery Note</p>
            <p className="text-sm font-extrabold text-ink">{delivery.deliveryNoteNumber}</p>
            <DashedPill tone={delivery.isDelivered ? "success" : "warning"} className="mt-1">
              {delivery.isDelivered ? "Delivered" : "Pending"}
            </DashedPill>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Deliver To</p>
            <p className="mt-1 text-lg font-extrabold text-ink">{delivery.recipientName}</p>
            <p className="text-sm font-semibold text-ink">{delivery.physicalAddress}</p>
            {addressLine && <p className="text-sm font-semibold text-ink">{addressLine}</p>}
            {delivery.notes && <p className="mt-1 text-xs font-semibold text-muted">Notes: {delivery.notes}</p>}
          </div>
          <div className="border-t border-dashed border-line pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Rider</p>
            <p className="mt-1 text-sm font-extrabold text-ink">{delivery.riderName ?? "Not assigned"}</p>
            {delivery.riderPhone && <p className="text-xs font-semibold text-muted">{delivery.riderPhone}</p>}
            {delivery.riderCompany && <p className="text-xs font-semibold text-muted">{delivery.riderCompany}</p>}
            {delivery.riderVehicleDescription && (
              <p className="text-xs font-semibold text-muted">{delivery.riderVehicleDescription}</p>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-dashed border-line pt-3 text-[11px] font-semibold text-muted">
          {sourceDocumentLabel}: {sourceDocumentNumber ?? "—"}
        </div>
      </div>

      <Button
        type="button"
        onClick={() => void handleToggleDelivered()}
        disabled={togglingDelivered}
        className={cn(
          "mt-4 h-9 w-full text-xs disabled:cursor-not-allowed disabled:opacity-50",
          delivery.isDelivered
            ? "border border-line bg-white text-ink shadow-none hover:bg-soft"
            : "bg-success hover:brightness-110"
        )}
      >
        {togglingDelivered ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
        ) : delivery.isDelivered ? (
          <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
        )}
        {delivery.isDelivered ? "Mark as Not Delivered" : "Mark as Delivered"}
      </Button>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <Button
          type="button"
          onClick={() => void handlePrint()}
          disabled={printing}
          className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {printing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Printer className="mr-1.5 size-3.5" aria-hidden="true" />
          )}
          Print
        </Button>
        <Button
          type="button"
          onClick={() => void handleDownload()}
          disabled={downloading}
          className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {downloading ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="mr-1.5 size-3.5" aria-hidden="true" />
          )}
          Download
        </Button>
        <Button
          type="button"
          onClick={() => void handleShare()}
          disabled={sharing}
          className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sharing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
          )}
          Share
        </Button>
      </div>
    </div>
  );
}

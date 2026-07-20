import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, Printer, RotateCcw, RotateCw, Share2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Location } from "@shared/types/location";
import type { SaleDelivery } from "@shared/types/sale";
import type { TenantContext } from "@shared/types/tenant";

/**
 * Wide/landscape-styled, mirrors ReceiptPreview's structure — but Share actually works here (via the
 * payslip pattern), and it never shows a fee/cost figure since SaleDelivery/DeliveryNoteViewModel
 * carry none. Delivery status is fully independent of the sale's own revenue recognition.
 */
function DeliveryField({
  label,
  value,
  large = false
}: {
  label: string;
  value: string | null;
  large?: boolean;
}): React.JSX.Element | null {
  if (!value) return null;
  return (
    <div className="flex gap-2 border-b border-dotted border-line py-0.5">
      <span className="w-16 flex-none text-[9px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      <span className={cn("flex-1 font-bold text-ink", large ? "text-base" : "text-xs")}>{value}</span>
    </div>
  );
}

export function DeliveryNotePreview({
  delivery,
  tenant,
  locationId,
  sourceDocumentLabel,
  sourceDocumentNumber,
  onDeliveredChange
}: {
  delivery: SaleDelivery;
  tenant: TenantContext;
  /** The source sale/quotation's own storefront — the delivery note must show THAT storefront's
   * identity, never the tenant-wide Business Profile's (mirrors ReceiptPreview/resolveDocumentBusiness). */
  locationId: string;
  sourceDocumentLabel: string;
  sourceDocumentNumber: string | null;
  onDeliveredChange?: (next: SaleDelivery) => void;
}): React.JSX.Element {
  const [printing, setPrinting] = useState(false);
  const [printingThermal, setPrintingThermal] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [togglingDelivered, setTogglingDelivered] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<Location | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.blueLedger.location
      .get(locationId)
      .then((result) => {
        if (!cancelled) setLocation(result);
      })
      .catch(() => {
        if (!cancelled) setLocation(null);
      });
    return () => {
      cancelled = true;
    };
  }, [locationId]);

  const businessName = location?.locationName ?? tenant.businessName;
  const physicalAddress = location?.physicalAddress ?? tenant.physicalAddress;
  const primaryPhone = location?.phone ?? tenant.primaryPhone;

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

  async function handlePrintThermal(): Promise<void> {
    setPrintingThermal(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.blueLedger.printer.printDeliveryNoteThermal(delivery.id);
      if (result.success) setNotice(result.message);
      else setError(result.message);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to print delivery note"));
    } finally {
      setPrintingThermal(false);
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
            <p className="text-sm font-extrabold text-ink">{businessName}</p>
            {physicalAddress && <p className="text-[11px] text-muted">{physicalAddress}</p>}
            {primaryPhone && <p className="text-[11px] text-muted">{primaryPhone}</p>}
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
            <div className="mt-1.5 space-y-1">
              <DeliveryField label="Recipient" value={delivery.recipientName} large />
              <DeliveryField label="Address" value={delivery.physicalAddress} />
              <DeliveryField label="Town" value={addressLine || null} />
              <DeliveryField label="Notes" value={delivery.notes} />
            </div>
          </div>
          <div className="border-t border-dashed border-line pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Rider</p>
            <div className="mt-1.5 space-y-1">
              <DeliveryField label="Name" value={delivery.riderName ?? "Not assigned"} />
              <DeliveryField label="Phone" value={delivery.riderPhone} />
              <DeliveryField label="Company" value={delivery.riderCompany} />
              <DeliveryField label="Vehicle" value={delivery.riderVehicleDescription} />
            </div>
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

      <Button
        type="button"
        onClick={() => void handlePrintThermal()}
        disabled={printingThermal}
        title="For shops with only a narrow thermal receipt printer — prints a rotated strip. Rotate the printed strip 90° once it's out, then tape it to the package."
        className="mt-2 h-9 w-full border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
      >
        {printingThermal ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCw className="mr-1.5 size-3.5" aria-hidden="true" />
        )}
        Print via Receipt Printer
      </Button>
    </div>
  );
}

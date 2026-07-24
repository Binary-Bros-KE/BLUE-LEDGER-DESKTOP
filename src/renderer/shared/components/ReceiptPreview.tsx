import { useEffect, useState } from "react";
import { Download, Loader2, Printer, Share2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { ShareModal } from "@renderer/shared/components/ShareModal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { buildReceiptViewModel, formatReceiptCents } from "@shared/lib/receipt";
import type { Location } from "@shared/types/location";
import type { Sale } from "@shared/types/sale";
import type { TenantContext } from "@shared/types/tenant";

export function ReceiptPreview({ sale, tenant }: { sale: Sale; tenant: TenantContext }): React.JSX.Element {
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The receipt must show THIS SALE's own storefront identity, never the tenant-wide Business
  // Profile's — a storefront's name/address/phone/header/footer only fall back to the tenant default
  // when the storefront hasn't set its own (see resolveDocumentBusiness in printer-service.ts, which
  // this mirrors for the on-screen preview).
  const [location, setLocation] = useState<Location | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.blueLedger.location
      .get(sale.locationId)
      .then((result) => {
        if (!cancelled) setLocation(result);
      })
      .catch(() => {
        if (!cancelled) setLocation(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sale.locationId]);

  const vm = buildReceiptViewModel(sale, {
    businessName: location?.locationName ?? tenant.businessName,
    physicalAddress: location?.physicalAddress ?? tenant.physicalAddress,
    primaryPhone: location?.phone ?? tenant.primaryPhone,
    receiptHeader: location?.receiptHeader ?? tenant.receiptHeader,
    receiptFooter: location?.receiptFooter ?? tenant.receiptFooter,
    currency: tenant.currency
  });

  const money = (cents: number | null): string => `${vm.currency} ${formatReceiptCents(cents)}`;

  async function handlePrint(): Promise<void> {
    setPrinting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.blueLedger.printer.printReceipt(sale.id);
      if (result.success) {
        setNotice(result.message);
        showSuccessToast(result.message);
      } else {
        setError(result.message);
        showErrorToast(result.message);
      }
    } catch (err) {
      const message = getErrorMessage(err, "Failed to print receipt");
      setError(message);
      showErrorToast(message);
    } finally {
      setPrinting(false);
    }
  }

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setError(null);
    setNotice(null);
    try {
      const savedPath = await window.blueLedger.printer.generateReceiptPdf(sale.id);
      if (savedPath) {
        setNotice(`Saved to ${savedPath}`);
        showSuccessToast(`Saved to ${savedPath}`);
      }
    } catch (err) {
      const message = getErrorMessage(err, "Failed to generate PDF");
      setError(message);
      showErrorToast(message);
    } finally {
      setDownloading(false);
    }
  }

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

      <div className="mx-auto max-w-xs rounded-lg border border-dashed border-line bg-soft/40 p-4 font-mono text-xs text-ink">
        <div className="text-center">
          <p className="text-sm font-extrabold">{vm.businessName}</p>
          {vm.physicalAddress && <p className="text-[10px] text-muted">{vm.physicalAddress}</p>}
          {vm.primaryPhone && <p className="text-[10px] text-muted">{vm.primaryPhone}</p>}
          {vm.receiptHeader && <p className="mt-1 text-[10px] text-muted">{vm.receiptHeader}</p>}
        </div>

        <div className="my-2 border-t border-dashed border-line" />
        <p className="text-[10px] leading-relaxed text-muted">
          Receipt: {vm.receiptNumber ?? "-"}
          <br />
          Date: {vm.dateLabel}
          <br />
          Cashier: {vm.cashierName} · Branch: {vm.branchName}
          {vm.customerName && (
            <>
              <br />
              Customer: {vm.customerName}
            </>
          )}
        </p>

        <div className="my-2 border-t border-dashed border-line" />
        <div className="space-y-1.5">
          {[...vm.items, ...vm.extraLines].map((item, index) => (
            <div key={index} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-bold">{item.name}</p>
                <p className="text-[10px] text-muted">
                  {item.quantity} x {money(item.unitPriceCents)}
                </p>
              </div>
              <p className="flex-none font-bold">{money(item.lineTotalCents)}</p>
            </div>
          ))}
        </div>

        <div className="my-2 border-t border-dashed border-line" />
        <div className="space-y-1">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{money(vm.subtotalCents)}</span>
          </div>
          {vm.discountAmountCents > 0 && (
            <div className="flex justify-between">
              <span>Discount</span>
              <span>-{money(vm.discountAmountCents)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>Tax</span>
            <span>{money(vm.taxAmountCents)}</span>
          </div>
          <div className="flex justify-between text-sm font-extrabold">
            <span>Total</span>
            <span>{money(vm.grandTotalCents)}</span>
          </div>
        </div>

        <div className="my-2 border-t border-dashed border-line" />
        <p className="text-[10px] leading-relaxed text-muted">
          Payment: {vm.paymentMethodName ?? "-"}
          {vm.paymentReference && (
            <>
              <br />
              Ref: {vm.paymentReference}
            </>
          )}
          {vm.amountReceivedCents !== null && (
            <>
              <br />
              Received: {money(vm.amountReceivedCents)}
            </>
          )}
          {vm.changeGivenCents !== null && vm.changeGivenCents > 0 && (
            <>
              <br />
              Change: {money(vm.changeGivenCents)}
            </>
          )}
        </p>

        <div className="my-2 border-t border-dashed border-line" />
        <p className="text-center text-[10px] text-muted">{vm.receiptFooter ?? "Thank you for your business!"}</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
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
          onClick={() => setSharing(true)}
          className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft"
        >
          <Share2 className="mr-1.5 size-3.5" aria-hidden="true" />
          Share
        </Button>
      </div>

      <ShareModal
        open={sharing}
        onClose={() => setSharing(false)}
        entity="sale"
        entityId={sale.id}
        documentLabel={`Receipt ${vm.receiptNumber ?? ""}`.trim()}
        customerId={sale.customerId}
      />
    </div>
  );
}

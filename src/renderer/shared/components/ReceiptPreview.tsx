import { useEffect, useState } from "react";
import { Eye, Loader2, Printer, Share2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { CheckboxField } from "@renderer/shared/components/form-fields";
import { ShareModal } from "@renderer/shared/components/ShareModal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { buildReceiptViewModel, formatReceiptCents } from "@shared/lib/receipt";
import { taxBreakdownLabel } from "@shared/lib/tax-calculation";
import type { Location } from "@shared/types/location";
import type { Sale } from "@shared/types/sale";
import type { TenantContext } from "@shared/types/tenant";

export function ReceiptPreview({ sale, tenant }: { sale: Sale; tenant: TenantContext }): React.JSX.Element {
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Toggleable even after the receipt already exists — a cashier will sometimes forget to set this
  // at checkout. Tracked locally (not re-fetched from `sale`) so the on-screen preview and every
  // subsequent Print/Preview/Share on THIS screen reflect the change immediately.
  const [includeTaxBreakdown, setIncludeTaxBreakdown] = useState(sale.includeTaxBreakdown);
  const [togglingTax, setTogglingTax] = useState(false);

  useEffect(() => {
    setIncludeTaxBreakdown(sale.includeTaxBreakdown);
  }, [sale.id, sale.includeTaxBreakdown]);

  async function handleToggleTaxBreakdown(next: boolean): Promise<void> {
    setTogglingTax(true);
    try {
      await window.blueLedger.sale.setIncludeTaxBreakdown(sale.id, next);
      setIncludeTaxBreakdown(next);
      showSuccessToast(next ? "Tax breakdown will now show on this receipt" : "Tax breakdown hidden on this receipt");
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to update the tax breakdown setting"));
    } finally {
      setTogglingTax(false);
    }
  }
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

  const vm = buildReceiptViewModel(
    { ...sale, includeTaxBreakdown },
    {
      businessName: location?.locationName ?? tenant.businessName,
      physicalAddress: location?.physicalAddress ?? tenant.physicalAddress,
      primaryPhone: location?.phone ?? tenant.primaryPhone,
      receiptHeader: location?.receiptHeader ?? tenant.receiptHeader,
      receiptFooter: location?.receiptFooter ?? tenant.receiptFooter,
      currency: tenant.currency,
      vatRatePercent: tenant.vatRatePercent
    }
  );

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

  async function handlePreview(): Promise<void> {
    setPreviewing(true);
    setError(null);
    setNotice(null);
    try {
      await window.blueLedger.printer.previewReceiptPdf(sale.id);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to open preview");
      setError(message);
      showErrorToast(message);
    } finally {
      setPreviewing(false);
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

      <div className="mx-auto max-w-xs border-2 border-ink bg-white p-3 font-mono text-xs text-ink">
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

        <table className="mt-2 w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="border border-ink bg-soft px-1.5 py-1 text-left font-extrabold uppercase">Item</th>
              <th className="border border-ink bg-soft px-1.5 py-1 text-center font-extrabold uppercase">Qty</th>
              <th className="border border-ink bg-soft px-1.5 py-1 text-right font-extrabold uppercase">Price</th>
              <th className="border border-ink bg-soft px-1.5 py-1 text-right font-extrabold uppercase">Sub Total</th>
            </tr>
          </thead>
          <tbody>
            {[...vm.items, ...vm.extraLines].map((item, index) => (
              <tr key={index}>
                <td className="border border-ink px-1.5 py-1 font-bold">{item.name}</td>
                <td className="border border-ink px-1.5 py-1 text-center">{item.quantity}</td>
                <td className="border border-ink px-1.5 py-1 text-right">{money(item.unitPriceCents)}</td>
                <td className="border border-ink px-1.5 py-1 text-right font-bold">{money(item.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="mt-2 w-full border-collapse text-[11px]">
          <tbody>
            <tr>
              <td className="border border-ink bg-soft px-1.5 py-1 font-bold">Subtotal</td>
              <td className="border border-ink px-1.5 py-1 text-right">{money(vm.subtotalCents)}</td>
            </tr>
            {vm.discountAmountCents > 0 && (
              <tr>
                <td className="border border-ink bg-soft px-1.5 py-1 font-bold">Discount</td>
                <td className="border border-ink px-1.5 py-1 text-right">-{money(vm.discountAmountCents)}</td>
              </tr>
            )}
            {vm.includeTaxBreakdown && vm.addedTaxCents > 0 && (
              <tr>
                <td className="border border-ink bg-soft px-1.5 py-1 font-bold">Total Tax</td>
                <td className="border border-ink px-1.5 py-1 text-right">{money(vm.addedTaxCents)}</td>
              </tr>
            )}
            <tr>
              <td className="border border-ink bg-soft px-1.5 py-1 text-sm font-extrabold">Total</td>
              <td className="border border-ink px-1.5 py-1 text-right text-sm font-extrabold">{money(vm.grandTotalCents)}</td>
            </tr>
          </tbody>
        </table>

        {vm.includeTaxBreakdown && vm.taxBreakdown.length > 0 && (
          <table className="mt-2 w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className="border border-ink bg-soft px-1.5 py-1 text-left font-extrabold uppercase" colSpan={4}>
                  Tax Breakdown
                </th>
              </tr>
              <tr>
                <th className="border border-ink bg-soft px-1.5 py-1 text-left font-bold uppercase">Category</th>
                <th className="border border-ink bg-soft px-1.5 py-1 text-right font-bold uppercase">Net</th>
                <th className="border border-ink bg-soft px-1.5 py-1 text-right font-bold uppercase">Tax</th>
                <th className="border border-ink bg-soft px-1.5 py-1 text-right font-bold uppercase">Gross</th>
              </tr>
            </thead>
            <tbody>
              {vm.taxBreakdown.map((entry) => (
                <tr key={`${entry.taxType}:${entry.pricingMode ?? ""}`}>
                  <td className="border border-ink px-1.5 py-1 font-bold">
                    {taxBreakdownLabel(entry.taxType, { vatRatePercent: vm.vatRatePercent, pricesTaxInclusive: true }, entry.pricingMode)}
                  </td>
                  <td className="border border-ink px-1.5 py-1 text-right">{money(entry.netCents)}</td>
                  <td className="border border-ink px-1.5 py-1 text-right">{money(entry.taxCents)}</td>
                  <td className="border border-ink px-1.5 py-1 text-right">{money(entry.grossCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

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

      <div className={cn("mt-3 rounded-lg border border-line bg-soft/60 px-3 py-2.5", togglingTax && "pointer-events-none opacity-60")}>
        <CheckboxField
          label="Include tax information"
          description="Shows the Tax Breakdown section on this receipt's print, download, and share"
          checked={includeTaxBreakdown}
          onChange={(checked) => void handleToggleTaxBreakdown(checked)}
        />
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
          onClick={() => void handlePreview()}
          disabled={previewing}
          className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {previewing ? (
            <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Eye className="mr-1.5 size-3.5" aria-hidden="true" />
          )}
          Preview
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
        hasDeliveryNote={sale.delivery !== null}
      />
    </div>
  );
}

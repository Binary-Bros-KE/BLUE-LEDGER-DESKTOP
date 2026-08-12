import { useState } from "react";
import { Eye, Loader2, Printer, Share2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { ShareModal } from "@renderer/shared/components/ShareModal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import type { Sale } from "@shared/types/sale";
import type { TenantContext } from "@shared/types/tenant";

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

/**
 * A read-only invoice summary + Print/Preview/Share actions, all wired to the invoice-specific IPC
 * channels (previewInvoicePdf/printInvoiceDocument) — the compact counterpart to ReceiptPreview, for
 * contexts (like Approvals' cancellation-request view) that need to show an invoice without pulling
 * in InvoicesRoute's full editable detail modal (payments, cancel/void actions, etc.).
 */
export function InvoicePreview({ sale, tenant }: { sale: Sale; tenant: TenantContext }): React.JSX.Element {
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (cents: number | null): string => `${tenant.currency} ${formatCents(cents)}`;

  async function handlePrint(): Promise<void> {
    setPrinting(true);
    setError(null);
    try {
      const result = await window.blueLedger.printer.printInvoiceDocument(sale.id);
      if (result.success) {
        showSuccessToast(result.message);
      } else {
        setError(result.message);
        showErrorToast(result.message);
      }
    } catch (err) {
      const message = getErrorMessage(err, "Failed to print invoice");
      setError(message);
      showErrorToast(message);
    } finally {
      setPrinting(false);
    }
  }

  async function handlePreview(): Promise<void> {
    setPreviewing(true);
    setError(null);
    try {
      await window.blueLedger.printer.previewInvoicePdf(sale.id);
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
      {error && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">
          {error}
        </div>
      )}

      <div className="rounded-lg border-2 border-ink bg-white p-3.5 text-xs text-ink">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold">{sale.locationName}</p>
            {sale.customerName && <p className="mt-0.5 text-[11px] font-semibold text-muted">Bill to: {sale.customerName}</p>}
          </div>
          <p className="flex-none text-sm font-extrabold uppercase tracking-wide">Invoice</p>
        </div>

        <div className="my-2 border-t border-dashed border-line" />
        <p className="text-[10px] leading-relaxed text-muted">
          Invoice: {sale.invoiceNumber ?? "-"}
          <br />
          Date: {formatDate(sale.invoiceDate)} · Due: {formatDate(sale.dueDate)}
          <br />
          Issued by: {sale.employeeName}
        </p>

        <table className="mt-2 w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="border border-ink bg-soft px-1.5 py-1 text-left font-extrabold uppercase">Item</th>
              <th className="border border-ink bg-soft px-1.5 py-1 text-center font-extrabold uppercase">Qty</th>
              <th className="border border-ink bg-soft px-1.5 py-1 text-right font-extrabold uppercase">Price</th>
              <th className="border border-ink bg-soft px-1.5 py-1 text-right font-extrabold uppercase">Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td className="border border-ink px-1.5 py-1 font-bold">{item.productName}</td>
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
              <td className="border border-ink px-1.5 py-1 text-right">{money(sale.subtotalCents)}</td>
            </tr>
            {sale.discountAmountCents > 0 && (
              <tr>
                <td className="border border-ink bg-soft px-1.5 py-1 font-bold">Discount</td>
                <td className="border border-ink px-1.5 py-1 text-right">-{money(sale.discountAmountCents)}</td>
              </tr>
            )}
            <tr>
              <td className="border border-ink bg-soft px-1.5 py-1 text-sm font-extrabold">Total</td>
              <td className="border border-ink px-1.5 py-1 text-right text-sm font-extrabold">{money(sale.grandTotalCents)}</td>
            </tr>
            <tr>
              <td className="border border-ink px-1.5 py-1 font-bold">Amount Paid</td>
              <td className="border border-ink px-1.5 py-1 text-right">{money(sale.amountPaidCents)}</td>
            </tr>
            <tr>
              <td className="border border-ink bg-danger-soft px-1.5 py-1 font-extrabold text-danger">Balance Due</td>
              <td className="border border-ink bg-danger-soft px-1.5 py-1 text-right font-extrabold text-danger">
                {money(sale.balanceDueCents)}
              </td>
            </tr>
          </tbody>
        </table>
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
        documentLabel={`Invoice ${sale.invoiceNumber ?? ""}`.trim()}
        customerId={sale.customerId}
        hasDeliveryNote={sale.delivery !== null}
      />
    </div>
  );
}

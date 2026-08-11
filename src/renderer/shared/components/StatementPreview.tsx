import { useState } from "react";
import { Eye, Loader2, Printer, Share2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ShareModal } from "@renderer/shared/components/ShareModal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { PAYMENT_STATUS_OPTIONS, type PaymentStatus } from "@shared/types/sale";
import type { CustomerStatementViewModel } from "@shared/types/statement";

function statusTone(status: PaymentStatus): "success" | "warning" | "danger" | "neutral" | "accent" {
  if (status === "overdue") return "danger";
  if (status === "partially_paid") return "warning";
  if (status === "cancelled") return "neutral";
  return "accent";
}

function statusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Statement of Account for one customer — every invoice they haven't fully paid off yet, across
 * every storefront, with running totals. Purely a read-only summary (no "mark paid" actions here —
 * that stays on the Invoices tab, this is just the shareable rollup). Mirrors ReceiptPreview's
 * Print/Download/Share trio. */
export function StatementPreview({ vm }: { vm: CustomerStatementViewModel }): React.JSX.Element {
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (cents: number): string => `${vm.currency} ${(cents / 100).toFixed(2)}`;
  const availableCreditCents = vm.creditLimitCents !== null ? Math.max(0, vm.creditLimitCents - vm.totalOutstandingCents) : null;

  async function handlePrint(): Promise<void> {
    setPrinting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.blueLedger.printer.printStatementDocument(vm.customerId);
      if (result.success) {
        setNotice(result.message);
        showSuccessToast(result.message);
      } else {
        setError(result.message);
        showErrorToast(result.message);
      }
    } catch (err) {
      const message = getErrorMessage(err, "Failed to print statement");
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
      await window.blueLedger.printer.previewStatementPdf(vm.customerId);
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

      <div className="rounded-lg border border-dashed border-line bg-soft/40 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-ink">{vm.businessName}</p>
            {vm.physicalAddress && <p className="text-[11px] text-muted">{vm.physicalAddress}</p>}
            {vm.primaryPhone && <p className="text-[11px] text-muted">{vm.primaryPhone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Statement</p>
            <p className="text-[11px] font-semibold text-muted">{new Date(vm.generatedAt).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Statement For</p>
            <p className="mt-1 text-sm font-extrabold text-ink">{vm.customerName}</p>
            <p className="text-[11px] font-semibold text-muted">{vm.customerPhone}</p>
            {vm.customerEmail && <p className="text-[11px] font-semibold text-muted">{vm.customerEmail}</p>}
          </div>
          {vm.creditLimitCents !== null && availableCreditCents !== null && (
            <div className="border-t border-dashed border-line pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Credit Limit</p>
              <p className="mt-1 text-sm font-extrabold text-ink">{money(vm.creditLimitCents)}</p>
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Available Credit</p>
              <p className="text-sm font-extrabold text-ink">{money(availableCreditCents)}</p>
            </div>
          )}
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line bg-soft text-[10px] font-extrabold uppercase tracking-wide text-muted">
                <th className="px-2.5 py-2 text-left">Invoice</th>
                <th className="px-2.5 py-2 text-left">Due</th>
                <th className="px-2.5 py-2 text-right">Total</th>
                <th className="px-2.5 py-2 text-right">Balance</th>
                <th className="px-2.5 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {vm.invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2.5 py-4 text-center font-semibold text-muted">
                    No outstanding invoices
                  </td>
                </tr>
              ) : (
                vm.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-line last:border-0">
                    <td className="px-2.5 py-2 font-bold text-ink">{invoice.invoiceNumber ?? "-"}</td>
                    <td className="px-2.5 py-2 text-muted">
                      {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-2.5 py-2 text-right font-semibold text-ink">{money(invoice.grandTotalCents)}</td>
                    <td className="px-2.5 py-2 text-right font-extrabold text-ink">{money(invoice.balanceDueCents)}</td>
                    <td className="px-2.5 py-2">
                      <DashedPill tone={statusTone(invoice.paymentStatus)}>{statusLabel(invoice.paymentStatus)}</DashedPill>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-1 border-t border-dashed border-line pt-3 text-xs">
          <div className="flex justify-between">
            <span className="font-semibold text-muted">Total Invoiced</span>
            <span className="font-bold text-ink">{money(vm.totalInvoicedCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold text-muted">Total Paid</span>
            <span className="font-bold text-ink">{money(vm.totalPaidCents)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="font-extrabold text-ink">Total Outstanding</span>
            <span className="font-extrabold text-danger">{money(vm.totalOutstandingCents)}</span>
          </div>
        </div>
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
        entity="customer_statement"
        entityId={vm.customerId}
        documentLabel={`Statement for ${vm.customerName}`}
        customerId={vm.customerId}
      />
    </div>
  );
}

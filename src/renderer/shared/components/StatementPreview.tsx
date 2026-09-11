import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Loader2, Printer, Share2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { ShareModal } from "@renderer/shared/components/ShareModal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { formatDocumentDate } from "@shared/lib/date";
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

type StatementStatusFilter = "pending" | "paid" | "all";

/** Statement of Account for one customer — by default, every invoice they haven't fully paid off
 * yet, across every storefront, with running totals. Purely a read-only summary (no "mark paid"
 * actions here — that stays on the Invoices tab, this is just the shareable rollup). Mirrors
 * ReceiptPreview's Print/Download/Share trio.
 *
 * Client request: also needs to show paid/historical invoices and an optional date range — the
 * filter state itself is owned by InvoicesRoute.tsx (which already owns statementVm/openStatement),
 * passed down here as controlled props so a filter change can re-fetch through the same
 * openStatement this component doesn't otherwise need to know about. `filtering` is true while a
 * refetch triggered by a filter change is in flight — `vm` still shows the PREVIOUS result during
 * that instant rather than the whole modal blanking to a spinner. */
export function StatementPreview({
  vm,
  statusFilter,
  dateFrom,
  dateTo,
  onStatusFilterChange,
  onDateFromChange,
  onDateToChange,
  filtering
}: {
  vm: CustomerStatementViewModel;
  statusFilter: StatementStatusFilter;
  dateFrom: string;
  dateTo: string;
  onStatusFilterChange: (value: StatementStatusFilter) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  filtering: boolean;
}): React.JSX.Element {
  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (cents: number): string => `${vm.currency} ${(cents / 100).toFixed(2)}`;
  const availableCreditCents = vm.creditLimitCents !== null ? Math.max(0, vm.creditLimitCents - vm.totalOutstandingCents) : null;
  // Share always regenerates fresh from the cloud's own "what's still outstanding" query (see
  // SERVER's buildSharedStatement) — it has no way to carry a "Paid"/"All"/date-range choice yet.
  // Rather than let Share silently send something different from what's on screen, it's only
  // enabled for the exact filter state Share itself supports.
  const isShareableFilter = vm.filters.status === "pending" && !vm.filters.dateFrom && !vm.filters.dateTo;

  // Client request: a statement used to show only the running totals, not the payments that
  // actually produced them. Collapsed by default (a history view can list many invoices) — expand
  // one at a time to see its payment history.
  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState<Set<string>>(new Set());
  function toggleExpanded(invoiceId: string): void {
    setExpandedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) next.delete(invoiceId);
      else next.add(invoiceId);
      return next;
    });
  }

  async function handlePrint(): Promise<void> {
    setPrinting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await window.blueLedger.printer.printStatementDocument(vm.customerId, vm.filters);
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
      await window.blueLedger.printer.previewStatementPdf(vm.customerId, vm.filters);
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

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Show</span>
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as StatementStatusFilter)}
            className="mt-1.5 h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
          >
            <option value="pending">Pending only</option>
            <option value="paid">Paid only</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            className="mt-1.5 h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            className="mt-1.5 h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
        </label>
        {(dateFrom || dateTo) && (
          <Button
            type="button"
            onClick={() => {
              onDateFromChange("");
              onDateToChange("");
            }}
            className="h-9 border border-line bg-white px-3 text-[11px] text-ink shadow-none hover:bg-soft"
          >
            Clear dates
          </Button>
        )}
        {filtering && <Loader2 className="size-4 animate-spin text-muted" aria-hidden="true" />}
      </div>

      <div className="rounded-lg border border-dashed border-line bg-soft/40 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-ink">{vm.businessName}</p>
            {vm.physicalAddress && <p className="text-[11px] text-muted">{vm.physicalAddress}</p>}
            {vm.primaryPhone && <p className="text-[11px] text-muted">{vm.primaryPhone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Statement</p>
            <p className="text-[11px] font-semibold text-muted">{formatDocumentDate(vm.generatedAt)}</p>
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
                <th className="px-2.5 py-2 text-left">Payments</th>
              </tr>
            </thead>
            <tbody>
              {vm.invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2.5 py-4 text-center font-semibold text-muted">
                    {vm.filters.status === "pending" ? "No outstanding invoices" : "No invoices match this filter"}
                  </td>
                </tr>
              ) : (
                vm.invoices.map((invoice) => {
                  const expanded = expandedInvoiceIds.has(invoice.id);
                  return (
                    <Fragment key={invoice.id}>
                      <tr className="border-b border-line last:border-0">
                        <td className="px-2.5 py-2 font-bold text-ink">{invoice.invoiceNumber ?? "-"}</td>
                        <td className="px-2.5 py-2 text-muted">
                          {invoice.dueDate ? formatDocumentDate(invoice.dueDate) : "-"}
                        </td>
                        <td className="px-2.5 py-2 text-right font-semibold text-ink">{money(invoice.grandTotalCents)}</td>
                        <td className="px-2.5 py-2 text-right font-extrabold text-ink">{money(invoice.balanceDueCents)}</td>
                        <td className="px-2.5 py-2">
                          <DashedPill tone={statusTone(invoice.paymentStatus)}>{statusLabel(invoice.paymentStatus)}</DashedPill>
                        </td>
                        <td className="px-2.5 py-2">
                          {invoice.payments.length === 0 ? (
                            <span className="text-muted">-</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(invoice.id)}
                              className="inline-flex items-center gap-1 font-bold text-primary hover:underline cursor-pointer"
                            >
                              {expanded ? (
                                <ChevronDown className="size-3.5" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="size-3.5" aria-hidden="true" />
                              )}
                              {invoice.payments.length} payment{invoice.payments.length === 1 ? "" : "s"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded && invoice.payments.length > 0 && (
                        <tr className="border-b border-line bg-soft/60 last:border-0">
                          <td colSpan={6} className="px-2.5 py-2">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-[9px] font-extrabold uppercase tracking-wide text-muted">
                                  <th className="px-2 py-1 text-left">Date</th>
                                  <th className="px-2 py-1 text-right">Amount</th>
                                  <th className="px-2 py-1 text-left">Method</th>
                                  <th className="px-2 py-1 text-left">Reference</th>
                                  <th className="px-2 py-1 text-left">Recorded By</th>
                                </tr>
                              </thead>
                              <tbody>
                                {invoice.payments.map((payment) => (
                                  <tr key={payment.id} className="border-t border-line/60">
                                    <td className="px-2 py-1 text-muted">{formatDocumentDate(payment.occurredAt)}</td>
                                    <td className="px-2 py-1 text-right font-bold text-ink">{money(payment.amountCents)}</td>
                                    <td className="px-2 py-1 text-ink">{payment.paymentMethodName}</td>
                                    <td className="px-2 py-1 text-muted">{payment.reference ?? "-"}</td>
                                    <td className="px-2 py-1 text-muted">{payment.performedByName}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
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
          disabled={!isShareableFilter}
          title={
            isShareableFilter
              ? undefined
              : "Share sends the customer's current outstanding balance — switch back to \"Pending only\" with no date range to share."
          }
          className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
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

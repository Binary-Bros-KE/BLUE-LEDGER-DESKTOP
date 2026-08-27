import { useMemo, useState } from "react";
import { Eye, Loader2, Printer, Search } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast, showSuccessToast } from "@renderer/shared/lib/toast";
import { PURCHASE_PAYMENT_STATUS_OPTIONS, type PurchasePaymentStatus } from "@shared/types/purchase";
import type { Supplier } from "@shared/types/supplier";
import type { SupplierStatementViewModel } from "@shared/types/supplier-statement";

function statusTone(status: PurchasePaymentStatus): "success" | "warning" | "neutral" {
  if (status === "paid") return "success";
  if (status === "partially_paid") return "warning";
  return "neutral";
}

function statusLabel(status: PurchasePaymentStatus): string {
  return PURCHASE_PAYMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Statement of Account for one supplier — every purchase order we haven't fully paid off yet, across
 * every storefront, with running totals. Mirrors StatementPreview.tsx (Invoices' customer statement)
 * exactly, minus the Share button — this is DESKTOP-only, view/Print/PDF, no public-link/WhatsApp
 * capability (an internal AP document, not something routinely sent to the supplier). Combines what
 * InvoicesRoute.tsx splits into two separate inline `<Modal>` blocks (picker + preview) into one
 * self-contained component, matching PurchasesRoute.tsx's own convention of self-contained modal
 * components (PurchaseDetailModal, PurchaseFormModal) rather than inline JSX. */
export function SupplierStatementModal({
  open,
  onClose,
  suppliers
}: {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [vm, setVm] = useState<SupplierStatementViewModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [printing, setPrinting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filteredSuppliers = useMemo(() => {
    const active = suppliers.filter((supplier) => supplier.status === "active");
    const term = search.trim().toLowerCase();
    if (!term) return active.slice(0, 20);
    return active.filter((supplier) => `${supplier.businessName} ${supplier.phone1}`.toLowerCase().includes(term)).slice(0, 20);
  }, [suppliers, search]);

  function handleClose(): void {
    onClose();
    setSearch("");
    setVm(null);
    setLoadError(null);
    setNotice(null);
    setActionError(null);
  }

  async function openStatement(supplierId: string): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await window.blueLedger.supplierStatement.getForSupplier(supplierId);
      setVm(result);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to generate statement"));
    } finally {
      setLoading(false);
    }
  }

  const money = (cents: number): string => (vm ? `${vm.currency} ${(cents / 100).toFixed(2)}` : "");
  const availableCreditCents =
    vm && vm.creditLimitCents !== null ? Math.max(0, vm.creditLimitCents - vm.totalOutstandingCents) : null;

  async function handlePrint(): Promise<void> {
    if (!vm) return;
    setPrinting(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await window.blueLedger.printer.printSupplierStatementDocument(vm.supplierId);
      if (result.success) {
        setNotice(result.message);
        showSuccessToast(result.message);
      } else {
        setActionError(result.message);
        showErrorToast(result.message);
      }
    } catch (err) {
      const message = getErrorMessage(err, "Failed to print statement");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setPrinting(false);
    }
  }

  async function handlePreview(): Promise<void> {
    if (!vm) return;
    setPreviewing(true);
    setActionError(null);
    setNotice(null);
    try {
      await window.blueLedger.printer.previewSupplierStatementPdf(vm.supplierId);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to open preview");
      setActionError(message);
      showErrorToast(message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <>
      <Modal
        open={open && vm === null}
        onClose={handleClose}
        title="Generate Statement"
        description="Search for a supplier to see every purchase we haven't fully paid off yet."
        widthClassName="max-w-md"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search suppliers..."
            className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
        </div>
        {loadError && (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs font-bold text-danger">{loadError}</div>
        )}
        <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto">
          {loading ? (
            <div className="flex min-h-[120px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : filteredSuppliers.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs font-semibold text-muted">No suppliers found</p>
          ) : (
            filteredSuppliers.map((supplier) => (
              <button
                key={supplier.id}
                type="button"
                onClick={() => void openStatement(supplier.id)}
                className="flex w-full items-center justify-between rounded-lg border border-line px-3.5 py-2.5 text-left transition hover:bg-soft cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-ink">{supplier.businessName}</p>
                  <p className="text-[11px] font-semibold text-muted">{supplier.phone1}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={open && vm !== null}
        onClose={handleClose}
        title={vm ? `Statement — ${vm.supplierName}` : "Statement"}
        description="Print or download this supplier's outstanding balance."
        widthClassName="max-w-lg"
      >
        {vm && (
          <div>
            {notice && (
              <div className="mb-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold text-success">{notice}</div>
            )}
            {actionError && (
              <div className="mb-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-bold text-danger">{actionError}</div>
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
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-muted">Supplier</p>
                  <p className="mt-1 text-sm font-extrabold text-ink">{vm.supplierName}</p>
                  <p className="text-[11px] font-semibold text-muted">{vm.supplierPhone}</p>
                  {vm.supplierEmail && <p className="text-[11px] font-semibold text-muted">{vm.supplierEmail}</p>}
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
                      <th className="px-2.5 py-2 text-left">Purchase</th>
                      <th className="px-2.5 py-2 text-left">Ordered</th>
                      <th className="px-2.5 py-2 text-right">Total</th>
                      <th className="px-2.5 py-2 text-right">Balance</th>
                      <th className="px-2.5 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.purchases.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-2.5 py-4 text-center font-semibold text-muted">
                          No outstanding purchases
                        </td>
                      </tr>
                    ) : (
                      vm.purchases.map((purchase) => (
                        <tr key={purchase.id} className="border-b border-line last:border-0">
                          <td className="px-2.5 py-2 font-bold text-ink">{purchase.purchaseNumber}</td>
                          <td className="px-2.5 py-2 text-muted">
                            {purchase.orderedAt ? new Date(purchase.orderedAt).toLocaleDateString() : "-"}
                          </td>
                          <td className="px-2.5 py-2 text-right font-semibold text-ink">{money(purchase.grandTotalCents)}</td>
                          <td className="px-2.5 py-2 text-right font-extrabold text-ink">{money(purchase.balanceDueCents)}</td>
                          <td className="px-2.5 py-2">
                            <DashedPill tone={statusTone(purchase.paymentStatus)}>{statusLabel(purchase.paymentStatus)}</DashedPill>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 space-y-1 border-t border-dashed border-line pt-3 text-xs">
                <div className="flex justify-between">
                  <span className="font-semibold text-muted">Total Ordered</span>
                  <span className="font-bold text-ink">{money(vm.totalOrderedCents)}</span>
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

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => void handlePrint()}
                disabled={printing}
                className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {printing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" /> : <Printer className="mr-1.5 size-3.5" aria-hidden="true" />}
                Print
              </Button>
              <Button
                type="button"
                onClick={() => void handlePreview()}
                disabled={previewing}
                className="h-9 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" /> : <Eye className="mr-1.5 size-3.5" aria-hidden="true" />}
                Preview
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

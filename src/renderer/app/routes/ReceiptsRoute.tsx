import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Ban, Loader2, ReceiptText, Search, Undo2 } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Field, TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { ReceiptPreview } from "@renderer/shared/components/ReceiptPreview";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { cn } from "@renderer/shared/lib/cn";
import { formatCents } from "@renderer/shared/lib/money";
import { useAppStore } from "@renderer/shared/stores/app-store";
import type { Sale, SaleListItem } from "@shared/types/sale";
import type { SaleReturn } from "@shared/types/sale-return";
import type { SaleVoid } from "@shared/types/sale-void";

function Th({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return (
    <th className={cn("px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function ReceiptsRoute(): React.JSX.Element {
  const tenantContext = useAppStore((state) => state.context?.tenant ?? null);
  const { can } = usePermissions();
  const canRequest = can("sales", "edit");

  const [sales, setSales] = useState<SaleListItem[] | null>(null);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [voids, setVoids] = useState<SaleVoid[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [returnModalSale, setReturnModalSale] = useState<Sale | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState("");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);

  const [voidModalSale, setVoidModalSale] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidNotes, setVoidNotes] = useState("");
  const [voidSaving, setVoidSaving] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [saleList, returnList, voidList] = await Promise.all([
        window.blueLedger.sale.list(),
        window.blueLedger.saleReturn.list(),
        window.blueLedger.saleVoid.list()
      ]);
      setSales(saleList);
      setReturns(returnList);
      setVoids(voidList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load receipts"));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const saleStatusInfo = useMemo(() => {
    const map = new Map<string, { approvedVoid: boolean; pendingVoid: boolean; approvedReturn: boolean; pendingReturn: boolean }>();
    for (const voidRequest of voids) {
      const entry = map.get(voidRequest.saleId) ?? {
        approvedVoid: false,
        pendingVoid: false,
        approvedReturn: false,
        pendingReturn: false
      };
      if (voidRequest.status === "approved") entry.approvedVoid = true;
      if (voidRequest.status === "pending_approval") entry.pendingVoid = true;
      map.set(voidRequest.saleId, entry);
    }
    for (const returnRequest of returns) {
      const entry = map.get(returnRequest.saleId) ?? {
        approvedVoid: false,
        pendingVoid: false,
        approvedReturn: false,
        pendingReturn: false
      };
      if (returnRequest.status === "approved") entry.approvedReturn = true;
      if (returnRequest.status === "pending_approval") entry.pendingReturn = true;
      map.set(returnRequest.saleId, entry);
    }
    return map;
  }, [voids, returns]);

  const filteredSales = useMemo(() => {
    if (!sales) return null;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return sales;
    return sales.filter((sale) => {
      const haystack = `${sale.receiptNumber ?? ""} ${sale.customerName ?? ""} ${sale.employeeName}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [sales, searchTerm]);

  async function openReceipt(saleId: string): Promise<void> {
    setViewLoading(true);
    setActionError(null);
    try {
      const sale = await window.blueLedger.sale.get(saleId);
      setViewingSale(sale);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load receipt"));
    } finally {
      setViewLoading(false);
    }
  }

  function openReturnModal(sale: Sale): void {
    setReturnModalSale(sale);
    setReturnQuantities({});
    setReturnReason("");
    setReturnNotes("");
    setReturnError(null);
  }

  function openVoidModal(sale: Sale): void {
    setVoidModalSale(sale);
    setVoidReason("");
    setVoidNotes("");
    setVoidError(null);
  }

  function remainingReturnableQuantity(saleItemId: string, originalQuantity: number): number {
    let approvedReturned = 0;
    for (const returnRequest of returns) {
      if (returnRequest.status !== "approved") continue;
      for (const item of returnRequest.items) {
        if (item.saleItemId === saleItemId) approvedReturned += item.quantity;
      }
    }
    return originalQuantity - approvedReturned;
  }

  async function handleSubmitReturn(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!returnModalSale) return;
    setReturnSaving(true);
    setReturnError(null);

    const items = Object.entries(returnQuantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));

    if (items.length === 0) {
      setReturnError("Select at least one item to return");
      setReturnSaving(false);
      return;
    }

    try {
      await window.blueLedger.saleReturn.request({
        saleId: returnModalSale.id,
        reason: returnReason,
        notes: returnNotes,
        items
      });
      setReturnModalSale(null);
      await loadAll();
    } catch (err) {
      setReturnError(getErrorMessage(err, "Failed to submit return request"));
    } finally {
      setReturnSaving(false);
    }
  }

  async function handleSubmitVoid(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!voidModalSale) return;
    setVoidSaving(true);
    setVoidError(null);

    try {
      await window.blueLedger.saleVoid.request({
        saleId: voidModalSale.id,
        reason: voidReason,
        notes: voidNotes
      });
      setVoidModalSale(null);
      await loadAll();
    } catch (err) {
      setVoidError(getErrorMessage(err, "Failed to submit void request"));
    } finally {
      setVoidSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative mt-6 space-y-5 pb-10 pl-4"
    >
      <span
        className="pointer-events-none absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-2 left-0 top-2 border-l-2 border-dashed border-line"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute -left-[5px] bottom-2 size-2.5 rounded-full border-2 border-line bg-app"
        aria-hidden="true"
      />

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Receipts</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
              <ReceiptText className="size-5 text-primary" aria-hidden="true" />
              Transaction History
            </h2>
            <p className="mt-1 text-xs font-semibold text-muted">
              Every completed sale, latest first — reprint, download, or process a return or void.
            </p>
          </div>
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        {sales !== null && sales.length > 0 && (
          <div className="mt-4">
            <label className="block sm:max-w-xs">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Search</span>
              <div className="relative mt-1.5">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by receipt number, customer, or cashier"
                  className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-muted/60 focus:border-accent focus:ring-4 focus:ring-accent/15"
                />
              </div>
            </label>
          </div>
        )}

        <div className="mt-5">
          {loadError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-10 text-center">
              <Button type="button" onClick={() => void loadAll()} className="h-9 text-xs">
                Retry
              </Button>
            </div>
          ) : sales === null ? (
            <div className="flex min-h-[240px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : sales.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <ReceiptText className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">No completed sales yet</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Receipts will show up here once a sale is completed at checkout.
              </p>
            </div>
          ) : filteredSales && filteredSales.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-10 text-center">
              <Search className="size-7 text-muted" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-extrabold">No receipts match your search</h3>
              <Button type="button" onClick={() => setSearchTerm("")} className="mt-5 h-9 text-xs">
                Clear search
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[13%]" />
                  <col className="w-[15%]" />
                  <col className="w-[17%]" />
                  <col className="w-[15%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead>
                  <tr className="bg-primary text-white">
                    <Th>Receipt</Th>
                    <Th>Date</Th>
                    <Th>Customer</Th>
                    <Th>Cashier</Th>
                    <Th>Items</Th>
                    <Th>Total</Th>
                    <Th className="text-right">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredSales ?? []).map((sale) => {
                    const status = saleStatusInfo.get(sale.id);
                    return (
                      <tr
                        key={sale.id}
                        onClick={() => void openReceipt(sale.id)}
                        className="cursor-pointer border-t border-line odd:bg-white even:bg-soft/50 hover:bg-soft"
                      >
                        <td className="truncate px-4 py-3 text-xs font-bold tabular-nums text-muted">
                          {sale.receiptNumber ?? "—"}
                        </td>
                        <td className="truncate px-4 py-3 text-xs font-semibold text-muted">
                          {formatDate(sale.completedAt)}
                        </td>
                        <td className="truncate px-4 py-3 font-extrabold">{sale.customerName ?? "Walk-in"}</td>
                        <td className="truncate px-4 py-3 text-xs font-semibold text-muted">{sale.employeeName}</td>
                        <td className="px-4 py-3 text-xs font-bold tabular-nums text-muted">{sale.itemCount}</td>
                        <td className="px-4 py-3 text-xs font-bold tabular-nums text-ink">
                          {formatCents(sale.grandTotalCents)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {status?.approvedVoid && <DashedPill tone="danger">Voided</DashedPill>}
                            {status?.approvedReturn && <DashedPill tone="warning">Returned</DashedPill>}
                            {(status?.pendingVoid || status?.pendingReturn) && (
                              <DashedPill tone="accent">Pending Approval</DashedPill>
                            )}
                            {!status && <DashedPill tone="neutral">Completed</DashedPill>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={viewingSale !== null || viewLoading}
        onClose={() => setViewingSale(null)}
        title={viewingSale?.receiptNumber ?? "Receipt"}
        description="Reprint, download, or process a return / void for this sale."
        widthClassName="max-w-lg"
      >
        {viewLoading ? (
          <div className="flex min-h-[200px] items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : viewingSale ? (
          <div>
            {tenantContext && <ReceiptPreview sale={viewingSale} tenant={tenantContext} />}

            {canRequest && (
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                <Button
                  type="button"
                  onClick={() => {
                    const sale = viewingSale;
                    setViewingSale(null);
                    openReturnModal(sale);
                  }}
                  disabled={Boolean(saleStatusInfo.get(viewingSale.id)?.approvedVoid)}
                  className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Undo2 className="mr-1.5 size-3.5" aria-hidden="true" />
                  Request Return
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const sale = viewingSale;
                    setViewingSale(null);
                    openVoidModal(sale);
                  }}
                  disabled={
                    Boolean(saleStatusInfo.get(viewingSale.id)?.approvedVoid) ||
                    Boolean(saleStatusInfo.get(viewingSale.id)?.pendingVoid)
                  }
                  className="h-9 border border-danger/30 bg-white text-xs text-danger shadow-none hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Ban className="mr-1.5 size-3.5" aria-hidden="true" />
                  Void Sale
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={returnModalSale !== null}
        onClose={() => setReturnModalSale(null)}
        title="Request Return"
        description="Select the items and quantities being returned. A manager must approve before stock is restocked."
        widthClassName="max-w-lg"
      >
        {returnModalSale && (
          <form onSubmit={handleSubmitReturn}>
            {returnError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                {returnError}
              </div>
            )}

            <div className="space-y-2">
              {returnModalSale.items.map((item) => {
                const remaining = remainingReturnableQuantity(item.id, item.quantity);
                return (
                  <div key={item.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-ink">{item.productName}</p>
                        <p className="text-[11px] font-semibold text-muted">
                          Sold {item.quantity} · {remaining} eligible for return
                        </p>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        disabled={remaining <= 0}
                        value={returnQuantities[item.id] ?? 0}
                        onChange={(event) =>
                          setReturnQuantities((prev) => ({
                            ...prev,
                            [item.id]: Math.max(0, Math.min(remaining, Number(event.target.value)))
                          }))
                        }
                        className="h-9 w-20 rounded-lg border border-line px-2 text-center text-sm font-bold outline-none focus:border-accent disabled:cursor-not-allowed disabled:bg-soft"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <Field
              label="Reason"
              value={returnReason}
              onChange={setReturnReason}
              placeholder="e.g. Customer changed their mind"
              required
              className="mt-4"
            />
            <TextAreaField
              label="Notes"
              value={returnNotes}
              onChange={setReturnNotes}
              placeholder="Optional additional detail"
              className="mt-4"
              rows={2}
            />

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
              <Button
                type="button"
                onClick={() => setReturnModalSale(null)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={returnSaving}
                className="h-9 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {returnSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {returnSaving ? "Submitting..." : "Submit Return Request"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={voidModalSale !== null}
        onClose={() => setVoidModalSale(null)}
        title="Void Sale"
        description="This invalidates the entire sale and restocks every item. A manager must approve it first."
        widthClassName="max-w-md"
      >
        {voidModalSale && (
          <form onSubmit={handleSubmitVoid}>
            {voidError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                {voidError}
              </div>
            )}

            <div className="rounded-lg border border-line bg-soft px-3.5 py-2.5">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Voiding</p>
              <p className="mt-0.5 text-sm font-bold text-ink">
                {voidModalSale.receiptNumber} · {formatCents(voidModalSale.grandTotalCents)}
              </p>
            </div>

            <Field
              label="Reason"
              value={voidReason}
              onChange={setVoidReason}
              placeholder="e.g. Rang up the wrong sale"
              required
              className="mt-4"
            />
            <TextAreaField
              label="Notes"
              value={voidNotes}
              onChange={setVoidNotes}
              placeholder="Optional additional detail"
              className="mt-4"
              rows={2}
            />

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
              <Button
                type="button"
                onClick={() => setVoidModalSale(null)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={voidSaving}
                className="h-9 border border-danger bg-danger text-xs text-white shadow-none hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {voidSaving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {voidSaving ? "Submitting..." : "Submit Void Request"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </motion.div>
  );
}

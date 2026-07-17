import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Ban, CheckCircle2, ClipboardCheck, Eye, Loader2, Undo2, XCircle } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { TextAreaField } from "@renderer/shared/components/form-fields";
import { Modal } from "@renderer/shared/components/Modal";
import { ReceiptPreview } from "@renderer/shared/components/ReceiptPreview";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { useAppStore } from "@renderer/shared/stores/app-store";
import type { Sale } from "@shared/types/sale";
import type { SaleReturn } from "@shared/types/sale-return";
import type { SaleVoid } from "@shared/types/sale-void";

type ApprovalEntry =
  | { kind: "return"; id: string; data: SaleReturn }
  | { kind: "void"; id: string; data: SaleVoid };

type DecisionAction = "approve" | "reject";

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function entryAmountCents(entry: ApprovalEntry): number {
  if (entry.kind === "void") return entry.data.saleGrandTotalCents;
  return entry.data.items.reduce((sum, item) => sum + item.lineTotalCents, 0);
}

export function ApprovalsRoute(): React.JSX.Element {
  const tenantContext = useAppStore((state) => state.context?.tenant ?? null);

  const [returns, setReturns] = useState<SaleReturn[] | null>(null);
  const [voids, setVoids] = useState<SaleVoid[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [viewingEntry, setViewingEntry] = useState<ApprovalEntry | null>(null);
  const [viewingSale, setViewingSale] = useState<Sale | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [decisionEntry, setDecisionEntry] = useState<{ entry: ApprovalEntry; action: DecisionAction } | null>(
    null
  );
  const [decisionNotes, setDecisionNotes] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [returnList, voidList] = await Promise.all([
        window.blueLedger.saleReturn.list(),
        window.blueLedger.saleVoid.list()
      ]);
      setReturns(returnList);
      setVoids(voidList);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load approvals"));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const pendingEntries = useMemo<ApprovalEntry[]>(() => {
    const entries: ApprovalEntry[] = [
      ...(returns ?? [])
        .filter((item) => item.status === "pending_approval")
        .map((item): ApprovalEntry => ({ kind: "return", id: item.id, data: item })),
      ...(voids ?? [])
        .filter((item) => item.status === "pending_approval")
        .map((item): ApprovalEntry => ({ kind: "void", id: item.id, data: item }))
    ];
    return entries.sort(
      (a, b) => new Date(b.data.requestedAt).getTime() - new Date(a.data.requestedAt).getTime()
    );
  }, [returns, voids]);

  const decidedEntries = useMemo<ApprovalEntry[]>(() => {
    const entries: ApprovalEntry[] = [
      ...(returns ?? [])
        .filter((item) => item.status !== "pending_approval")
        .map((item): ApprovalEntry => ({ kind: "return", id: item.id, data: item })),
      ...(voids ?? [])
        .filter((item) => item.status !== "pending_approval")
        .map((item): ApprovalEntry => ({ kind: "void", id: item.id, data: item }))
    ];
    return entries
      .sort((a, b) => new Date(b.data.approvedAt ?? 0).getTime() - new Date(a.data.approvedAt ?? 0).getTime())
      .slice(0, 20);
  }, [returns, voids]);

  function openDecision(entry: ApprovalEntry, action: DecisionAction): void {
    setDecisionEntry({ entry, action });
    setDecisionNotes("");
    setDecisionError(null);
  }

  async function submitDecision(): Promise<void> {
    if (!decisionEntry) return;
    setDeciding(true);
    setDecisionError(null);
    setActionError(null);

    const { entry, action } = decisionEntry;
    const payload = { notes: decisionNotes };

    try {
      if (entry.kind === "return") {
        if (action === "approve") await window.blueLedger.saleReturn.approve(entry.id, payload);
        else await window.blueLedger.saleReturn.reject(entry.id, payload);
      } else {
        if (action === "approve") await window.blueLedger.saleVoid.approve(entry.id, payload);
        else await window.blueLedger.saleVoid.reject(entry.id, payload);
      }
      setDecisionEntry(null);
      closeView();
      await loadAll();
    } catch (err) {
      setDecisionError(getErrorMessage(err, "Failed to record decision"));
    } finally {
      setDeciding(false);
    }
  }

  async function openView(entry: ApprovalEntry): Promise<void> {
    setViewingEntry(entry);
    setViewingSale(null);
    setViewLoading(true);
    setActionError(null);
    try {
      const sale = await window.blueLedger.sale.get(entry.data.saleId);
      setViewingSale(sale);
    } catch (err) {
      setActionError(getErrorMessage(err, "Failed to load receipt"));
      setViewingEntry(null);
    } finally {
      setViewLoading(false);
    }
  }

  function closeView(): void {
    setViewingEntry(null);
    setViewingSale(null);
  }

  const loading = returns === null || voids === null;

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
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal">Approvals</p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-extrabold">
            <ClipboardCheck className="size-5 text-primary" aria-hidden="true" />
            Returns &amp; Voids
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted">
            Nothing changes on a sale or in inventory until a request here is approved.
          </p>
        </div>

        {(loadError ?? actionError) && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
            {loadError ?? actionError}
          </div>
        )}

        <div className="mt-5">
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center text-muted">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            </div>
          ) : pendingEntries.length === 0 ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 p-8 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-soft text-primary">
                <ClipboardCheck className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-extrabold">Nothing awaiting approval</h3>
              <p className="mt-1 max-w-sm text-sm font-semibold text-muted">
                Return and void requests from the Receipts screen will show up here.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingEntries.map((entry) => (
                <div key={`${entry.kind}-${entry.id}`} className="rounded-lg border border-line p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <DashedPill tone={entry.kind === "void" ? "danger" : "warning"}>
                          {entry.kind === "void" ? "Void Request" : "Return Request"}
                        </DashedPill>
                        <span className="text-xs font-bold tabular-nums text-muted">
                          {entry.data.receiptNumber ?? "—"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-extrabold text-ink">{entry.data.reason}</p>
                      {entry.kind === "return" && (
                        <ul className="mt-1 space-y-0.5 text-[11px] font-semibold text-muted">
                          {entry.data.items.map((item) => (
                            <li key={item.id}>
                              {item.quantity} x {item.productName}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1.5 text-[11px] font-semibold text-muted">
                        Requested by {entry.data.requestedByName} · {formatDate(entry.data.requestedAt)}
                      </p>
                    </div>
                    <div className="flex flex-none flex-col items-end gap-2">
                      <span className="text-sm font-extrabold tabular-nums text-ink">
                        {formatCents(entryAmountCents(entry))}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          onClick={() => void openView(entry)}
                          className="h-8 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft"
                        >
                          <Eye className="mr-1 size-3.5" aria-hidden="true" />
                          View
                        </Button>
                        <Button
                          type="button"
                          onClick={() => openDecision(entry, "reject")}
                          className="h-8 border border-line bg-white text-[11px] text-ink shadow-none hover:bg-soft"
                        >
                          <XCircle className="mr-1 size-3.5" aria-hidden="true" />
                          Reject
                        </Button>
                        <Button
                          type="button"
                          onClick={() => openDecision(entry, "approve")}
                          className="h-8 bg-success text-[11px] hover:brightness-110"
                        >
                          <CheckCircle2 className="mr-1 size-3.5" aria-hidden="true" />
                          Approve
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {decidedEntries.length > 0 && (
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h3 className="text-sm font-extrabold text-ink">Recent Decisions</h3>
          <div className="mt-3 space-y-2">
            {decidedEntries.map((entry) => (
              <div
                key={`${entry.kind}-${entry.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3.5 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {entry.kind === "void" ? (
                    <Ban className="size-3.5 flex-none text-muted" aria-hidden="true" />
                  ) : (
                    <Undo2 className="size-3.5 flex-none text-muted" aria-hidden="true" />
                  )}
                  <p className="truncate text-xs font-bold text-ink">
                    {entry.data.receiptNumber ?? "—"} · {entry.data.reason}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <DashedPill tone={entry.data.status === "approved" ? "success" : "neutral"}>
                    {entry.data.status === "approved" ? "Approved" : "Rejected"}
                  </DashedPill>
                  <span className="text-[11px] font-semibold text-muted">{entry.data.approvedByName ?? "—"}</span>
                  <button
                    type="button"
                    onClick={() => void openView(entry)}
                    aria-label="View receipt"
                    className="grid size-7 place-items-center rounded-md text-muted transition hover:bg-soft hover:text-ink cursor-pointer"
                  >
                    <Eye className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal
        open={viewingEntry !== null}
        onClose={closeView}
        title={viewingEntry?.data.receiptNumber ?? "Receipt"}
        description="Everything about this sale — review it before deciding."
        widthClassName="max-w-lg"
      >
        {viewingEntry && (
          <div>
            {viewLoading ? (
              <div className="flex min-h-[200px] items-center justify-center text-muted">
                <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              </div>
            ) : viewingSale ? (
              <div>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <DashedPill tone={viewingEntry.kind === "void" ? "danger" : "warning"}>
                    {viewingEntry.kind === "void" ? "Void Request" : "Return Request"}
                  </DashedPill>
                  <DashedPill
                    tone={
                      viewingEntry.data.status === "approved"
                        ? "success"
                        : viewingEntry.data.status === "rejected"
                          ? "neutral"
                          : "accent"
                    }
                  >
                    {viewingEntry.data.status === "pending_approval"
                      ? "Pending Approval"
                      : viewingEntry.data.status === "approved"
                        ? "Approved"
                        : "Rejected"}
                  </DashedPill>
                </div>

                <div className="mb-4 rounded-lg border border-line bg-soft px-3.5 py-2.5">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Reason</p>
                  <p className="mt-0.5 text-sm font-bold text-ink">{viewingEntry.data.reason}</p>
                  <p className="mt-1.5 text-[11px] font-semibold text-muted">
                    Requested by {viewingEntry.data.requestedByName} · {formatDate(viewingEntry.data.requestedAt)}
                  </p>
                  {viewingEntry.data.notes && (
                    <p className="mt-1.5 whitespace-pre-line text-[11px] font-semibold text-muted">
                      {viewingEntry.data.notes}
                    </p>
                  )}
                </div>

                {tenantContext && <ReceiptPreview sale={viewingSale} tenant={tenantContext} />}

                {viewingEntry.data.status === "pending_approval" && (
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                    <Button
                      type="button"
                      onClick={() => {
                        const entry = viewingEntry;
                        closeView();
                        openDecision(entry, "reject");
                      }}
                      className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
                    >
                      <XCircle className="mr-1.5 size-3.5" aria-hidden="true" />
                      Reject
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        const entry = viewingEntry;
                        closeView();
                        openDecision(entry, "approve");
                      }}
                      className="h-9 bg-success text-xs hover:brightness-110"
                    >
                      <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Modal
        open={decisionEntry !== null}
        onClose={() => setDecisionEntry(null)}
        title={decisionEntry?.action === "approve" ? "Approve Request" : "Reject Request"}
        widthClassName="max-w-sm"
      >
        {decisionEntry && (
          <div>
            {decisionError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
                {decisionError}
              </div>
            )}
            <p className="text-sm font-semibold text-muted">
              {decisionEntry.action === "approve"
                ? decisionEntry.entry.kind === "void"
                  ? "This will void the sale and restock every item."
                  : "This will restock the selected items. Approving assumes the customer has already been refunded in cash — the reports will reduce this sale's revenue accordingly, whether or not a refund actually happened."
                : "This request will be marked rejected — nothing changes."}
            </p>
            <TextAreaField
              label="Notes (optional)"
              value={decisionNotes}
              onChange={setDecisionNotes}
              className="mt-4"
              rows={2}
            />
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-5">
              <Button
                type="button"
                onClick={() => setDecisionEntry(null)}
                className="h-9 border border-line bg-white text-xs text-ink shadow-none hover:bg-soft"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void submitDecision()}
                disabled={deciding}
                className={
                  decisionEntry.action === "approve"
                    ? "h-9 bg-success text-xs hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    : "h-9 bg-danger text-xs hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                {deciding ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
                {deciding ? "Saving..." : decisionEntry.action === "approve" ? "Confirm Approve" : "Confirm Reject"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  );
}

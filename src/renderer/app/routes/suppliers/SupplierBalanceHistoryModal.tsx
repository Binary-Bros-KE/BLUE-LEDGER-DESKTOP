import { format } from "date-fns";
import { useEffect, useState } from "react";
import { Loader2, ReceiptText } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { SUPPLIER_BALANCE_ENTRY_TYPE_OPTIONS, type SupplierBalanceEntry } from "@shared/types/supplier-balance";
import type { Supplier } from "@shared/types/supplier";

function formatDate(value: string | null, pattern = "MMM d, yyyy · HH:mm"): string {
  if (!value) return "—";
  try {
    return format(new Date(value), pattern);
  } catch {
    return value;
  }
}

function balanceEntryTypeLabel(value: string): string {
  return SUPPLIER_BALANCE_ENTRY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** Its own modal, split out of SupplierDetailModal's cramped `max-h-72` scroll box — a client with a
 * long, active supplier (frequent purchases/payments/adjustments) had no real way to scan their
 * history without it fighting the rest of the Quick View for space. Same data (`supplier.balanceHistory`
 * IPC call), just given a whole modal's own tall scroll area instead of a small section within one. */
export function SupplierBalanceHistoryModal({
  supplier,
  onClose
}: {
  supplier: Supplier;
  onClose: () => void;
}): React.JSX.Element {
  const [balanceHistory, setBalanceHistory] = useState<SupplierBalanceEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBalanceHistory(null);
    setHistoryError(null);
    void window.blueLedger.supplier
      .balanceHistory(supplier.id)
      .then((entries) => {
        if (!cancelled) setBalanceHistory(entries);
      })
      .catch((err) => {
        if (!cancelled) setHistoryError(getErrorMessage(err, "Failed to load balance history"));
      });
    return () => {
      cancelled = true;
    };
  }, [supplier.id]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`${supplier.businessName} — Balance History`}
      description="Every purchase, payment, and manual adjustment that moved what you owe this supplier — most recent first."
      widthClassName="max-w-2xl"
    >
      <div className="mb-4 flex items-center justify-between rounded-lg border border-line bg-soft px-4 py-3">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Current Balance Owed</span>
        <span className="text-lg font-extrabold tabular-nums text-ink">{formatCents(supplier.balanceCents)}</span>
      </div>

      {historyError ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs font-bold text-danger">
          {historyError}
        </div>
      ) : balanceHistory === null ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-line bg-soft">
          <Loader2 className="size-6 animate-spin text-muted" aria-hidden="true" />
        </div>
      ) : balanceHistory.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 px-4 py-6 text-center">
          <div className="grid size-10 place-items-center rounded-2xl bg-soft text-primary">
            <ReceiptText className="size-4.5" aria-hidden="true" />
          </div>
          <p className="mt-2 text-xs font-semibold text-muted">No balance activity recorded for this supplier yet.</p>
        </div>
      ) : (
        <div className="max-h-[65vh] space-y-1.5 overflow-y-auto pr-1">
          {balanceHistory.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-soft px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <DashedPill tone={entry.entryType === "manual_adjustment" ? "accent" : "neutral"}>
                    {balanceEntryTypeLabel(entry.entryType)}
                  </DashedPill>
                </div>
                <p className="mt-1 text-[10px] font-semibold text-muted">
                  {formatDate(entry.createdAt)}
                  {entry.performedByName ? ` · ${entry.performedByName}` : ""}
                </p>
                {entry.notes && <p className="mt-0.5 truncate text-xs font-semibold text-ink">{entry.notes}</p>}
              </div>
              <span
                className={`flex-none text-sm font-extrabold tabular-nums ${
                  entry.amountCents >= 0 ? "text-danger" : "text-success"
                }`}
              >
                {entry.amountCents >= 0 ? "+" : "-"}
                {formatCents(Math.abs(entry.amountCents))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

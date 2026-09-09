import { format } from "date-fns";
import { useEffect, useState } from "react";
import { FileText, Loader2, ReceiptText } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { SUPPLIER_BALANCE_ENTRY_TYPE_OPTIONS, type SupplierBalanceEntry } from "@shared/types/supplier-balance";
import { SUPPLIER_PAYMENT_OPTION_OPTIONS, type Supplier } from "@shared/types/supplier";

function formatDate(value: string | null, pattern = "MMM d, yyyy · HH:mm"): string {
  if (!value) return "—";
  try {
    return format(new Date(value), pattern);
  } catch {
    return value;
  }
}

function paymentOptionLabel(value: string): string {
  return SUPPLIER_PAYMENT_OPTION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function balanceEntryTypeLabel(value: string): string {
  return SUPPLIER_BALANCE_ENTRY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-soft px-3 py-2.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-ink">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">{title}</p>
      <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">{children}</div>
    </div>
  );
}

export function SupplierDetailModal({
  supplier,
  onClose
}: {
  supplier: Supplier;
  onClose: () => void;
}): React.JSX.Element {
  const showMpesa = supplier.paymentOption === "mpesa";
  const showBank = supplier.paymentOption === "bank_transfer";

  // Client-reported gap: a manual balance adjustment (or a purchase/payment — every one of these
  // writes the same append-only ledger, see supplier-balance-service.ts's own doc comment) had no
  // way to be reviewed afterward — recordSupplierBalanceEntry's own history was already fully built
  // and synced, just never surfaced anywhere in the UI until now.
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
      title={supplier.businessName}
      description={`Supplier Code ${supplier.supplierCode}`}
      widthClassName="max-w-2xl"
    >
      <div className="flex flex-wrap items-center gap-2">
        <DashedPill tone={supplier.status === "active" ? "success" : "neutral"}>{supplier.status}</DashedPill>
        <DashedPill tone="accent">{paymentOptionLabel(supplier.paymentOption)}</DashedPill>
      </div>

      <div className="mt-5 space-y-5">
        <Section title="Business Information">
          <InfoRow label="Business Name" value={supplier.businessName} />
          <InfoRow label="Supplier Code" value={supplier.supplierCode} />
          <InfoRow label="Contact Person" value={supplier.contactPerson ?? "—"} />
        </Section>

        <Section title="Contact Information">
          <InfoRow label="Phone 1" value={supplier.phone1} />
          <InfoRow label="Phone 2" value={supplier.phone2 ?? "—"} />
          <InfoRow label="Email" value={supplier.email ?? "—"} />
          <InfoRow label="KRA PIN" value={supplier.kraPin ?? "—"} />
          <InfoRow label="Website" value={supplier.website ?? "—"} />
        </Section>

        <Section title="Address">
          <InfoRow label="Country" value={supplier.country ?? "—"} />
          <InfoRow label="County" value={supplier.county ?? "—"} />
          <InfoRow label="Town" value={supplier.town ?? "—"} />
          <InfoRow label="Physical Address" value={supplier.physicalAddress ?? "—"} />
        </Section>

        <Section title="Payment Details">
          <InfoRow label="Payment Option" value={paymentOptionLabel(supplier.paymentOption)} />
          {showMpesa && (
            <>
              <InfoRow label="M-Pesa Name" value={supplier.mpesaName ?? "—"} />
              <InfoRow label="M-Pesa Number" value={supplier.mpesaNumber ?? "—"} />
              <InfoRow label="M-Pesa Alternative Number" value={supplier.mpesaAlternativeNumber ?? "—"} />
            </>
          )}
          {showBank && (
            <>
              <InfoRow label="Bank Name" value={supplier.bankName ?? "—"} />
              <InfoRow label="Bank Account Name" value={supplier.bankAccountName ?? "—"} />
              <InfoRow label="Bank Account Number" value={supplier.bankAccountNumber ?? "—"} />
            </>
          )}
        </Section>

        <Section title="Credit Information">
          <InfoRow label="Balance Owed" value={formatCents(supplier.balanceCents)} />
          <InfoRow label="Credit Limit" value={formatCents(supplier.creditLimitCents)} />
        </Section>

        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Balance History</p>
          <p className="mt-0.5 text-[11px] font-semibold text-muted">
            Every purchase, payment, and manual adjustment that moved what you owe this supplier — most recent
            first.
          </p>
          {historyError ? (
            <div className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs font-bold text-danger">
              {historyError}
            </div>
          ) : balanceHistory === null ? (
            <div className="mt-2 flex min-h-[80px] items-center justify-center rounded-lg border border-line bg-soft">
              <Loader2 className="size-5 animate-spin text-muted" aria-hidden="true" />
            </div>
          ) : balanceHistory.length === 0 ? (
            <div className="mt-2 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 px-4 py-6 text-center">
              <div className="grid size-10 place-items-center rounded-2xl bg-soft text-primary">
                <ReceiptText className="size-4.5" aria-hidden="true" />
              </div>
              <p className="mt-2 text-xs font-semibold text-muted">
                No balance activity recorded for this supplier yet.
              </p>
            </div>
          ) : (
            <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
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
        </div>

        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Notes</p>
          {supplier.notes ? (
            <div className="mt-2 rounded-lg border border-line bg-soft px-3 py-2.5 text-sm font-semibold text-ink">
              {supplier.notes}
            </div>
          ) : (
            <div className="mt-2 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 px-4 py-6 text-center">
              <div className="grid size-10 place-items-center rounded-2xl bg-soft text-primary">
                <FileText className="size-4.5" aria-hidden="true" />
              </div>
              <p className="mt-2 text-xs font-semibold text-muted">No notes recorded for this supplier.</p>
            </div>
          )}
        </div>

        <Section title="Record Info">
          <InfoRow label="Created" value={formatDate(supplier.createdAt)} />
          <InfoRow label="Last Updated" value={formatDate(supplier.updatedAt)} />
          <InfoRow label="Sync Status" value={supplier.syncStatus} />
        </Section>
      </div>
    </Modal>
  );
}

import { format } from "date-fns";
import { useEffect, useState } from "react";
import { FileText, Wallet } from "lucide-react";
import { Button } from "@renderer/shared/components/Button";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { formatCents } from "@renderer/shared/lib/money";
import { SUPPLIER_PAYMENT_OPTION_OPTIONS, type Supplier } from "@shared/types/supplier";
import { SUPPLIER_BALANCE_ENTRY_TYPE_OPTIONS, type SupplierBalanceEntry } from "@shared/types/supplier-balance";
import { SupplierBalanceAdjustmentModal } from "./SupplierBalanceAdjustmentModal";

function entryTypeLabel(value: string): string {
  return SUPPLIER_BALANCE_ENTRY_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

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
  supplier: initialSupplier,
  onClose,
  onSupplierUpdated
}: {
  supplier: Supplier;
  onClose: () => void;
  /** Lets the parent list keep its own row in sync too — this modal manages its own balance state
   * for immediate feedback, but SuppliersRoute's table would otherwise show a stale balance until
   * its next full reload. */
  onSupplierUpdated?: (updated: Supplier) => void;
}): React.JSX.Element {
  const { can } = usePermissions();
  const canEdit = can("suppliers", "edit");
  const [supplier, setSupplier] = useState(initialSupplier);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [history, setHistory] = useState<SupplierBalanceEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.blueLedger.supplier
      .balanceHistory(supplier.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
    // Only re-fetch when the balance itself changes (after an adjustment) — supplier.id never
    // changes for a given open modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id, supplier.balanceCents]);

  const showMpesa = supplier.paymentOption === "mpesa";
  const showBank = supplier.paymentOption === "bank_transfer";

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
          <InfoRow label="Credit Limit" value={formatCents(supplier.creditLimitCents)} />
        </Section>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Balance</p>
            {canEdit && (
              <Button
                type="button"
                onClick={() => setShowAdjustModal(true)}
                className="h-7 border border-line bg-white px-2.5 text-[11px] text-ink shadow-none hover:bg-soft"
              >
                <Wallet className="mr-1.5 size-3.5" aria-hidden="true" />
                Record Balance Adjustment
              </Button>
            )}
          </div>
          <div className="mt-2 rounded-lg border border-line bg-soft px-3 py-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Owed to this supplier</p>
            <p className={`mt-0.5 text-lg font-extrabold ${supplier.balanceCents > 0 ? "text-danger" : "text-ink"}`}>
              {formatCents(supplier.balanceCents)}
            </p>
          </div>

          {history && history.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">Recent Activity</p>
              {history.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-ink">{entryTypeLabel(entry.entryType)}</p>
                    <p className="truncate text-[11px] font-semibold text-muted">
                      {formatDate(entry.createdAt)}
                      {entry.notes ? ` · ${entry.notes}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 font-extrabold tabular-nums ${entry.amountCents > 0 ? "text-danger" : "text-success"}`}>
                    {entry.amountCents > 0 ? "+" : ""}
                    {formatCents(entry.amountCents)}
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

      {showAdjustModal && (
        <SupplierBalanceAdjustmentModal
          supplier={supplier}
          onClose={() => setShowAdjustModal(false)}
          onSaved={(updatedBalanceCents) => {
            const updated = { ...supplier, balanceCents: updatedBalanceCents };
            setSupplier(updated);
            onSupplierUpdated?.(updated);
          }}
        />
      )}
    </Modal>
  );
}

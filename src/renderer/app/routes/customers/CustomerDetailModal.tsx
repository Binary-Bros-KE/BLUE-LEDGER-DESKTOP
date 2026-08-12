import { useEffect, useState } from "react";
import { format } from "date-fns";
import { History, Loader2 } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { cn } from "@renderer/shared/lib/cn";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { formatCents } from "@renderer/shared/lib/money";
import { showErrorToast } from "@renderer/shared/lib/toast";
import { CUSTOMER_TYPE_OPTIONS, type Customer } from "@shared/types/customer";
import type { CustomerPurchaseHistoryEntry } from "@shared/types/customer-report";

const KIND_LABEL: Record<string, string> = {
  retail_sale: "Retail Sale",
  wholesale_sale: "Wholesale Sale",
  invoice: "Invoice"
};

function formatDate(value: string | null, pattern = "MMM d, yyyy · HH:mm"): string {
  if (!value) return "—";
  try {
    return format(new Date(value), pattern);
  } catch {
    return value;
  }
}

function customerTypeLabel(value: string): string {
  return CUSTOMER_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
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

export function CustomerDetailModal({
  customer,
  onClose
}: {
  customer: Customer;
  onClose: () => void;
}): React.JSX.Element {
  const [history, setHistory] = useState<CustomerPurchaseHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.blueLedger.report.customerPurchaseHistory({ customerId: customer.id });
        if (!cancelled) setHistory(result);
      } catch (err) {
        if (!cancelled) {
          const message = getErrorMessage(err, "Failed to load purchase history");
          setError(message);
          showErrorToast(message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer.id]);

  return (
    <Modal
      open
      onClose={onClose}
      title={customer.name}
      description={`Customer Code ${customer.customerCode}`}
      widthClassName="max-w-2xl"
    >
      <div className="flex flex-wrap items-center gap-2">
        <DashedPill tone={customer.status === "active" ? "success" : "neutral"}>
          {customer.status}
        </DashedPill>
        <DashedPill tone="accent">{customerTypeLabel(customer.customerType)}</DashedPill>
      </div>

      <div className="mt-5 space-y-5">
        <Section title="Contact Information">
          <InfoRow label="Phone" value={customer.phone} />
          <InfoRow label="Email" value={customer.email ?? "—"} />
          <InfoRow label="KRA PIN" value={customer.kraPin ?? "—"} />
          <InfoRow label="Physical Address" value={customer.physicalAddress ?? "—"} />
        </Section>

        <Section title="Account">
          <InfoRow label="Credit Limit" value={formatCents(customer.creditLimitCents)} />
          <InfoRow label="Current Balance" value={formatCents(customer.currentBalanceCents)} />
          <InfoRow label="Notes" value={customer.notes ?? "—"} />
        </Section>

        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
            Purchase History
          </p>
          {error ? (
            <div className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
              {error}
            </div>
          ) : history === null ? (
            <div className="mt-2 flex min-h-[100px] items-center justify-center text-muted">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            </div>
          ) : history.length === 0 ? (
            <div className="mt-2 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 px-4 py-8 text-center">
              <div className="grid size-11 place-items-center rounded-2xl bg-soft text-primary">
                <History className="size-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-bold text-ink">No purchase history yet</p>
              <p className="mt-1 max-w-xs text-xs font-semibold text-muted">
                Transactions will appear here once this customer starts making purchases through Sales.
              </p>
            </div>
          ) : (
            <div className="mt-2 max-h-[280px] overflow-y-auto rounded-lg border border-line">
              <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-primary text-white">
                    <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Date</th>
                    <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Document</th>
                    <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2 text-right text-[10px] font-extrabold uppercase tracking-wider">Total</th>
                    <th className="px-3 py-2 text-left text-[10px] font-extrabold uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.saleId} className="border-t border-line odd:bg-white even:bg-soft/50">
                      <td className="px-3 py-2 text-xs font-semibold text-muted">{formatDate(entry.occurredAt, "MMM d, yyyy")}</td>
                      <td className="truncate px-3 py-2 font-bold text-ink">{entry.documentNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-xs font-semibold text-muted">{KIND_LABEL[entry.kind] ?? entry.kind}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-ink">{formatCents(entry.grandTotalCents)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                            entry.amountPaidCents >= entry.grandTotalCents ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                          )}
                        >
                          {entry.amountPaidCents >= entry.grandTotalCents ? "Paid" : "Partially Paid"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Section title="Record Info">
          <InfoRow label="Created" value={formatDate(customer.createdAt)} />
          <InfoRow label="Last Updated" value={formatDate(customer.updatedAt)} />
          <InfoRow label="Sync Status" value={customer.syncStatus} />
        </Section>
      </div>
    </Modal>
  );
}

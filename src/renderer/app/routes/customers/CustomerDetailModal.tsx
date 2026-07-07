import { format } from "date-fns";
import { History } from "lucide-react";
import { DashedPill } from "@renderer/shared/components/DashedPill";
import { Modal } from "@renderer/shared/components/Modal";
import { formatCents } from "@renderer/shared/lib/money";
import { CUSTOMER_TYPE_OPTIONS, type Customer } from "@shared/types/customer";

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
          <div className="mt-2 flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 px-4 py-8 text-center">
            <div className="grid size-11 place-items-center rounded-2xl bg-soft text-primary">
              <History className="size-5" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm font-bold text-ink">No purchase history yet</p>
            <p className="mt-1 max-w-xs text-xs font-semibold text-muted">
              Transactions will appear here once this customer starts making purchases through Sales.
            </p>
          </div>
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

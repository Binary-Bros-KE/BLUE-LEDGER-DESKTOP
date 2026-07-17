import { formatCents } from "@renderer/shared/lib/money";
import type { SalesLedgerParty } from "@shared/types/report";
import { OverviewCard } from "./FinancialOverviewCards";

function money(cents: number): string {
  return formatCents(cents);
}

function PartyList({
  parties,
  emptyMessage,
}: {
  parties: SalesLedgerParty[];
  emptyMessage: string;
}): React.JSX.Element {
  if (parties.length === 0) {
    return (
      <div className="flex min-h-[100px] items-center justify-center rounded-lg border border-dashed border-line bg-soft/60 text-sm font-semibold text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="max-h-[280px] overflow-y-auto rounded-lg border border-line">
      <table className="w-full table-fixed border-collapse text-sm">
        <tbody>
          {parties.map((party, index) => (
            <tr key={party.id ?? `party-${index}`} className="border-t border-line odd:bg-white even:bg-soft/50 first:border-t-0">
              <td className="truncate px-3 py-2 font-bold text-ink">{party.name}</td>
              <td className="px-3 py-2 text-right text-xs font-semibold text-muted">
                {party.documentCount} document{party.documentCount === 1 ? "" : "s"}
              </td>
              <td className="w-28 px-3 py-2 text-right font-bold tabular-nums text-ink">{money(party.balanceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Debtors/Creditors/Expected Profit are balance-sheet snapshots — who owes
 * the business, who the business owes, and what profit would look like if
 * both were settled today. Deliberately not scoped to the selected period:
 * a debt doesn't stop existing just because you picked "Yesterday" above. */
export function DebtorsCreditorsSection({
  debtors,
  totalDebtCents,
  creditors,
  totalCreditCents,
  expectedProfitCents,
}: {
  debtors: SalesLedgerParty[];
  totalDebtCents: number;
  creditors: SalesLedgerParty[];
  totalCreditCents: number;
  expectedProfitCents: number;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-ink">Debtors, Creditors &amp; Expected Profit</h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">
          A live snapshot as of today — not scoped to the period selected above.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <OverviewCard
          tone="primary"
          label="Debtors"
          valueCents={totalDebtCents}
          formula="Unpaid balances owed to you by customers"
          footnote={
            debtors.length === 0 ? "No outstanding customer debt" : `${debtors.length} customer${debtors.length === 1 ? "" : "s"} owe you money`
          }
        />
        <OverviewCard
          tone="danger"
          label="Creditors"
          valueCents={totalCreditCents}
          formula="Unpaid balances you owe to suppliers"
          footnote={
            creditors.length === 0 ? "No outstanding supplier debt" : `You owe ${creditors.length} supplier${creditors.length === 1 ? "" : "s"}`
          }
        />
        <OverviewCard
          tone={expectedProfitCents >= 0 ? "success" : "danger"}
          label="Expected Profit"
          valueCents={expectedProfitCents}
          formula="Net Profit + money owed to you − money you owe"
          footnote="A cash-flow projection — see Notes below"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Who owes you</p>
          <div className="mt-3">
            <PartyList parties={debtors} emptyMessage="No customer currently owes you money." />
          </div>
        </div>
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Who you owe</p>
          <div className="mt-3">
            <PartyList parties={creditors} emptyMessage="You don't currently owe any supplier money." />
          </div>
        </div>
      </div>
    </div>
  );
}

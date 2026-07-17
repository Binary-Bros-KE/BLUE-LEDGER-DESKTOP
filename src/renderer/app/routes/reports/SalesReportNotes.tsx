type Note = { term: string; explanation: string };

const NOTES: Note[] = [
  {
    term: "Total Revenue vs. Average Sale / Gross Sales",
    explanation:
      "These intentionally use different bases. Total Revenue counts cash actually collected (a fully-paid retail sale counts in full; an invoice counts only as its payments arrive). Average Sale, Average Daily Revenue, and Gross Sales describe the full recorded value of what was sold, regardless of what's been paid so far — so Average Sale × Transactions reconciles to Gross Sales, not to Total Revenue.",
  },
  {
    term: "Net Revenue can rise later for a past period",
    explanation:
      "Net Revenue only recognizes profit on the portion of each sale that's actually been paid for so far. If an invoice from last month gets paid off further today, last month's Net Revenue will be higher the next time you look — it reflects cash collected \"as of now\", not a frozen historical figure.",
  },
  {
    term: "The Revenue Trend graph matches Total Revenue, not Net Revenue",
    explanation:
      "Each point plots the same cash-basis figure as the Total Revenue card, computed the same way — so the highlighted point always matches the Total Revenue card exactly for that period.",
  },
  {
    term: "What counts as \"a transaction\"",
    explanation:
      "A sale only counts once money has actually changed hands: retail and wholesale sales are paid in full at checkout, so they always count; an invoice only counts once it has received at least one payment. An invoice nobody has paid anything toward yet is an open order, not a transaction — it won't appear in the Transactions list or any total on this page.",
  },
  {
    term: "Why aren't returns just excluded, the same as voids?",
    explanation:
      "A void erases a mistake — it's always the whole sale, and there's no meaningful date for it other than \"treat as if it never happened\", so it's removed entirely from every figure, at every point in time. A return can't work that way for two reasons: it can be partial (excluding the whole sale would wrongly zero out the items the customer kept), and it's genuinely time-shifted (the sale really happened on one day, the refund really happened later, sometimes in a different reporting period). Recording both as their own dated events — full sale revenue when it happened, refund subtracted when the return was approved — is what keeps a past period's numbers from silently shrinking every time a return gets approved weeks after the fact.",
  },
  {
    term: "Approving a return assumes a cash refund happened",
    explanation:
      "The refunded amount is subtracted from Total Revenue, dated by when the return was approved (not when the original sale happened) — the Approvals screen says this explicitly at the point of approval. See the Voided Sales & Processed Returns section below for the detail.",
  },
  {
    term: "Sales by Payment Method, Storefront, and Employee show gross figures",
    explanation:
      "Unlike Total Revenue, these three breakdowns don't subtract approved refunds — they show the full face value of each sale. When a refund exists in the selected period, a note appears under each of these sections showing the gross figure and how it reconciles down to Total Revenue.",
  },
  {
    term: "Pending void/return requests are still counted",
    explanation:
      "A void or return that's been requested but not yet approved by a manager doesn't change any number on this page — the sale keeps counting normally until someone actually approves the request.",
  },
  {
    term: "\"Method\" reflects whatever payment method was recorded, by name",
    explanation:
      "The Method column shows whichever payment method your business recorded that payment under (as configured under Payment Methods) — including one literally named \"Credit\" if you've set one up that way. Every entry in an invoice's payment ledger is treated as real cash received, regardless of the method's name — only record a payment there for money or equivalent value actually collected.",
  },
  {
    term: "Transaction status only shows Paid or Partially Paid",
    explanation:
      "Every row in the Transactions list has already collected some cash (fully-unpaid invoices are excluded entirely), so the only useful distinction left is whether it's fully settled. Labels like \"overdue\" or \"unpaid\" that live on the underlying invoice record aren't shown here — check the Invoices tab for that detail.",
  },
  {
    term: "Total Expenses now includes Purchases and Salaries",
    explanation:
      "Total Expenses = general expenses recorded + payments actually made to suppliers + salaries actually paid out, all on a cash basis. An unpaid supplier bill isn't an expense yet — it shows up under Creditors instead, until it's paid. The breakdown tables group expenses by category, purchases by supplier, and salaries by employee, each with how many times paid and what share of the total.",
  },
  {
    term: "Net Revenue and Net Profit can never be perfectly exact",
    explanation:
      "See the accuracy notice above the trend graph — cost of goods is incurred all at once, but invoice payments can trickle in over a different period than the sale itself. This report approximates rather than pretends to reconcile the two exactly.",
  },
  {
    term: "Debtors, Creditors and Expected Profit are live snapshots",
    explanation:
      "Unlike everything else on this page, these three ignore the period selected above — a customer's unpaid balance or a supplier bill you owe doesn't stop existing just because you switched to \"Yesterday\". They always reflect today's outstanding balances.",
  },
  {
    term: "Expected Profit is a projection, not an exact figure",
    explanation:
      "Expected Profit = Net Profit + total owed to you − total you owe. It's a simple cash-flow estimate — it adds the full outstanding balance, not just the profit margin buried inside it — so treat it as \"what your cash position would look like if everyone settled up today\", not a precise accounting recalculation.",
  },
  {
    term: "Salary branch scoping is approximate",
    explanation:
      "Salary records don't have a branch of their own. When this report is scoped to one storefront, salary totals are approximated using each paid employee's assigned branch.",
  },
  {
    term: "The Transactions list is dated by when the sale happened, not when it was paid",
    explanation:
      "The list below shows sales and invoices completed within the selected period. A payment received today for an invoice created last month adds to today's Total Revenue, but that invoice itself appears in last month's Transactions list, dated by when it was created — not today's.",
  },
];

/** The last thing on the page, by design — every non-obvious rule the numbers
 * above depend on, in one place, so nothing here is a black box. */
export function SalesReportNotes(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-soft/40 p-5">
      <h3 className="text-base font-extrabold text-ink">Notes</h3>
      <p className="mt-1 text-xs font-semibold text-muted">
        What every figure on this page means, and the edge cases worth knowing about.
      </p>
      <dl className="mt-4 space-y-4">
        {NOTES.map((note) => (
          <div key={note.term}>
            <dt className="text-sm font-extrabold text-ink">{note.term}</dt>
            <dd className="mt-0.5 text-xs font-semibold leading-relaxed text-muted">{note.explanation}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

import { AlertTriangle } from "lucide-react";

/** A deliberately prominent, honest disclosure — not buried in the Notes at
 * the bottom — about the one thing this report genuinely can't make
 * perfectly precise: profit on a partially-paid invoice. Cost of goods is
 * fully incurred the moment a sale happens; the matching revenue can trickle
 * in over weeks. There's no data model here that reconciles that cleanly, so
 * we say so instead of pretending otherwise. */
export function AccuracyLimitationsNotice(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 flex-none text-warning" aria-hidden="true" />
        <div>
          <p className="text-sm font-extrabold text-ink">A note on accuracy: partially-paid invoices</p>
          <p className="mt-1.5 text-xs font-semibold leading-relaxed text-muted">
            The cost of goods sold is fully incurred the moment a sale happens — but on an invoice, the matching cash can
            arrive over several payments, weeks or months apart, sometimes in a different reporting period than the sale
            itself. There is no way to split "how much of the cost applies to what's been collected so far" with
            certainty. This report recognizes profit in proportion to how much of each invoice has actually been paid,
            which avoids the worst distortions (Net Revenue can never show more profit than has realistically come in),
            but it&rsquo;s still an approximation, not exact accrual accounting.
          </p>
          <p className="mt-1.5 text-xs font-bold text-ink">
            For the most accurate report, make sure partially-paid invoices are fully collected before relying heavily on
            Net Revenue or Net Profit for a given period.
          </p>
        </div>
      </div>
    </div>
  );
}

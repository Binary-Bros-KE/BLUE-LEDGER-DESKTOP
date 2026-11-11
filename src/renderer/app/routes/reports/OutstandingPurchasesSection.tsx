import { useState } from "react";
import { Button } from "@renderer/shared/components/Button";
import { usePermissions } from "@renderer/shared/hooks/use-permissions";
import { formatCents } from "@renderer/shared/lib/money";
import { getErrorMessage } from "@renderer/shared/lib/errors";
import { showErrorToast } from "@renderer/shared/lib/toast";
import type {
  OutstandingPurchaseRow,
  OutstandingPurchasesSummary
} from "@shared/types/supplier-report";
import type { ReportExportSection } from "@shared/types/report-export";
import type { PaymentMethod } from "@shared/types/payment-method";
import { OverviewCard } from "./FinancialOverviewCards";
import { SupplierStatementModal } from "../purchases/SupplierStatementModal";

type SupplierTotal = {
  supplierId: string;
  supplierName: string;
  purchaseCount: number;
  total: number;
  paid: number;
  balance: number;
  days: number;
};
export function groupSupplierPurchases(purchases: OutstandingPurchaseRow[]): SupplierTotal[] {
  const totals = new Map<string, SupplierTotal>();
  for (const purchase of purchases) {
    const row = totals.get(purchase.supplierId) ?? {
      supplierId: purchase.supplierId,
      supplierName: purchase.supplierName,
      purchaseCount: 0,
      total: 0,
      paid: 0,
      balance: 0,
      days: 0
    };
    row.purchaseCount++;
    row.total += purchase.payableCents;
    row.paid += purchase.amountPaidCents;
    row.balance += purchase.balanceCents;
    row.days = Math.max(row.days, purchase.daysOutstanding);
    totals.set(row.supplierId, row);
  }
  return [...totals.values()].sort(
    (a, b) => b.days - a.days || a.supplierName.localeCompare(b.supplierName)
  );
}

export function supplierOutstandingSections(
  title: string,
  purchases: OutstandingPurchaseRow[]
): ReportExportSection[] {
  const rows = groupSupplierPurchases(purchases);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const paid = rows.reduce((sum, row) => sum + row.paid, 0);
  const balance = rows.reduce((sum, row) => sum + row.balance, 0);
  return [
    {
      type: "cards",
      title,
      cards: [
        { tone: "primary", label: "Received Payable", value: formatCents(total) },
        { tone: "success", label: "Paid", value: formatCents(paid) },
        { tone: "danger", label: "Outstanding", value: formatCents(balance) },
        { tone: "teal", label: "Suppliers", value: String(rows.length) }
      ]
    },
    {
      type: "table",
      title,
      description: "Received goods plus supplier shipping fees, less payments. Unreceived orders excluded. Oldest balances first.",
      columns: [
        { key: "supplier", header: "Supplier" },
        { key: "purchases", header: "Purchases", align: "right" },
        { key: "total", header: "Received Payable", align: "right" },
        { key: "paid", header: "Paid", align: "right" },
        { key: "balance", header: "Balance", align: "right" },
        { key: "days", header: "Oldest (days)", align: "right" }
      ],
      rows: rows.map((row) => ({
        supplier: row.supplierName,
        purchases: String(row.purchaseCount),
        total: formatCents(row.total),
        paid: formatCents(row.paid),
        balance: formatCents(row.balance),
        days: String(row.days)
      }))
    }
  ];
}

export function OutstandingPurchasesSection({
  summary,
  onPaid
}: {
  summary: OutstandingPurchasesSummary;
  onPaid: () => void;
}): React.JSX.Element {
  const { can } = usePermissions();
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [printing, setPrinting] = useState<string | null>(null);
  async function statement(id: string): Promise<void> {
    try {
      const methods = await window.blueLedger.paymentMethod.list();
      setPaymentMethods(methods);
      setSupplierId(id);
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to open statement"));
    }
  }
  async function print(title: string, purchases: OutstandingPurchaseRow[]): Promise<void> {
    setPrinting(title);
    try {
      await window.blueLedger.reportExport.toPdf({
        module: "reports",
        title,
        subtitle: "Live outstanding supplier payments",
        sections: supplierOutstandingSections(title, purchases),
        fileBaseName: title.replaceAll(" ", "_")
      });
    } catch (err) {
      showErrorToast(getErrorMessage(err, "Failed to preview report"));
    } finally {
      setPrinting(null);
    }
  }
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold text-ink">Outstanding Supplier Payments</h3>
        <p className="mt-1 text-xs font-semibold text-muted">
          Live balances for received goods plus supplier shipping fees, less payments. Unreceived orders are excluded.
        </p>
      </div>
      {(["local", "international"] as const).map((type) => {
        const purchases = summary.purchases.filter((row) =>
          type === "international"
            ? row.supplierType === type
            : row.supplierType !== "international"
        );
        const rows = groupSupplierPurchases(purchases);
        const title = type === "local" ? "Local Suppliers" : "International Suppliers";
        return (
          <section key={type} className="space-y-4 rounded-lg border border-line bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-extrabold text-ink">{title}</h4>
              {can("reports", "export") && (
                <Button
                  type="button"
                  disabled={printing !== null}
                  onClick={() => void print(title, purchases)}
                  className="h-9 text-xs"
                >
                  {printing === title ? "Preparing..." : "Print / PDF"}
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewCard
                tone="primary"
                label="Received Payable"
                valueCents={rows.reduce((sum, row) => sum + row.total, 0)}
                formula="Received goods plus supplier shipping fees on outstanding purchases"
              />
              <OverviewCard
                tone="success"
                label="Paid"
                valueCents={rows.reduce((sum, row) => sum + row.paid, 0)}
                formula="Payments against outstanding purchases"
              />
              <OverviewCard
                tone="danger"
                label="Outstanding"
                valueCents={rows.reduce((sum, row) => sum + row.balance, 0)}
                formula="Received payable less payments"
              />
              <OverviewCard
                tone="teal"
                label="Suppliers"
                displayValue={String(rows.length)}
                formula="Suppliers with outstanding purchases"
              />
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">Nothing outstanding here right now.</p>
            ) : (
              <div className="max-h-[480px] overflow-auto rounded-lg border border-line">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="sticky top-0 bg-primary text-white">
                    <tr>
                      {[
                        "Supplier",
                        "Purchases",
                        "Received Payable",
                        "Paid",
                        "Balance",
                        "Oldest (days)",
                        "Action"
                      ].map((label, i) => (
                        <th
                          key={label}
                          className={
                            "px-3 py-2.5 text-xs " +
                            (i === 0 || i === 6 ? "text-left" : "text-right")
                          }
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.supplierId}
                        className="border-t border-line odd:bg-white even:bg-soft/50"
                      >
                        <td className="px-3 py-2 font-bold">{row.supplierName}</td>
                        <td className="px-3 py-2 text-right">{row.purchaseCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCents(row.total)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCents(row.paid)}
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">
                          {formatCents(row.balance)}
                        </td>
                        <td className="px-3 py-2 text-right">{row.days}d</td>
                        <td className="px-3 py-2">
                          <Button
                            type="button"
                            onClick={() => void statement(row.supplierId)}
                            className="h-8 text-xs"
                          >
                            Statement
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {supplierId && (
        <SupplierStatementModal
          key={supplierId}
          open
          initialSupplierId={supplierId}
          onClose={() => setSupplierId(null)}
          suppliers={[]}
          paymentMethods={paymentMethods}
          onPaid={onPaid}
        />
      )}
    </div>
  );
}

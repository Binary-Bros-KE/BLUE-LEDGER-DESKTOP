import { formatDocumentDateTime } from "@shared/lib/date";
import { computeAddedTaxCents, computeTaxBreakdown, type TaxBreakdownEntry } from "@shared/lib/tax-calculation";
import type { Sale } from "@shared/types/sale";

/** Formats integer cents for a receipt, e.g. 25050 -> "250.50". Usable from both main and renderer. */
export function formatReceiptCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "0.00";
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type ReceiptLineItem = {
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type ReceiptViewModel = {
  businessName: string;
  physicalAddress: string | null;
  primaryPhone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  currency: string;
  receiptNumber: string | null;
  dateLabel: string;
  cashierName: string;
  branchName: string;
  customerName: string | null;
  items: ReceiptLineItem[];
  /** Service charges + delivery fee, printed the same way as items — never the hidden cost. */
  extraLines: ReceiptLineItem[];
  subtotalCents: number;
  discountAmountCents: number;
  /** Reporting-only figure — grandTotalCents below is the frozen value prepareCart already computed
   * correctly for whichever tax mode was active at sale time (see tax-calculation.ts), so this
   * component never re-derives it. See taxBreakdown for the printable category breakdown. */
  taxAmountCents: number;
  /** The subset of taxAmountCents that was actually ADDED to reach grandTotalCents (exclusive-priced
   * lines only) — see computeAddedTaxCents' own doc comment. This is what the "Total Tax" summary
   * row shows, distinct from taxAmountCents (which also includes inclusive lines' embedded tax). */
  addedTaxCents: number;
  taxBreakdown: TaxBreakdownEntry[];
  /** Whether the Tax Breakdown section should actually render — see Sale["includeTaxBreakdown"]'s
   * own doc comment. taxBreakdown itself is always computed regardless, so a caller that ignores
   * this flag (there should be none) still gets correct data. */
  includeTaxBreakdown: boolean;
  vatRatePercent: number;
  grandTotalCents: number;
  paymentMethodName: string | null;
  paymentReference: string | null;
  amountReceivedCents: number | null;
  changeGivenCents: number | null;
};

export type ReceiptBusinessInfo = {
  businessName: string;
  physicalAddress: string | null;
  primaryPhone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  currency: string;
  vatRatePercent: number;
};

/** "CASH RECEIPT" replaces businessName as the printed heading when Sale["includeBusinessInfo"] is
 * false — see that field's own doc comment (shared/types/sale.ts). Every other identity field is
 * blanked the same way, including branchName (the storefront name), whose only consumers are the
 * "Cashier: X · Branch: Y" metadata line in printer-service.ts/ReceiptPreview.tsx — those already
 * omit the "· Branch: Y" segment entirely when branchName is empty. */
const GENERIC_RECEIPT_HEADING = "CASH RECEIPT";

export function buildReceiptViewModel(sale: Sale, business: ReceiptBusinessInfo): ReceiptViewModel {
  const showBusinessInfo = sale.includeBusinessInfo;
  return {
    businessName: showBusinessInfo ? business.businessName : GENERIC_RECEIPT_HEADING,
    physicalAddress: showBusinessInfo ? business.physicalAddress : null,
    primaryPhone: showBusinessInfo ? business.primaryPhone : null,
    receiptHeader: showBusinessInfo ? business.receiptHeader : null,
    receiptFooter: showBusinessInfo ? business.receiptFooter : null,
    currency: business.currency,
    receiptNumber: sale.receiptNumber,
    dateLabel: formatDocumentDateTime(sale.completedAt ?? sale.createdAt),
    cashierName: sale.employeeName,
    branchName: showBusinessInfo ? sale.locationName : "",
    customerName: sale.customerName,
    items: sale.items.map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents
    })),
    extraLines: [
      ...sale.serviceCharges.map((charge) => ({
        name: charge.name,
        quantity: 1,
        unitPriceCents: charge.feeCents,
        lineTotalCents: charge.feeCents
      })),
      // A seller who absorbs the delivery cost themselves charges the customer nothing for it —
      // a printed "Delivery Fee: 0.00" line would be confusing, so skip it entirely when zero.
      ...(sale.delivery && sale.delivery.feeCents > 0
        ? [
            {
              name: "Delivery Fee",
              quantity: 1,
              unitPriceCents: sale.delivery.feeCents,
              lineTotalCents: sale.delivery.feeCents
            }
          ]
        : [])
    ],
    subtotalCents: sale.subtotalCents,
    discountAmountCents: sale.discountAmountCents,
    taxAmountCents: sale.taxAmountCents,
    addedTaxCents: computeAddedTaxCents(sale.items),
    taxBreakdown: computeTaxBreakdown(sale.items),
    includeTaxBreakdown: sale.includeTaxBreakdown,
    vatRatePercent: business.vatRatePercent,
    grandTotalCents: sale.grandTotalCents,
    paymentMethodName: sale.paymentMethodName,
    paymentReference: sale.paymentReference,
    amountReceivedCents: sale.amountReceivedCents,
    changeGivenCents: sale.changeGivenCents
  };
}

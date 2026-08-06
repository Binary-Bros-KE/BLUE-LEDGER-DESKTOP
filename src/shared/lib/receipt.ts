import { formatDocumentDateTime } from "@shared/lib/date";
import { computeTaxBreakdown, type TaxBreakdownEntry } from "@shared/lib/tax-calculation";
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
  /** Reporting-only — already included in subtotalCents (prices are tax-inclusive), never added
   * into grandTotalCents. See taxBreakdown for the printable category breakdown. */
  taxAmountCents: number;
  taxBreakdown: TaxBreakdownEntry[];
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

export function buildReceiptViewModel(sale: Sale, business: ReceiptBusinessInfo): ReceiptViewModel {
  return {
    businessName: business.businessName,
    physicalAddress: business.physicalAddress,
    primaryPhone: business.primaryPhone,
    receiptHeader: business.receiptHeader,
    receiptFooter: business.receiptFooter,
    currency: business.currency,
    receiptNumber: sale.receiptNumber,
    dateLabel: formatDocumentDateTime(sale.completedAt ?? sale.createdAt),
    cashierName: sale.employeeName,
    branchName: sale.locationName,
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
    taxBreakdown: computeTaxBreakdown(sale.items),
    vatRatePercent: business.vatRatePercent,
    grandTotalCents: sale.grandTotalCents,
    paymentMethodName: sale.paymentMethodName,
    paymentReference: sale.paymentReference,
    amountReceivedCents: sale.amountReceivedCents,
    changeGivenCents: sale.changeGivenCents
  };
}

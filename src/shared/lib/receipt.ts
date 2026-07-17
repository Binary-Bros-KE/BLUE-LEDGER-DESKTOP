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
  taxAmountCents: number;
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
    dateLabel: new Date(sale.completedAt ?? sale.createdAt).toLocaleString(),
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
      ...(sale.delivery
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
    grandTotalCents: sale.grandTotalCents,
    paymentMethodName: sale.paymentMethodName,
    paymentReference: sale.paymentReference,
    amountReceivedCents: sale.amountReceivedCents,
    changeGivenCents: sale.changeGivenCents
  };
}

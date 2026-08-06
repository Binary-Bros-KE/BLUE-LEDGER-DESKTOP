export type StockReceiptItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantityReceived: number;
  /** Frozen at the moment this batch was received — never recomputed, so a reprint months later
   * shows exactly what was true then, even if the product's stock has since moved on. */
  previousQuantity: number;
  newQuantity: number;
};

/** One row for the Receive Goods history list. */
export type StockReceiptListItem = {
  id: string;
  receiptNumber: string;
  locationId: string;
  locationName: string;
  allocationStorefrontId: string | null;
  allocationStorefrontName: string | null;
  receivedByName: string;
  itemCount: number;
  totalQuantityReceived: number;
  notes: string | null;
  createdAt: string;
};

export type StockReceipt = StockReceiptListItem & {
  items: StockReceiptItem[];
};

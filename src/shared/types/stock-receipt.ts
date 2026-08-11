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
  /** Derived at read time from this receipt's own stock_movements, not a stored field — see
   * stock-receipt-repository.ts's StockReceiptRow.is_transfer for why. "transfer" means every item
   * was physically drawn out of Main Store (distributeMainStoreStockCore); "purchase" means every
   * item was freshly added stock, whether received into Main Store or straight into a storefront. */
  sourceType: "purchase" | "transfer";
  notes: string | null;
  createdAt: string;
};

export type StockReceipt = StockReceiptListItem & {
  items: StockReceiptItem[];
};

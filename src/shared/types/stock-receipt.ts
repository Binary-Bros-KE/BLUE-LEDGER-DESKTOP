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
  /** Only ever set for a Main Store transfer (sourceType "transfer") — the Main Store's OWN on-hand
   * quantity immediately before/after this item was drawn out, alongside previousQuantity/newQuantity
   * above (which describe the RECEIVING storefront). Null for a plain purchase receipt, where there's
   * no Main Store side to show. Frozen the same way, at the moment of receiving. */
  mainStorePreviousQuantity: number | null;
  mainStoreNewQuantity: number | null;
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

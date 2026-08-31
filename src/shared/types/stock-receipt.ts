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
  /** The OTHER side of a transfer's before/after — Main Store's own on-hand quantity for
   * sourceType "transfer", or the sending storefront's for sourceType "location_transfer" —
   * alongside previousQuantity/newQuantity above (which always describe the RECEIVING location).
   * Null for a plain purchase receipt, where there's no other side to show. Frozen the same way, at
   * the moment of receiving. Field names kept as-is (not renamed to something generic) rather than
   * adding parallel columns/a schema migration for what's the same concept either way — see
   * stock-receipt-repository.ts's own comment on deriving sourceType instead of storing it, same
   * reasoning. */
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
   * stock-receipt-repository.ts's own comment for why. "transfer" means every item was physically
   * drawn out of Main Store (distributeMainStoreStockCore); "location_transfer" means every item
   * moved between two ordinary storefronts (plain transfer_out/transfer_in, no allocation buckets);
   * "purchase" means every item was freshly added stock, whether received into Main Store or
   * straight into a storefront. */
  sourceType: "purchase" | "transfer" | "location_transfer";
  /** The sending location for either transfer kind — Main Store for "transfer", the source
   * storefront for "location_transfer". Null for a plain purchase. Derived the same way sourceType
   * is (see stock-receipt-repository.ts), not a stored field. */
  transferFromLocationId: string | null;
  transferFromLocationName: string | null;
  notes: string | null;
  createdAt: string;
};

export type StockReceipt = StockReceiptListItem & {
  items: StockReceiptItem[];
};

/** Purely derived from item quantities — never set directly, same reasoning as
 * computePurchaseReceivingStatus (purchase.ts). */
export function computeBorrowReturnStatus(params: {
  items: Array<{ quantity: number; returnedQuantity: number }>;
}): "open" | "partially_returned" | "returned" {
  const totalQuantity = params.items.reduce((sum, item) => sum + item.quantity, 0);
  const totalReturned = params.items.reduce((sum, item) => sum + item.returnedQuantity, 0);
  if (totalReturned <= 0) return "open";
  if (totalReturned >= totalQuantity) return "returned";
  return "partially_returned";
}

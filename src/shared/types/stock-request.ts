export type StockRequestStatus = "pending" | "approved" | "rejected";

export type StockRequestItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantityRequested: number;
};

/** One row for the Stock Requests list — Cashier/Manager see only their own storefront's requests
 * (branch-scoped like everything else); Storekeeper/Super Admin see every storefront's. */
export type StockRequestListItem = {
  id: string;
  requestNumber: string;
  storefrontId: string;
  storefrontName: string;
  status: StockRequestStatus;
  itemCount: number;
  totalQuantityRequested: number;
  notes: string | null;
  rejectionReason: string | null;
  requestedByName: string;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

export type StockRequest = StockRequestListItem & {
  items: StockRequestItem[];
};

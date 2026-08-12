export type InvoiceCancellationId = string;

export const INVOICE_CANCELLATION_STATUS_OPTIONS = [
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }
] as const;

export type InvoiceCancellationStatus = (typeof INVOICE_CANCELLATION_STATUS_OPTIONS)[number]["value"];

export type InvoiceCancellationSyncStatus = "pending" | "synced" | "syncing" | "error";

/** A request to cancel an invoice — restocks every item and, if anything was paid, reverses that
 * payment as a real Transactions-ledger entry (see report-service.ts's getPaymentTransactions). The
 * direct "Cancel Invoice" button and the "Request Cancel" approval workflow both create one of
 * these — the only difference is whether `status` starts 'approved' (self-approved, effective
 * immediately) or 'pending_approval' (a manager must decide via the Approvals tab). */
export type InvoiceCancellation = {
  id: InvoiceCancellationId;
  tenantId: string;
  saleId: string;
  invoiceNumber: string | null;
  saleGrandTotalCents: number;
  locationId: string;
  locationName: string;
  status: InvoiceCancellationStatus;
  reason: string;
  notes: string | null;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: InvoiceCancellationSyncStatus;
  lastSyncedAt: string | null;
};

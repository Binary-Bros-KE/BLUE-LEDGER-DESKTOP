import { randomUUID } from "node:crypto";
import { runInTransaction } from "@main/database/connection";
import * as invoiceCancellationRepository from "@main/database/repositories/invoice-cancellation-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import { getCurrentBranchScope, getCurrentEmployeeId, requirePermission } from "@main/services/auth-service";
import { applyValidatedStockMovement } from "@main/services/inventory-service";
import { requireInvoiceRow } from "@main/services/invoice-service";
import { getSaleDetail } from "@main/services/sale-service";
import { assertNotAlreadyDecidedRemotely } from "@main/services/sync-engine";
import { getCurrentTenant } from "@main/services/tenant-service";
import { approvalDecisionSchema } from "@shared/schemas/sale-void";
import {
  directInvoiceCancelSchema,
  invoiceCancellationRequestSchema
} from "@shared/schemas/invoice-cancellation";
import type { PaymentStatus, Sale } from "@shared/types/sale";
import type { InvoiceCancellation } from "@shared/types/invoice-cancellation";

/**
 * Cancelling an invoice used to be a pure write-off — flip payment_status to 'cancelled' and stop,
 * inventory and money both left exactly where the original sale put them. Real field question that
 * exposed why that's wrong: "when a user cancels an invoice, is stock re-imbursed?" — it wasn't, and
 * neither was any payment already collected against it, with no way back to fix either short of
 * manually walking Stock Ledger and the books.
 *
 * Two user-facing routes now exist — the direct "Cancel Invoice" button (cancelInvoiceDirect, no
 * approval, effective immediately) and a manager-approval "Request Cancel" workflow
 * (requestInvoiceCancel → approveInvoiceCancel/rejectInvoiceCancel, same shape as sale-void-service.ts's
 * request/approve/reject) — and BOTH end up going through the exact same restockAndMarkCancelled
 * below, so there is only ever one place that actually reverses stock/money for an invoice
 * cancellation, not two independently-maintained copies.
 *
 * Genuinely a separate entity from sale_voids, not a reuse of it: an invoice cancellation always
 * restocks AND (if anything was paid) reverses the payment as a real Transactions-ledger entry —
 * sale_voids restocks only and never touches money (see ApprovalsRoute.tsx's own copy: approving a
 * sale RETURN "assumes the customer has already been refunded in cash" — an invoice cancellation
 * makes that refund an explicit, auditable ledger row instead of an assumption).
 */

function getDetail(id: string): InvoiceCancellation {
  const row = invoiceCancellationRepository.findInvoiceCancellationDetailRowById(id);
  if (!row) {
    throw new Error("Cancellation request not found");
  }
  return invoiceCancellationRepository.mapInvoiceCancellationDetailRow(row);
}

function requireEmployeeId(): string {
  const employeeId = getCurrentEmployeeId();
  if (!employeeId) {
    throw new Error("You must be signed in to do that");
  }
  return employeeId;
}

/** Restocks every stock-tracked, non-locally-sourced item on the invoice (mirrors
 * insertInvoiceFromCart's own `item.product.track_stock && !item.isLocallySourced` deduction
 * condition exactly — a locally-sourced or untracked item was never actually deducted from
 * inventory at sale time, so crediting it back here would fabricate stock that was never taken) and
 * marks the invoice cancelled. The refund itself needs no separate write here: once this
 * cancellation's own row is 'approved', getPaymentTransactions (report-service.ts) derives the
 * refund entries live from the invoice's existing payments — same "computed from what already
 * exists" approach stock-receipt-repository.ts's is_transfer took, for the same reason (no new
 * synced field on `sales` to keep correct, no risk of retroactively fabricating refund history for
 * invoices cancelled before this feature existed). */
function restockAndMarkCancelled(tenantId: string, saleId: string, cancellationId: string, actorId: string): void {
  const sale = saleRepository.findSaleRowById(saleId);
  if (!sale) {
    throw new Error("Invoice not found");
  }
  const items = saleRepository.findSaleItemDetailRows(saleId);
  for (const item of items) {
    if (!item.track_stock || item.is_locally_sourced) continue;
    applyValidatedStockMovement(
      {
        productId: item.product_id,
        locationId: sale.location_id,
        movementType: "return",
        quantityChange: item.quantity,
        referenceType: "invoice_cancellation",
        referenceId: cancellationId,
        performedBy: actorId,
        notes: null
      },
      tenantId
    );
  }
  saleRepository.updateSalePaymentStatusRow(saleId, "cancelled" satisfies PaymentStatus);
}

export function listInvoiceCancellations(): InvoiceCancellation[] {
  requirePermission("sales", "view");
  const { tenantId } = getCurrentTenant();
  const locationId = getCurrentBranchScope();
  return invoiceCancellationRepository
    .findAllInvoiceCancellationRows(tenantId, locationId)
    .map(invoiceCancellationRepository.mapInvoiceCancellationDetailRow);
}

export function getInvoiceCancellation(id: string): InvoiceCancellation {
  requirePermission("sales", "view");
  return getDetail(id);
}

/** The "Cancel Invoice" button — self-approved (requestedBy === approvedBy), effective immediately.
 * Still creates a real invoice_cancellations row (status inserted pending, then transitioned to
 * approved in the same transaction) rather than skipping the table entirely, so this and the
 * approval-gated route share one audit trail and one place getPaymentTransactions has to look. */
export function cancelInvoiceDirect(saleId: string, input: unknown): Sale {
  // Same gate as approveInvoiceCancel below, not "sales":"edit" — cancelling outright with no
  // approval step is only as safe as approving someone else's request would be, and Cashier's
  // default role grants "sales":"edit" (used for requestInvoiceCancel) but never "approvals".
  requirePermission("approvals", "approve");
  const parsed = directInvoiceCancelSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = requireEmployeeId();

  const invoiceRow = requireInvoiceRow(saleId, tenantId);
  if (invoiceRow.payment_status === "cancelled") {
    throw new Error("This invoice is already cancelled");
  }
  if (invoiceCancellationRepository.findPendingInvoiceCancellationForSaleRow(saleId)) {
    throw new Error("This invoice already has a cancellation request awaiting approval");
  }

  const cancellationId = `invoice_cancel_${randomUUID()}`;

  runInTransaction(() => {
    invoiceCancellationRepository.insertInvoiceCancellationRow({
      id: cancellationId,
      tenantId,
      saleId,
      reason: parsed.reason?.trim() || "Cancelled by staff",
      notes: null,
      requestedBy: employeeId
    });
    invoiceCancellationRepository.updateInvoiceCancellationStatusRow(cancellationId, "approved", employeeId, null);
    restockAndMarkCancelled(tenantId, saleId, cancellationId, employeeId);
  });

  return getSaleDetail(saleId);
}

/** A cashier's request to cancel an invoice. Nothing changes — stock and money both stay exactly as
 * they are — until a manager approves it via the Approvals tab. */
export function requestInvoiceCancel(input: unknown): InvoiceCancellation {
  requirePermission("sales", "edit");
  const parsed = invoiceCancellationRequestSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const employeeId = requireEmployeeId();

  const invoiceRow = requireInvoiceRow(parsed.saleId, tenantId);
  if (invoiceRow.payment_status === "cancelled") {
    throw new Error("This invoice is already cancelled");
  }
  if (invoiceCancellationRepository.findPendingInvoiceCancellationForSaleRow(parsed.saleId)) {
    throw new Error("This invoice already has a cancellation request awaiting approval");
  }

  const row = invoiceCancellationRepository.insertInvoiceCancellationRow({
    id: `invoice_cancel_${randomUUID()}`,
    tenantId,
    saleId: parsed.saleId,
    reason: parsed.reason,
    notes: parsed.notes,
    requestedBy: employeeId
  });
  return getDetail(row.id);
}

/** Manager approval: restocks every eligible item, reverses any payment (via getPaymentTransactions
 * deriving it from this row once approved), and marks the request approved. */
export async function approveInvoiceCancel(id: string, input: unknown): Promise<InvoiceCancellation> {
  requirePermission("approvals", "approve");
  const parsed = approvalDecisionSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const approverId = requireEmployeeId();

  const cancellationRow = invoiceCancellationRepository.findInvoiceCancellationRowById(id);
  if (!cancellationRow || cancellationRow.tenant_id !== tenantId) {
    throw new Error("Cancellation request not found");
  }
  if (cancellationRow.status !== "pending_approval") {
    throw new Error("This request has already been decided");
  }
  await assertNotAlreadyDecidedRemotely("invoice_cancellations", id, "pending_approval");

  runInTransaction(() => {
    restockAndMarkCancelled(tenantId, cancellationRow.sale_id, id, approverId);
    invoiceCancellationRepository.updateInvoiceCancellationStatusRow(id, "approved", approverId, parsed.notes);
  });

  return getDetail(id);
}

export async function rejectInvoiceCancel(id: string, input: unknown): Promise<InvoiceCancellation> {
  requirePermission("approvals", "approve");
  const parsed = approvalDecisionSchema.parse(input);
  const { tenantId } = getCurrentTenant();
  const approverId = requireEmployeeId();

  const cancellationRow = invoiceCancellationRepository.findInvoiceCancellationRowById(id);
  if (!cancellationRow || cancellationRow.tenant_id !== tenantId) {
    throw new Error("Cancellation request not found");
  }
  if (cancellationRow.status !== "pending_approval") {
    throw new Error("This request has already been decided");
  }
  await assertNotAlreadyDecidedRemotely("invoice_cancellations", id, "pending_approval");

  invoiceCancellationRepository.updateInvoiceCancellationStatusRow(id, "rejected", approverId, parsed.notes);
  return getDetail(id);
}

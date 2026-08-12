import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

export const invoiceCancellationRequestSchema = z.object({
  saleId: z.string().trim().min(1),
  reason: z.string().trim().min(1, "A reason is required").max(500),
  notes: optionalText(500)
});

export type InvoiceCancellationRequestInput = z.infer<typeof invoiceCancellationRequestSchema>;

/** The direct "Cancel Invoice" button — reason is optional (the UI is a quick confirm dialog, not a
 * form) and falls back to a fixed default server-side; kept as its own schema rather than reusing
 * invoiceCancellationRequestSchema so a future UI that DOES want to capture a real reason for the
 * direct path can without loosening the approval-request path's own required reason. */
export const directInvoiceCancelSchema = z.object({
  reason: optionalText(500)
});

export type DirectInvoiceCancelInput = z.infer<typeof directInvoiceCancelSchema>;

// Approve/reject decisions reuse sale-void's own approvalDecisionSchema ({ notes }) — same shape,
// no reason to duplicate it (see sale-return-service.ts for the same reuse pattern).

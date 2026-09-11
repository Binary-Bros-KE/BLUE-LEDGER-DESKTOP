import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

/**
 * Shared by both the Customer Statement (statement-service.ts) and Supplier Statement
 * (supplier-statement-service.ts) — same shape, same meaning, just accounts-receivable vs
 * accounts-payable. Client request: a statement used to always mean "what's still owed" with no way
 * to see paid/historical documents. `status` defaults to "pending" so nothing about today's behavior
 * changes for a caller that doesn't pass filters at all (an older build, or a print/PDF/share call
 * that hasn't been updated to thread the user's on-screen filter choice through yet).
 *
 * dateFrom/dateTo bound the document's own date (invoice_date / ordered_at) — plain YYYY-MM-DD,
 * inclusive on both ends, same convention as every other date-range filter in this app. Either or
 * both may be omitted for an open-ended range.
 */
export const statementFiltersSchema = z.object({
  status: z.enum(["pending", "paid", "all"]).optional().default("pending"),
  dateFrom: optionalText(10),
  dateTo: optionalText(10)
});

export type StatementFiltersInput = z.infer<typeof statementFiltersSchema>;

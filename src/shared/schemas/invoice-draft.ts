import { z } from "zod";

/** Deliberately lenient — a draft is unfinished by definition (no customer yet, no lines yet, odd
 * prices mid-edit are all fine). Real validation happens only when the draft is turned into an
 * invoice through createInvoice. `id` present = update that draft, absent = save a new one. */
export const invoiceDraftSaveSchema = z.object({
  id: z.string().trim().min(1).nullable().optional(),
  customerId: z.string().trim().min(1).nullable().optional(),
  customerName: z.string().trim().max(200).nullable().optional(),
  storefrontId: z.string().trim().min(1).nullable().optional(),
  itemCount: z.coerce.number().int().min(0).default(0),
  estimatedTotalCents: z.coerce.number().int().min(0).default(0),
  form: z.record(z.string(), z.unknown())
});

export type InvoiceDraftSaveInput = z.infer<typeof invoiceDraftSaveSchema>;

import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

/** storefrontId is optional — a branch-scoped Cashier/Manager's request always targets their own
 * session branch (enforced server-side via getCurrentBranchScope()); only a cross-branch caller
 * (Super Admin) needs to name one explicitly. */
export const stockRequestCreateSchema = z.object({
  storefrontId: z.string().trim().min(1).nullable().optional(),
  notes: optionalText(500),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.coerce.number().int().positive("Quantity must be greater than 0")
      })
    )
    .min(1, "Add at least one product")
});

export type StockRequestCreateInput = z.infer<typeof stockRequestCreateSchema>;

export const stockRequestRejectSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required")
});

export type StockRequestRejectInput = z.infer<typeof stockRequestRejectSchema>;

/** Client request: partial fulfillment — the storekeeper names exactly how much of each line to
 * dispatch (0 counts, for a line that can't ship at all) rather than the old implicit "always the
 * full quantityRequested". note is optional/supplementary, unlike stockRequestRejectSchema's
 * mandatory reason — matches this app's notes-vs-reason naming convention. */
export const stockRequestFulfillSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        quantityDispatched: z.coerce.number().int().min(0)
      })
    )
    .min(1),
  note: optionalText(500)
});

export type StockRequestFulfillInput = z.infer<typeof stockRequestFulfillSchema>;

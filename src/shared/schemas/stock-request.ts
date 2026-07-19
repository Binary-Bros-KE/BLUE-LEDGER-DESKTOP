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

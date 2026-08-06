import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

/** locationId is optional — a branch-scoped employee's receipt always targets their own session
 * branch (same convention as stock-request.ts); only a cross-branch caller (Super Admin) or someone
 * receiving into Main Store needs to name one explicitly. destination distinguishes "Into Main
 * Store" (locationId is resolved to the tenant's Main Store server-side, allocationStorefrontId
 * picks the bucket) from "Direct to Storefront" (locationId IS the storefront, no bucket concept)
 * — same two-way split the single-item Receive tab already offers, just at the batch header. */
export const stockReceiptCreateSchema = z.object({
  destination: z.enum(["main_store", "storefront"]),
  locationId: z.string().trim().min(1).nullable().optional(),
  allocationStorefrontId: z.string().trim().min(1).nullable().optional(),
  notes: optionalText(1000),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantityReceived: z.coerce.number().int().positive("Quantity must be greater than 0")
      })
    )
    .min(1, "Add at least one product")
});

export type StockReceiptCreateInput = z.infer<typeof stockReceiptCreateSchema>;

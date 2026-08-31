import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

/** locationId is optional — a branch-scoped employee's receipt always targets their own session
 * branch (same convention as stock-request.ts); only a cross-branch caller (Super Admin) or someone
 * receiving into Main Store needs to name one explicitly. destination distinguishes "Into Main
 * Store" (locationId is resolved to the tenant's Main Store server-side, allocationStorefrontId
 * picks the bucket) from "Direct to Storefront" (locationId IS the storefront, no bucket concept)
 * from "Transfer from Main Store" (locationId IS the receiving storefront, same as "storefront" —
 * the difference is entirely in how stock-receipt-service.ts sources each item: physically drawn
 * out of Main Store via distributeMainStoreStockCore instead of freshly added via a plain purchase
 * movement) from "location_transfer" (moves stock between two ordinary storefronts — locationId is
 * the RECEIVING storefront same as "storefront", fromLocationId is the new field naming the SENDING
 * one; neither can be Main Store, which is what the other two transfer-shaped destinations already
 * cover). allocationStorefrontId is unused for either transfer case — nothing is left earmarked at
 * Main Store once stock is physically shipped out, and location_transfer never touches Main Store's
 * allocation buckets at all. fromLocationId is required (and validated distinct from locationId)
 * only when destination is "location_transfer". */
export const stockReceiptCreateSchema = z.object({
  destination: z.enum(["main_store", "storefront", "main_store_transfer", "location_transfer"]),
  locationId: z.string().trim().min(1).nullable().optional(),
  fromLocationId: z.string().trim().min(1).nullable().optional(),
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

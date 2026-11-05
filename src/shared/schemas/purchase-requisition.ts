import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

/** One requisition line: EITHER an existing catalog product (productId) OR a free-text item the
 * catalog doesn't have yet (itemName, no productId) — an approver links free-text lines to a real
 * product before converting. storefrontId follows stockRequestCreateSchema's rule: a branch-scoped
 * requester always requisitions for their own session branch (enforced server-side); only a
 * cross-branch caller names one. */
export const purchaseRequisitionCreateSchema = z.object({
  storefrontId: z.string().trim().min(1).nullable().optional(),
  notes: optionalText(1000),
  items: z
    .array(
      z
        .object({
          productId: z.string().trim().min(1).nullable().optional(),
          itemName: z.string().trim().max(200).optional().default(""),
          quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
          notes: optionalText(300)
        })
        .refine((item) => Boolean(item.productId) || item.itemName.length > 0, {
          message: "Pick a product or describe the item"
        })
    )
    .min(1, "Add at least one item")
});

export type PurchaseRequisitionCreateInput = z.infer<typeof purchaseRequisitionCreateSchema>;

/** Editing a PENDING requisition — requester or Super Admin only (purchase-requisition-service.ts).
 * The full line list again; a line carrying its existing `id` is kept as the same line. */
export const purchaseRequisitionUpdateSchema = z.object({
  notes: optionalText(1000),
  items: z
    .array(
      z
        .object({
          id: z.string().trim().min(1).nullable().optional(),
          productId: z.string().trim().min(1).nullable().optional(),
          itemName: z.string().trim().max(200).optional().default(""),
          quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
          notes: optionalText(300)
        })
        .refine((item) => Boolean(item.productId) || item.itemName.length > 0, {
          message: "Pick a product or describe the item"
        })
    )
    .min(1, "Add at least one item")
});

export type PurchaseRequisitionUpdateInput = z.infer<typeof purchaseRequisitionUpdateSchema>;

export const purchaseRequisitionRejectSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(500)
});

export type PurchaseRequisitionRejectInput = z.infer<typeof purchaseRequisitionRejectSchema>;

/** Links one line to a catalog product — how a free-text item becomes something purchasable (also
 * lets an approver swap a wrong pick on a catalog line). */
export const purchaseRequisitionLinkItemSchema = z.object({
  itemId: z.string().trim().min(1),
  productId: z.string().trim().min(1)
});

export type PurchaseRequisitionLinkItemInput = z.infer<typeof purchaseRequisitionLinkItemSchema>;

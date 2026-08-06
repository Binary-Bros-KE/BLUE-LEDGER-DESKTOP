import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

const nullableStorefrontId = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

/** Records new physical stock arriving at Main Store, earmarked for a storefront (or left unallocated). */
export const mainStoreReceiveSchema = z.object({
  productId: z.string().trim().min(1),
  storefrontId: nullableStorefrontId,
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
  notes: optionalText(500)
});

export type MainStoreReceiveInput = z.infer<typeof mainStoreReceiveSchema>;

/** Physically ships stock from Main Store to a storefront, or returns it from a storefront back. */
export const mainStoreTransferSchema = z.object({
  productId: z.string().trim().min(1),
  storefrontId: z.string().trim().min(1, "Select a storefront"),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
  notes: optionalText(500)
});

export type MainStoreTransferInput = z.infer<typeof mainStoreTransferSchema>;

/** Bookkeeping-only move between two Main Store allocation buckets — nothing physically relocates. */
export const mainStoreReallocateSchema = z
  .object({
    productId: z.string().trim().min(1),
    fromStorefrontId: nullableStorefrontId,
    toStorefrontId: nullableStorefrontId,
    quantity: z.coerce.number().int().positive("Quantity must be greater than 0")
  })
  .refine((data) => data.fromStorefrontId !== data.toStorefrontId, {
    message: "Choose two different buckets",
    path: ["toStorefrontId"]
  });

export type MainStoreReallocateInput = z.infer<typeof mainStoreReallocateSchema>;

/** Records damaged/lost stock at Main Store, reducing a specific bucket (unallocated or a storefront's
 * own earmarked allocation) rather than the general total. */
export const mainStoreDamageSchema = z.object({
  productId: z.string().trim().min(1),
  storefrontId: nullableStorefrontId,
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
  notes: optionalText(500)
});

export type MainStoreDamageInput = z.infer<typeof mainStoreDamageSchema>;

/** Corrects a specific bucket's stock to match what was physically counted — the delta (counted
 * minus current) is computed server-side, not entered directly, so a cashier doing a stock take
 * never has to do the subtraction themselves or risk a stale on-screen count producing the wrong
 * delta. 0 is a valid count (shelf is genuinely empty) — the .int().min(0) below deliberately allows
 * it, unlike every other main-store quantity field here which requires a positive delta. */
export const mainStoreAdjustSchema = z.object({
  productId: z.string().trim().min(1),
  storefrontId: nullableStorefrontId,
  countedQuantity: z.coerce.number().int().min(0, "Counted quantity can't be negative"),
  notes: optionalText(500)
});

export type MainStoreAdjustInput = z.infer<typeof mainStoreAdjustSchema>;

import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

const saleCartItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
  discountAmountCents: z.coerce.number().int().min(0).max(100_000_000).optional().default(0)
});

/** Shared by suspend (hold the cart) and checkout (hold + pay) — a resumed sale carries its id along. */
export const saleCartInputSchema = z.object({
  resumeSaleId: optionalText(64),
  customerId: optionalText(64),
  notes: optionalText(500),
  items: z.array(saleCartItemSchema).min(1, "Add at least one product to the cart")
});

export type SaleCartInput = z.infer<typeof saleCartInputSchema>;

export const checkoutInputSchema = saleCartInputSchema.extend({
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  paymentReference: optionalText(120),
  amountReceivedCents: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value))
});

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

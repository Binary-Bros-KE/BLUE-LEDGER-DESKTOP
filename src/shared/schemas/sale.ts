import { z } from "zod";
import { deliveryFieldSchema, serviceChargesFieldSchema } from "@shared/schemas/charges";
import { LOCAL_SOURCING_REFINEMENT_OPTS, localSourcingRequiresCost, optionalText } from "@shared/schemas/common";

const saleCartItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
  discountAmountCents: z.coerce.number().int().min(0).max(100_000_000_000).optional().default(0),
  /** Cashier-entered price override for this line only — never written back to the product's own
   * sellingPriceCents. Omitted (not just 0) means "use the product's normal/wholesale price", so
   * this can't be used to accidentally zero out a price. See prepareCart in sale-service.ts. */
  unitPriceCents: z.coerce.number().int().positive().max(100_000_000_000).optional(),
  /** See SaleItem's own doc comment (shared/types/sale.ts) — bought from another shop on the spot
   * rather than pulled from this shop's stock. localCostCents/localSupplierId are only meaningful
   * when this is true; prepareCart in sale-service.ts ignores them otherwise. A checked box requires
   * a real cost before the sale can be COMPLETED — see localSourcingRequiresCost's own doc comment —
   * but this schema is also shared by suspend (hold the cart), where it deliberately stays optional:
   * a cashier holding a part-finished sale shouldn't be blocked from saving it, only from charging
   * the customer with the cost still missing. See checkoutInputSchema's own refine below for where
   * that's actually enforced. */
  isLocallySourced: z.coerce.boolean().optional().default(false),
  localCostCents: z.coerce.number().int().min(0).max(100_000_000_000).optional(),
  localSupplierId: optionalText(64)
});

/** Shared by suspend (hold the cart) and checkout (hold + pay) — a resumed sale carries its id along.
 * serviceCharges/delivery round-trip through suspend too, since a held sale is rehydrated entirely
 * from the database on resume (see CheckoutRoute's OpenSaleDraft). */
export const saleCartInputSchema = z.object({
  resumeSaleId: optionalText(64),
  customerId: optionalText(64),
  /** A free-text label for a walk-in sale ("Scott") — see SaleRow["walk_in_name"]'s own doc comment
   * in sale-repository.ts. Only meaningful when customerId is empty; sale-service.ts clears it
   * server-side the moment a real customer is selected, so the two are never stored together. */
  walkInName: optionalText(120),
  notes: optionalText(500),
  /** Whether the "Tax Breakdown" section prints/downloads/shares on this sale — see
   * Sale["includeTaxBreakdown"]'s own doc comment. Round-trips through suspend/resume the same way
   * paymentMethodId/paymentReference already do, so a held sale doesn't lose the cashier's choice. */
  includeTaxBreakdown: z.coerce.boolean().optional().default(true),
  /** See Sale["includeBusinessInfo"]'s own doc comment — same round-trip-through-suspend/resume
   * treatment as includeTaxBreakdown above. */
  includeBusinessInfo: z.coerce.boolean().optional().default(true),
  items: z.array(saleCartItemSchema).min(1, "Add at least one product to the cart"),
  serviceCharges: serviceChargesFieldSchema,
  delivery: deliveryFieldSchema,
  /** Only ever read when the signed-in session has no assigned branch (see
   * sale-service.ts's requireActiveSession) — ignored otherwise, same as the renderer only
   * showing a storefront picker in that case. */
  locationId: optionalText(64),
  /** Only meaningful for a merely-held sale — a cashier may have already picked a payment method,
   * jotted a reference, or entered an amount before deciding to hold instead of complete, and losing
   * that on resume would be the same "everything should stay put" gap this schema already closes for
   * price overrides/discounts/delivery. checkoutInputSchema below re-declares paymentMethodId as
   * required, since actually completing a sale really does need one. */
  paymentMethodId: optionalText(64),
  paymentReference: optionalText(120),
  amountReceivedCents: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000_000_000)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value))
});

export type SaleCartInput = z.infer<typeof saleCartInputSchema>;

export const checkoutInputSchema = saleCartInputSchema
  .extend({
    paymentMethodId: z.string().trim().min(1, "Select a payment method"),
    paymentReference: optionalText(120),
    amountReceivedCents: z.coerce
      .number()
      .int()
      .min(0)
      .max(100_000_000_000)
      .nullable()
      .optional()
      .transform((value) => (value === undefined ? null : value))
  })
  // Only enforced here, not on saleCartItemSchema itself — see that field's own doc comment for why
  // holding a sale must stay exempt.
  .refine((value) => value.items.every((item) => localSourcingRequiresCost(item)), {
    message: "Enter the buying price for every item sourced from another shop before completing the sale",
    path: ["items"]
  });

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

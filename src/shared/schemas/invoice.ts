import { z } from "zod";
import { deliveryFieldSchema, serviceChargesFieldSchema } from "@shared/schemas/charges";
import { LOCAL_SOURCING_REFINEMENT_OPTS, localSourcingRequiresCost, optionalBoolean, optionalText } from "@shared/schemas/common";

const invoiceCartItemSchema = z
  .object({
    productId: z.string().trim().min(1),
    quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
    discountAmountCents: z.coerce.number().int().min(0).max(100_000_000_000).optional().default(0),
    // A cashier-entered markup/override price, same as saleCartItemSchema's own field — WITHOUT this,
    // Zod silently strips any unitPriceCents the renderer sends (z.object() drops unrecognized keys
    // by default), so an edited price would parse away invisibly and prepareCart would fall back to
    // the product's own current price. That's exactly the bug this field fixes: the invoice creation
    // form let a user type a custom price, but the created invoice always used the product's default
    // price instead.
    unitPriceCents: z.coerce.number().int().positive().max(100_000_000_000).optional(),
    // Same locally-sourced fields as saleCartItemSchema (shared/schemas/sale.ts) — an invoice is a
    // sale like any other, and a customer wanting something this shop doesn't stock is just as
    // likely to want it billed on credit as paid for on the spot. A checked box requires a real
    // cost — see localSourcingRequiresCost's own doc comment.
    isLocallySourced: z.coerce.boolean().optional().default(false),
    localCostCents: z.coerce.number().int().min(0).max(100_000_000_000).optional(),
    localSupplierId: optionalText(64),
    // Same per-line VAT-mode override as saleCartItemSchema's own field — see prepareCart's
    // taxInclusiveOverride doc comment in sale-service.ts (shared by both).
    taxInclusiveOverride: optionalBoolean()
  })
  .refine(localSourcingRequiresCost, LOCAL_SOURCING_REFINEMENT_OPTS);

const initialPaymentSchema = z.object({
  paymentMethodId: z.string().trim().min(1),
  amountCents: z.coerce.number().int().positive("Amount must be greater than 0"),
  reference: optionalText(120)
});

export const createInvoiceSchema = z
  .object({
    customerId: z.string().trim().min(1, "Select a customer"),
    transactionType: z.enum(["invoice", "wholesale_sale"]),
    dueDate: z.string().trim().min(1, "Due date is required"),
    invoiceNotes: optionalText(1000),
    /** Whether the "Tax Breakdown" section prints/downloads/shares on this invoice — see
     * Sale["includeTaxBreakdown"]'s own doc comment. */
    includeTaxBreakdown: z.coerce.boolean().optional().default(true),
    /** See Sale["includeBusinessInfo"]'s own doc comment, the identical concept. */
    includeBusinessInfo: z.coerce.boolean().optional().default(true),
    // No .min(1) here — an invoice for pure service/labour work (no physical product involved) is
    // valid on its own. The refine below is what actually enforces "there must be SOMETHING to
    // bill", accepting either products or service charges.
    items: z.array(invoiceCartItemSchema),
    initialPayment: initialPaymentSchema
      .nullable()
      .optional()
      .transform((value) => (value === undefined ? null : value)),
    serviceCharges: serviceChargesFieldSchema,
    delivery: deliveryFieldSchema,
    /** Only ever read when the signed-in session has no assigned branch (see
     * sale-service.ts's requireActiveSession) — ignored otherwise. */
    locationId: optionalText(64)
  })
  .refine((value) => value.items.length > 0 || value.serviceCharges.length > 0, {
    message: "Add at least one product or service charge",
    path: ["items"]
  });

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Same shape as create — an invoice edit re-prices the whole cart from scratch, same as
 * quotationUpdateSchema does for quotations. `initialPayment`/`locationId` are simply never read by
 * updateInvoice (a payment can't be recorded through an edit, and an invoice's storefront is fixed
 * at creation), not stripped from the schema — no value duplicating createInvoiceSchema's shape by
 * hand just to omit two unused fields. */
export const updateInvoiceSchema = createInvoiceSchema;

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const recordPaymentSchema = z.object({
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  amountCents: z.coerce.number().int().positive("Amount must be greater than 0"),
  reference: optionalText(120),
  notes: optionalText(500)
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

import { z } from "zod";
import { deliveryFieldSchema, serviceChargesFieldSchema } from "@shared/schemas/charges";
import { optionalText } from "@shared/schemas/common";

const quotationCartItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
  discountAmountCents: z.coerce.number().int().min(0).max(100_000_000).optional().default(0)
});

export const quotationCreateSchema = z
  .object({
    customerId: z.string().trim().min(1, "Select a customer"),
    validUntil: z.string().trim().min(1, "Valid-until date is required"),
    notes: optionalText(1000),
    // No .min(1) here — a quotation for pure service/labour work (no physical product involved) is
    // valid on its own. The refine below is what actually enforces "there must be SOMETHING to
    // quote", accepting either products or service charges.
    items: z.array(quotationCartItemSchema),
    serviceCharges: serviceChargesFieldSchema,
    delivery: deliveryFieldSchema,
    /** Only ever read (on CREATE) when the signed-in session has no assigned branch (see
     * sale-service.ts's requireActiveSession) — ignored otherwise, and unused on update (a
     * quotation's storefront is fixed at creation). */
    locationId: optionalText(64)
  })
  .refine((value) => value.items.length > 0 || value.serviceCharges.length > 0, {
    message: "Add at least one product or service charge",
    path: ["items"]
  });

export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;

/** Same shape as create — a draft can be edited freely until it's sent or acted on. */
export const quotationUpdateSchema = quotationCreateSchema;

export type QuotationUpdateInput = z.infer<typeof quotationUpdateSchema>;

const quotationConvertItemOverrideSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0")
});

/** Lets the user trim quantities at conversion time if the stock check comes back short. */
export const convertToSaleSchema = z.object({
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  paymentReference: optionalText(120),
  amountReceivedCents: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value)),
  quantityOverrides: z.array(quotationConvertItemOverrideSchema).optional().default([])
});

export type ConvertToSaleInput = z.infer<typeof convertToSaleSchema>;

export const convertToInvoiceSchema = z.object({
  dueDate: z.string().trim().min(1, "Due date is required"),
  quantityOverrides: z.array(quotationConvertItemOverrideSchema).optional().default([])
});

export type ConvertToInvoiceInput = z.infer<typeof convertToInvoiceSchema>;

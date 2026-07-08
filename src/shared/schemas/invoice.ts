import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

const invoiceCartItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
  discountAmountCents: z.coerce.number().int().min(0).max(100_000_000).optional().default(0)
});

const initialPaymentSchema = z.object({
  paymentMethodId: z.string().trim().min(1),
  amountCents: z.coerce.number().int().positive("Amount must be greater than 0"),
  reference: optionalText(120)
});

export const createInvoiceSchema = z.object({
  customerId: z.string().trim().min(1, "Select a customer"),
  transactionType: z.enum(["invoice", "wholesale_sale"]),
  dueDate: z.string().trim().min(1, "Due date is required"),
  invoiceNotes: optionalText(1000),
  items: z.array(invoiceCartItemSchema).min(1, "Add at least one product"),
  initialPayment: initialPaymentSchema
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value))
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const recordPaymentSchema = z.object({
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  amountCents: z.coerce.number().int().positive("Amount must be greater than 0"),
  reference: optionalText(120),
  notes: optionalText(500)
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

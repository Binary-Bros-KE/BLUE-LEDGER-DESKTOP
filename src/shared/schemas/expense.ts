import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

export const expenseInputSchema = z.object({
  expenseDate: z.string().trim().min(1, "Expense date is required"),
  categoryId: z.string().trim().min(1, "Select a category"),
  amountCents: z.coerce.number().int().positive("Amount must be greater than 0").max(100_000_000_000),
  paidBy: optionalText(150),
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  // Every expense is money leaving a real till somewhere — no "General/Head Office" catch-all.
  storefrontId: z.string().trim().min(1, "Select a storefront"),
  reference: optionalText(120),
  description: optionalText(1000),
  attachmentPath: optionalText(500)
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

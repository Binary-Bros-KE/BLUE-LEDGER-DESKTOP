import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

export const recurringBillInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  // Required so "Mark as Paid" always has everything it needs to record the expense — no
  // "Uncategorized" / "General" catch-alls that would just fail later when it's time to pay.
  categoryId: z.string().trim().min(1, "Select a category"),
  storefrontId: z.string().trim().min(1, "Select a storefront"),
  amountCents: z.coerce.number().int().positive("Amount must be greater than 0"),
  cycle: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]),
  startDate: z.string().trim().min(1, "Start date is required"),
  notes: optionalText(500)
});

export type RecurringBillInput = z.infer<typeof recurringBillInputSchema>;

export const recurringBillMarkPaidInputSchema = z.object({
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  reference: optionalText(120)
});

export type RecurringBillMarkPaidInput = z.infer<typeof recurringBillMarkPaidInputSchema>;

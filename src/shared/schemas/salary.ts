import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

const cents = z.coerce.number().int().min(0).max(1_000_000_000);

export const salaryLineItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  amountCents: z.coerce.number().int().positive("Amount must be greater than 0").max(1_000_000_000)
});

export type SalaryLineItemInput = z.infer<typeof salaryLineItemSchema>;

function sumLineItems(items: SalaryLineItemInput[]): number {
  return items.reduce((sum, item) => sum + item.amountCents, 0);
}

export const salaryInputSchema = z
  .object({
    employeeId: z.string().trim().min(1, "Select an employee"),
    payPeriod: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}$/, "Pay period must be in YYYY-MM format"),
    basicSalaryCents: cents,
    allowances: z.array(salaryLineItemSchema).optional().default([]),
    deductions: z.array(salaryLineItemSchema).optional().default([]),
    paymentMethodId: z.string().trim().min(1, "Select a payment method"),
    paymentReference: optionalText(120),
    notes: optionalText(1000)
  })
  .refine(
    (data) => data.basicSalaryCents + sumLineItems(data.allowances) - sumLineItems(data.deductions) >= 0,
    {
      message: "Net pay can't be negative — reduce the deductions",
      path: ["deductions"]
    }
  );

export type SalaryInput = z.infer<typeof salaryInputSchema>;

/** Opens a draft mid-month, before basic salary/payment method are known — e.g. to record a cash
 * advance as a deduction against pay that hasn't been calculated yet. `completeSalary` later uses
 * the full `salaryInputSchema` (net-pay-non-negative enforced then, not here — a draft's net pay is
 * expected to be negative, that's the whole point). */
export const salaryAdvanceInputSchema = z.object({
  employeeId: z.string().trim().min(1, "Select an employee"),
  payPeriod: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Pay period must be in YYYY-MM format"),
  deductions: z.array(salaryLineItemSchema).min(1, "Add at least one deduction (e.g. the advance amount)"),
  notes: optionalText(1000)
});

export type SalaryAdvanceInput = z.infer<typeof salaryAdvanceInputSchema>;

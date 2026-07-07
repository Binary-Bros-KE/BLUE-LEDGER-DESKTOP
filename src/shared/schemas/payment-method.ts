import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

export const paymentMethodInputSchema = z.object({
  name: z.string().trim().min(1, "Payment method name is required").max(100),
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(30)
    .regex(/^[A-Za-z0-9_]+$/, "Code can only contain letters, numbers, and underscores")
    .transform((value) => value.toUpperCase()),
  description: optionalText(500),
  isActive: z.boolean(),
  requiresReference: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(9999)
});

export type PaymentMethodInput = z.infer<typeof paymentMethodInputSchema>;

import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { CUSTOMER_TYPE_OPTIONS, type CustomerType } from "@shared/types/customer";

const customerTypeValues = CUSTOMER_TYPE_OPTIONS.map((option) => option.value) as [
  CustomerType,
  ...CustomerType[]
];

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(150),
  phone: z.string().trim().min(1, "Phone number is required").max(30),
  customerType: z.enum(customerTypeValues),
  email: optionalText(150),
  kraPin: optionalText(50),
  physicalAddress: optionalText(500),
  creditLimitCents: z.coerce
    .number()
    .int()
    .min(0)
    .max(100_000_000_000)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value)),
  notes: optionalText(1000)
});

export type CustomerInput = z.infer<typeof customerInputSchema>;

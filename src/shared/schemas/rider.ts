import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/;

const requiredPhone = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .max(30)
  .refine((value) => PHONE_PATTERN.test(value), "Enter a valid phone number");

const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || PHONE_PATTERN.test(value), "Enter a valid phone number");

export const riderInputSchema = z.object({
  name: z.string().trim().min(1, "Rider name is required").max(150),
  phone: requiredPhone,
  altPhone: optionalPhone,
  company: optionalText(150),
  vehicleDescription: optionalText(200)
});

export type RiderInput = z.infer<typeof riderInputSchema>;

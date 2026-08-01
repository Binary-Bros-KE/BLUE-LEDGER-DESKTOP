import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { SUPPLIER_PAYMENT_OPTION_OPTIONS, type SupplierPaymentOption } from "@shared/types/supplier";

const paymentOptionValues = SUPPLIER_PAYMENT_OPTION_OPTIONS.map((option) => option.value) as [
  SupplierPaymentOption,
  ...SupplierPaymentOption[]
];

const PHONE_PATTERN = /^[0-9+\-\s()]{7,20}$/;
const WEBSITE_PATTERN = /^https?:\/\/[^\s]+\.[^\s]+$/i;

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

const optionalEmail = z
  .string()
  .trim()
  .max(150)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || z.email().safeParse(value).success, "Enter a valid email address");

const optionalWebsite = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || WEBSITE_PATTERN.test(value), "Enter a valid website URL (starting with http:// or https://)");

export const supplierInputSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  contactPerson: optionalText(150),
  phone1: requiredPhone,
  phone2: optionalPhone,
  email: optionalEmail,
  kraPin: optionalText(50),
  website: optionalWebsite,
  country: optionalText(100),
  county: optionalText(100),
  town: optionalText(100),
  physicalAddress: optionalText(500),
  paymentOption: z.enum(paymentOptionValues),
  mpesaName: optionalText(150),
  mpesaNumber: optionalPhone,
  mpesaAlternativeNumber: optionalPhone,
  bankName: optionalText(150),
  bankAccountName: optionalText(150),
  bankAccountNumber: optionalText(60),
  creditLimitCents: z.coerce
    .number()
    .int()
    .min(0, "Credit limit can't be negative")
    .max(100_000_000)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value)),
  notes: optionalText(1000)
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

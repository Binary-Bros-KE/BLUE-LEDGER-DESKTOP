import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { BUSINESS_TYPE_OPTIONS, CURRENCY_OPTIONS, type BusinessType, type Currency } from "@shared/types/tenant";

const businessTypeValues = BUSINESS_TYPE_OPTIONS.map((option) => option.value) as [
  BusinessType,
  ...BusinessType[]
];

const currencyValues = CURRENCY_OPTIONS.map((option) => option.value) as [Currency, ...Currency[]];

export const businessProfileInputSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  businessLogoPath: optionalText(1000),
  businessRegistrationNumber: optionalText(),
  kraPin: optionalText(50),
  primaryPhone: optionalText(50),
  alternativePhone: optionalText(50),
  email: optionalText(),
  website: optionalText(),
  country: optionalText(100),
  countyState: optionalText(100),
  cityTown: optionalText(100),
  physicalAddress: optionalText(500),
  businessType: z.enum(businessTypeValues),
  currency: z.enum(currencyValues),
  ownerName: optionalText(200),
  ownerPhone: optionalText(50),
  ownerEmail: optionalText(),
  receiptHeader: optionalText(500),
  receiptFooter: optionalText(500)
});

export type BusinessProfileInput = z.infer<typeof businessProfileInputSchema>;

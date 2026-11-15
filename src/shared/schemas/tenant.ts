import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { LOGO_RATIO_OPTIONS, type LogoRatio } from "@shared/types/logo";
import { BUSINESS_TYPE_OPTIONS, CURRENCY_OPTIONS, type BusinessType, type Currency } from "@shared/types/tenant";

const businessTypeValues = BUSINESS_TYPE_OPTIONS.map((option) => option.value) as [
  BusinessType,
  ...BusinessType[]
];

const currencyValues = CURRENCY_OPTIONS.map((option) => option.value) as [Currency, ...Currency[]];

const logoRatioValues = LOGO_RATIO_OPTIONS.map((option) => option.value) as [LogoRatio, ...LogoRatio[]];

export const businessProfileInputSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  businessLogoPath: optionalText(1000),
  businessLogoRatio: z
    .enum(logoRatioValues)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
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
  vatRatePercent: z.coerce.number().min(0).max(100),
  pricesTaxInclusive: z.boolean(),
  // Mark Point (shared/lib/mark-point.ts). Optional so an older caller's save leaves it off.
  markPointEnabled: z.boolean().optional().default(false),
  markPoint: z.coerce.number().gt(1, "Mark point must be more than 1").max(100).nullable().optional().default(null),
  markPointStrict: z.boolean().optional().default(false),
  receiptHeader: optionalText(500),
  receiptFooter: optionalText(500)
}).refine((value) => !value.markPointEnabled || value.markPoint !== null, {
  message: "Enter a mark point, e.g. 1.33",
  path: ["markPoint"]
});

export type BusinessProfileInput = z.infer<typeof businessProfileInputSchema>;

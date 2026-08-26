import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { LOCATION_TYPE_OPTIONS, type LocationType } from "@shared/types/location";
import { LOGO_RATIO_OPTIONS, type LogoRatio } from "@shared/types/logo";

const locationTypeValues = LOCATION_TYPE_OPTIONS.map((option) => option.value) as [
  LocationType,
  ...LocationType[]
];

const logoRatioValues = LOGO_RATIO_OPTIONS.map((option) => option.value) as [LogoRatio, ...LogoRatio[]];

export const locationInputSchema = z.object({
  locationName: z.string().trim().min(1, "Location name is required").max(200),
  locationCode: z
    .string()
    .trim()
    .min(1, "Location code is required")
    .max(50)
    .transform((value) => value.toUpperCase()),
  locationType: z.enum(locationTypeValues),
  logoPath: optionalText(500),
  logoRatio: z
    .enum(logoRatioValues)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  phone: optionalText(50),
  alternativePhone: optionalText(50),
  email: optionalText(),
  country: optionalText(100),
  county: optionalText(100),
  city: optionalText(100),
  physicalAddress: optionalText(500),
  managerName: optionalText(200),
  managerPhone: optionalText(50),
  managerEmail: optionalText(),
  openingTime: optionalText(20),
  closingTime: optionalText(20),
  description: optionalText(1000),
  receiptHeader: optionalText(500),
  receiptFooter: optionalText(500),
  invoiceHeader: optionalText(500),
  invoiceFooter: optionalText(500),
  quotationHeader: optionalText(500),
  quotationFooter: optionalText(500),
  showProductImagesOnInvoices: z.boolean().optional().default(false),
  showProductImagesOnQuotations: z.boolean().optional().default(false),
  defaultIncludeBusinessInfo: z.boolean().optional().default(true),
  canReceiveStock: z.boolean(),
  canSellStock: z.boolean(),
  canTransferStock: z.boolean()
});

export type LocationInput = z.infer<typeof locationInputSchema>;

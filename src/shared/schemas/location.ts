import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { LOCATION_TYPE_OPTIONS, type LocationType } from "@shared/types/location";

const locationTypeValues = LOCATION_TYPE_OPTIONS.map((option) => option.value) as [
  LocationType,
  ...LocationType[]
];

export const locationInputSchema = z.object({
  locationName: z.string().trim().min(1, "Location name is required").max(200),
  locationCode: z
    .string()
    .trim()
    .min(1, "Location code is required")
    .max(50)
    .transform((value) => value.toUpperCase()),
  locationType: z.enum(locationTypeValues),
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
  canReceiveStock: z.boolean(),
  canSellStock: z.boolean(),
  canTransferStock: z.boolean()
});

export type LocationInput = z.infer<typeof locationInputSchema>;

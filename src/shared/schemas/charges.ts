import { z } from "zod";
import { optionalBoolean, optionalText } from "@shared/schemas/common";

/** Client request: a service charge's own tax classification — deliberately a SUPERSET of
 * ProductTaxType (shared/types/product.ts), adding "none". Unlike a product (which falls back to
 * the tenant's own Business Profile default the moment nothing is explicitly set — see
 * resolveProductTaxConfig, tax-calculation.ts), a service charge defaults to "none": a client's
 * VAT total only matched ours once products AND services were taxed the same way, but a fee like
 * "Labour" or "Delivery Assembly" is just as often genuinely untaxed, so nothing should be assumed
 * until the user actually picks a treatment. "vat" additionally needs taxInclusive (below) to say
 * which sub-mode; "none"/"exempted"/"zero_rated" never do. */
export const SERVICE_CHARGE_TAX_TYPE_OPTIONS = [
  { value: "none", label: "No Tax" },
  { value: "vat", label: "Standard (VAT)" },
  { value: "exempted", label: "Exempted" },
  { value: "zero_rated", label: "Zero-Rated" }
] as const;

export type ServiceChargeTaxType = (typeof SERVICE_CHARGE_TAX_TYPE_OPTIONS)[number]["value"];

const serviceChargeTaxTypeSchema = z.enum(["none", "vat", "exempted", "zero_rated"]);

/** A named custom fee (e.g. "Labour", "Installation") — unlimited per document. costCents is
 * internal-only and never printed. Shared by the sale/invoice/quotation cart schemas. */
export const serviceChargeInputSchema = z.object({
  name: z.string().trim().min(1, "Charge name is required").max(120),
  feeCents: z.coerce.number().int().min(0).max(100_000_000_000),
  costCents: z.coerce.number().int().min(0).max(100_000_000_000).optional().default(0),
  // See SERVICE_CHARGE_TAX_TYPE_OPTIONS' own doc comment — "none", not the tenant default, is the
  // deliberate default here.
  taxType: serviceChargeTaxTypeSchema.optional().default("none"),
  // Only meaningful when taxType is "vat" — which inclusive/exclusive sub-mode. optionalBoolean()
  // (not z.coerce.boolean()) for the same "explicitly false must survive, not collapse to unset"
  // reasoning as CartLine's own taxInclusiveOverride.
  taxInclusive: optionalBoolean()
});

export type ServiceChargeInput = z.infer<typeof serviceChargeInputSchema>;

/** The one optional delivery a sale/invoice/quotation can carry. costCents is internal-only and
 * never printed — see delivery-note.ts for the customer-facing document this backs. */
export const deliveryInputSchema = z.object({
  riderId: optionalText(64),
  recipientName: z.string().trim().min(1, "Recipient name is required").max(150),
  country: optionalText(100),
  town: optionalText(100),
  physicalAddress: z.string().trim().min(1, "Delivery address is required").max(500),
  notes: optionalText(500),
  feeCents: z.coerce.number().int().min(0).max(100_000_000_000),
  costCents: z.coerce.number().int().min(0).max(100_000_000_000).optional().default(0)
});

export type DeliveryInput = z.infer<typeof deliveryInputSchema>;

export const serviceChargesFieldSchema = z.array(serviceChargeInputSchema).optional().default([]);

export const deliveryFieldSchema = deliveryInputSchema
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? null : value));

/** One titled free-text block below an invoice/quotation's items (e.g. "Installation
 * Instructions") — see NotesSection's own doc comment (shared/lib/document-sections.ts). body is
 * optional (a section can exist with just a title while the user is still typing), title is not. */
export const notesSectionInputSchema = z.object({
  title: z.string().trim().min(1, "Section title is required").max(120),
  body: optionalText(4000).transform((value) => value ?? "")
});

export const notesSectionsFieldSchema = z.array(notesSectionInputSchema).max(50).optional().default([]);

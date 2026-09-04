import { z } from "zod";
import { optionalText } from "@shared/schemas/common";

/** A named custom fee (e.g. "Labour", "Installation") — unlimited per document. costCents is
 * internal-only and never printed. Shared by the sale/invoice/quotation cart schemas. */
export const serviceChargeInputSchema = z.object({
  name: z.string().trim().min(1, "Charge name is required").max(120),
  feeCents: z.coerce.number().int().min(0).max(100_000_000_000),
  costCents: z.coerce.number().int().min(0).max(100_000_000_000).optional().default(0)
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

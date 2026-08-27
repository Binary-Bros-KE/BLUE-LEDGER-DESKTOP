import { z } from "zod";
import { optionalText } from "@shared/schemas/common";
import { TAX_TYPE_OPTIONS } from "@shared/types/product";

const productTaxTypeValues = TAX_TYPE_OPTIONS.map((option) => option.value) as [string, ...string[]];

const cents = z.coerce.number().int().min(0).max(100_000_000_000);

export const purchaseItemInputSchema = z.object({
  productId: z.string().trim().min(1),
  orderedQuantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
  unitCostCents: cents,
  // Optional: when the purchase is saved as "ordered", provided lines push their new selling price
  // onto the product alongside unitCostCents — see purchase-service.ts's syncProductPricingFromOrder.
  sellingPriceCents: cents.optional(),
  discountAmountCents: cents.optional().default(0),
  // Defaults to "vat" only as a last resort (e.g. a very old client build that never sends it) —
  // the UI always pre-fills this from the product's own category. Tax is computed server-side from
  // this + the line's own cost, never taken as a client-supplied amount (see purchase-service.ts).
  taxType: z.enum(productTaxTypeValues).default("vat")
});

export type PurchaseItemInput = z.infer<typeof purchaseItemInputSchema>;

export const purchaseCreateSchema = z.object({
  supplierId: z.string().trim().min(1, "Select a supplier"),
  supplierInvoiceNumber: optionalText(100),
  locationId: z.string().trim().min(1, "Select a destination location"),
  // Whole-order freight cost, not per-line — see Purchase.shippingCostCents' own doc comment.
  shippingCostCents: cents.optional().default(0),
  notes: optionalText(1000),
  attachmentPath: optionalText(500),
  items: z.array(purchaseItemInputSchema).min(1, "Add at least one product"),
  intent: z.enum(["draft", "ordered"]).optional().default("draft")
});

export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;

export const purchaseUpdateSchema = purchaseCreateSchema;
export type PurchaseUpdateInput = z.infer<typeof purchaseUpdateSchema>;

const receiveGoodsItemSchema = z.object({
  purchaseItemId: z.string().trim().min(1),
  receivingQuantity: z.coerce.number().int().positive("Enter a quantity greater than 0")
});

export const receiveGoodsSchema = z.object({
  items: z.array(receiveGoodsItemSchema).min(1, "Enter at least one quantity to receive")
});

export type ReceiveGoodsInput = z.infer<typeof receiveGoodsSchema>;

export const recordPurchasePaymentSchema = z.object({
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  amountCents: z.coerce.number().int().positive("Amount must be greater than 0"),
  reference: optionalText(120),
  notes: optionalText(500)
});

export type RecordPurchasePaymentInput = z.infer<typeof recordPurchasePaymentSchema>;

export const markPurchasePaidSchema = z.object({
  paymentMethodId: z.string().trim().min(1, "Select a payment method"),
  reference: optionalText(120),
  notes: optionalText(500)
});

export type MarkPurchasePaidInput = z.infer<typeof markPurchasePaidSchema>;

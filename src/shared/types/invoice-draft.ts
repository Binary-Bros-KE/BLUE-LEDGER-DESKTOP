/**
 * A held, not-yet-real invoice — the Invoices equivalent of Checkout's held sales, with one hard
 * difference: a draft is LOCAL-ONLY and NEVER synced. Synced documents can't be truly deleted (the
 * cloud keeps them and other devices pull them back), and the whole point of a draft is that it can
 * be thrown away freely. So a draft lives only on the computer it was saved on, in its own table with
 * no sync triggers (see migrate.ts's invoice_drafts migration), and becomes a real, synced invoice
 * only when someone actually creates it — at which point the draft row is deleted.
 *
 * `form` is the Invoices form's own state snapshot (customer, lines, charges, delivery, sections,
 * notes...), owned and versioned by the renderer (InvoicesRoute's InvoiceDraftForm) — the main
 * process stores it as-is and never interprets it. Nothing in a draft is ever priced or validated
 * as an invoice until it's actually created through the normal createInvoice path.
 */
export type InvoiceDraftListItem = {
  id: string;
  customerId: string | null;
  /** Snapshot at save time, for the drafts list — the customer may be renamed later. */
  customerName: string | null;
  storefrontId: string | null;
  itemCount: number;
  /** Snapshot of the form's computed total at save time — display only, re-priced on create. */
  estimatedTotalCents: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceDraft = InvoiceDraftListItem & {
  form: Record<string, unknown>;
};

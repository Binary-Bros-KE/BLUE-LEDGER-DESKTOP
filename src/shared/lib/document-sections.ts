/** One titled free-text block below an invoice/quotation's items — e.g. "Installation
 * Instructions". `body` is plain multi-line text (rendered `white-space: pre-line`, same as the
 * existing plain notes field) — the user types their own "-" bullet prefixes, no rich-text editor. */
export type NotesSection = {
  title: string;
  body: string;
};

/** One named group of line items (e.g. "Lighting", "Sound") plus its own subtotal, or the implicit
 * leading group of items with no section at all (`label: null`) — rendered with no header, so a
 * document that never uses sections produces exactly one group and looks identical to a plain flat
 * list. */
export type ItemSectionGroup<T> = {
  label: string | null;
  items: T[];
  subtotalCents: number;
};

/** Groups a flat item array by `sectionLabel` in order of each label's first appearance — never
 * stored pre-grouped (see the invoice_quotation_sections migration's own doc comment), always
 * derived at render time, same "bucket by a key, in first-seen order" shape as computeTaxBreakdown
 * (tax-calculation.ts) already uses for VAT-mode grouping. Used identically by the renderer's live
 * cart preview and printer-service.ts's HTML builders so the on-screen total always matches print. */
export function groupItemsBySections<T extends { sectionLabel: string | null; lineTotalCents: number }>(
  items: T[]
): ItemSectionGroup<T>[] {
  const order: Array<string | null> = [];
  const byLabel = new Map<string | null, T[]>();
  for (const item of items) {
    const label = item.sectionLabel;
    if (!byLabel.has(label)) {
      order.push(label);
      byLabel.set(label, []);
    }
    byLabel.get(label)!.push(item);
  }
  return order.map((label) => {
    const groupItems = byLabel.get(label)!;
    return {
      label,
      items: groupItems,
      subtotalCents: groupItems.reduce((sum, item) => sum + item.lineTotalCents, 0)
    };
  });
}

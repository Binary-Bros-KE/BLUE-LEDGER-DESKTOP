/** A receipt and an invoice are both just a Sale row (distinguished server-side by whether
 * invoiceNumber is set) — the share link only needs to know which TABLE to look the id up in. */
export type ShareDocumentEntity = "sale" | "quotation";

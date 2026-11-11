/** A receipt and an invoice are both just a Sale row (distinguished server-side by whether
 * invoiceNumber is set) — the share link only needs to know which TABLE to look the id up in.
 * "customer_statement" has no table of its own either — entityId is the customerId, and SERVER
 * recomputes the statement live from that customer's invoices, same as DESKTOP does locally. */
/** "credit_note": entityId is the sale_returns id; SERVER builds the document from that return. */
export type ShareDocumentEntity = "sale" | "quotation" | "customer_statement" | "credit_note";

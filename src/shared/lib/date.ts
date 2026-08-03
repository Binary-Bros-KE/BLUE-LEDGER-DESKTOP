/** Locale-independent DD/MM/YYYY formatting for customer-facing documents (receipt/invoice/
 * quotation) — deliberately not toLocaleDateString(), which silently follows the OS's regional
 * format (a US-locale Windows install shows MM/DD/YYYY regardless of the business's own
 * convention, which is DD/MM/YYYY). Usable from both main and renderer. */
export function formatDocumentDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "-";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

/** Same as formatDocumentDate, with a time-of-day suffix — for a document's own "Date: ..." line,
 * which has always shown a timestamp rather than a bare date. */
export function formatDocumentDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "-";
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${formatDocumentDate(date)}, ${time}`;
}

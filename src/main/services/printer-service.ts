import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";
import { getPrinters as getSystemPrinters, print as printPdfToPrinter } from "pdf-to-printer";
import { getDatabase } from "@main/database/connection";
import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import * as employeeRepository from "@main/database/repositories/employee-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as productRepository from "@main/database/repositories/product-repository";
import * as quotationRepository from "@main/database/repositories/quotation-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import * as serviceChargeRepository from "@main/database/repositories/service-charge-repository";
import * as stockReceiptRepository from "@main/database/repositories/stock-receipt-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { buildRendererCsp } from "@main/security/content-security-policy";
import { requirePermission } from "@main/services/auth-service";
import {
  readManagedBusinessLogoPreview,
  readManagedLocationLogoPreview,
  readManagedProductImagePreview
} from "@main/services/image-service";
import { getSalary } from "@main/services/salary-service";
import { getCustomerStatement } from "@main/services/statement-service";
import { PRINTER_SETTINGS_STORAGE_KEY } from "@shared/constants/app";
import { formatDocumentDate } from "@shared/lib/date";
import { buildDeliveryNoteViewModel, type DeliveryNoteViewModel } from "@shared/lib/delivery-note";
import { buildReceiptViewModel, formatReceiptCents, type ReceiptViewModel } from "@shared/lib/receipt";
import { computeAddedTaxCents, computeTaxBreakdown, taxBreakdownLabel, type TaxBreakdownEntry } from "@shared/lib/tax-calculation";
import { printerSettingsSchema } from "@shared/schemas/printer";
import type { LogoRatio } from "@shared/types/logo";
import {
  DEFAULT_PRINTER_SETTINGS,
  type PrinterActionResult,
  type PrinterSettings,
  type PrinterType
} from "@shared/types/printer";
import { QUOTATION_STATUS_OPTIONS, type Quotation } from "@shared/types/quotation";
import {
  PAYMENT_STATUS_OPTIONS,
  type Sale,
  type SaleDelivery,
  type SaleServiceCharge
} from "@shared/types/sale";
import type { Salary } from "@shared/types/salary";
import type { CustomerStatementViewModel } from "@shared/types/statement";

const { app, BrowserWindow, dialog, shell } = electron;

const PRINTER_TYPE_MAP: Record<PrinterType, PrinterTypes> = {
  epson: PrinterTypes.EPSON,
  star: PrinterTypes.STAR,
  tanca: PrinterTypes.TANCA,
  daruma: PrinterTypes.DARUMA,
  brother: PrinterTypes.BROTHER,
  custom: PrinterTypes.CUSTOM
};

function loadPrinterSettings(): PrinterSettings {
  const row = getDatabase()
    .prepare("SELECT value_json FROM app_settings WHERE key = ?")
    .get(PRINTER_SETTINGS_STORAGE_KEY) as { value_json: string } | undefined;
  if (!row) return DEFAULT_PRINTER_SETTINGS;

  try {
    return { ...DEFAULT_PRINTER_SETTINGS, ...JSON.parse(row.value_json) };
  } catch {
    return DEFAULT_PRINTER_SETTINGS;
  }
}

export function getPrinterSettings(): PrinterSettings {
  requirePermission("settings", "view");
  return loadPrinterSettings();
}

export function savePrinterSettings(input: unknown): PrinterSettings {
  requirePermission("settings", "edit");
  const parsed = printerSettingsSchema.parse(input);
  const now = new Date().toISOString();

  getDatabase()
    .prepare(
      `
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `
    )
    .run(PRINTER_SETTINGS_STORAGE_KEY, JSON.stringify(parsed), now);

  return parsed;
}

function buildInterfaceString(settings: PrinterSettings): string {
  switch (settings.connectionType) {
    case "network": {
      const address = settings.address.includes(":") ? settings.address : `${settings.address}:9100`;
      return `tcp://${address}`;
    }
    case "usb":
      return `printer:${settings.address || "auto"}`;
    case "serial":
    default:
      return settings.address;
  }
}

function buildPrinter(settings: PrinterSettings): ThermalPrinter {
  return new ThermalPrinter({
    type: PRINTER_TYPE_MAP[settings.printerType] ?? PrinterTypes.EPSON,
    interface: buildInterfaceString(settings),
    width: settings.paperWidth,
    options: { timeout: 5000 }
  });
}

/** Converts the "Paper Width (characters per line)" setting into a physical PDF page width for the
 * thermal HTML->PDF print pipeline (receipt/invoice/quotation/delivery-note-via-thermal). Chromium's
 * printToPDF has no notion of "characters," only physical page dimensions — every one of those print
 * paths used to hardcode a fixed 3.15in (80mm) page regardless of this setting, which is exactly why
 * changing it never visibly changed anything. Anchored so the default (48 chars) maps to that same
 * 3.15in, preserving today's output for anyone who's never touched the setting; increasing/decreasing
 * it now scales the page width proportionally, giving a real, working lever to match whatever a
 * specific printer's actual printable width turns out to be — this varies by model/brand even among
 * printers nominally on the same 80mm roll (many only print ~72mm of it), so a single hardcoded
 * "correct" value can't fit every printer; the user dials it in by trial and error instead. */
function resolveThermalPageWidthIn(paperWidth: number): number {
  const BASELINE_CHARS = 48;
  const BASELINE_WIDTH_IN = 3.15;
  return (paperWidth / BASELINE_CHARS) * BASELINE_WIDTH_IN;
}

function loadReceiptData(saleId: string): { sale: Sale; business: DocumentBusinessInfo } {
  const saleRow = saleRepository.findSaleDetailRowById(saleId);
  if (!saleRow) {
    throw new Error("Sale not found");
  }
  const items = saleRepository.findSaleItemDetailRows(saleId).map(saleRepository.mapSaleItemDetailRow);
  const serviceCharges = serviceChargeRepository
    .findServiceChargeRowsForSale(saleId)
    .map(serviceChargeRepository.mapServiceChargeRow);
  const deliveryRow = deliveryNoteRepository.findDeliveryNoteRowBySaleId(saleId);
  const delivery = deliveryRow ? deliveryNoteRepository.mapDeliveryNoteRow(deliveryRow) : null;
  const sale = saleRepository.mapSaleDetailRow(saleRow, items, serviceCharges, delivery);

  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Business profile not found");
  }

  return {
    sale,
    business: resolveDocumentBusiness(saleRow.location_id, tenantRow)
  };
}

function writeReceiptToPrinter(printerInstance: ThermalPrinter, vm: ReceiptViewModel): void {
  const money = (cents: number | null): string => `${vm.currency} ${formatReceiptCents(cents)}`;

  printerInstance.alignCenter();
  printerInstance.bold(true);
  printerInstance.println(vm.businessName);
  printerInstance.bold(false);
  if (vm.physicalAddress) printerInstance.println(vm.physicalAddress);
  if (vm.primaryPhone) printerInstance.println(vm.primaryPhone);
  if (vm.receiptHeader) printerInstance.println(vm.receiptHeader);
  printerInstance.drawLine();

  printerInstance.alignLeft();
  printerInstance.println(`Receipt: ${vm.receiptNumber ?? "-"}`);
  printerInstance.println(`Date: ${vm.dateLabel}`);
  printerInstance.println(`Cashier: ${vm.cashierName}`);
  printerInstance.println(`Branch: ${vm.branchName}`);
  if (vm.customerName) printerInstance.println(`Customer: ${vm.customerName}`);
  printerInstance.drawLine();

  for (const item of [...vm.items, ...vm.extraLines]) {
    printerInstance.println(item.name);
    printerInstance.leftRight(`${item.quantity} x ${money(item.unitPriceCents)}`, money(item.lineTotalCents));
  }
  printerInstance.drawLine();

  printerInstance.leftRight("Subtotal", money(vm.subtotalCents));
  if (vm.discountAmountCents > 0) {
    printerInstance.leftRight("Discount", `-${money(vm.discountAmountCents)}`);
  }
  if (vm.includeTaxBreakdown && vm.addedTaxCents > 0) {
    printerInstance.leftRight("Total Tax", money(vm.addedTaxCents));
  }
  printerInstance.bold(true);
  printerInstance.leftRight("TOTAL", money(vm.grandTotalCents));
  printerInstance.bold(false);
  printerInstance.drawLine();

  if (vm.includeTaxBreakdown && vm.taxBreakdown.length > 0) {
    printerInstance.println("Tax Breakdown");
    for (const entry of vm.taxBreakdown) {
      printerInstance.leftRight(
        taxBreakdownLabel(entry.taxType, { vatRatePercent: vm.vatRatePercent, pricesTaxInclusive: true }, entry.pricingMode),
        `Net ${money(entry.netCents)} / Tax ${money(entry.taxCents)}`
      );
    }
    printerInstance.drawLine();
  }

  printerInstance.println(`Payment: ${vm.paymentMethodName ?? "-"}`);
  if (vm.paymentReference) printerInstance.println(`Ref: ${vm.paymentReference}`);
  if (vm.amountReceivedCents !== null) printerInstance.leftRight("Received", money(vm.amountReceivedCents));
  if (vm.changeGivenCents !== null && vm.changeGivenCents > 0) {
    printerInstance.leftRight("Change", money(vm.changeGivenCents));
  }
  printerInstance.drawLine();

  printerInstance.alignCenter();
  printerInstance.println(vm.receiptFooter ?? "Thank you for your business!");
  printerInstance.newLine();
  printerInstance.cut();
}

/** USB printers may legitimately leave the address blank (uses the system's default printer) —
 * only network/serial connections require an explicit address. */
function requiresExplicitAddress(settings: PrinterSettings): boolean {
  return settings.connectionType !== "usb";
}

/** "USB (System Printer Name)" targets a printer installed as a normal Windows print queue (a real
 * GDI driver, like most receipt printers ship with). Electron's own `webContents.print()` is
 * unreliable for these — Chromium's print pipeline frequently rejects non-standard-page-size (roll)
 * printer drivers with "Invalid printer settings" no matter what options are passed (a long-standing
 * Electron limitation for POS/label printers). `pdf-to-printer` sidesteps it: render the receipt to
 * PDF (the same `printToPDF` path the Download button already uses successfully) and hand it to a
 * bundled lightweight viewer that prints silently through Windows' own spooler instead of Chromium's. */
async function findSystemPrinterByName(deviceName: string): Promise<{ name: string } | undefined> {
  const printers = await getSystemPrinters();
  console.log(
    "[printer] system printers seen by pdf-to-printer:",
    printers.map((printer) => printer.name)
  );
  if (!deviceName) return printers[0];
  return printers.find((printer) => printer.name === deviceName);
}

/** Renders a full-size A4 document to PDF and sends it straight to Windows' default printer via
 * pdf-to-printer, sidestepping the same `webContents.print()` "Invalid printer settings" failure
 * fixed for receipts above — it isn't specific to the receipt's narrow page size, it's Chromium's
 * whole native print pipeline choking whenever a POS/label printer driver is involved at all. Used by
 * every "Print" button for a real-page document (invoice, quotation, delivery note): no special page
 * size needed here since these already render correctly as A4 for the Download PDF path. */
async function printHtmlViaSystemPrinter(html: string, fileLabel: string): Promise<void> {
  const buffer = await renderHtmlToPdfBuffer(html);
  const tempPath = join(app.getPath("temp"), `blue-ledger-${fileLabel}-${randomUUID()}.pdf`);
  await writeFile(tempPath, buffer);
  try {
    await printPdfToPrinter(tempPath, { silent: true });
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

async function printReceiptToSystemPrinter(vm: ReceiptViewModel, settings: PrinterSettings): Promise<void> {
  const html = buildReceiptHtml(vm);
  // Width itself is user-configurable via the Paper Width setting (see resolveThermalPageWidthIn);
  // height is measured from the actual rendered content (see renderThermalHtmlToPdfBuffer) rather
  // than a fixed guess, so there's no oversized blank gap before the printed content.
  const buffer = await renderThermalHtmlToPdfBuffer(html, resolveThermalPageWidthIn(settings.paperWidth));
  const tempPath = join(app.getPath("temp"), `blue-ledger-receipt-${randomUUID()}.pdf`);
  await writeFile(tempPath, buffer);
  try {
    // `scale: "noscale"` is the actual fix for the blank-space-above-content bug, not the page
    // height computed above — pdf-to-printer (SumatraPDF under the hood) defaults to "fit" when no
    // scale is given, which CENTERS our short custom-size PDF page within whatever paper length the
    // Windows printer driver has configured, regardless of the PDF's own declared page size. Since
    // the roll only physically feeds/cuts near where content ends, that centering shows up as a
    // large blank gap before the content with the content itself pushed toward the bottom. noscale
    // prints the PDF at its own true size with no repositioning — recommended by SumatraPDF's own
    // maintainers specifically for continuous-roll/thermal printers.
    await printPdfToPrinter(tempPath, { silent: true, scale: "noscale", ...(settings.address ? { printer: settings.address } : {}) });
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

export async function testPrinterConnection(): Promise<PrinterActionResult> {
  requirePermission("settings", "edit");
  const settings = loadPrinterSettings();
  if (requiresExplicitAddress(settings) && !settings.address) {
    return { success: false, message: "Enter a printer address first" };
  }

  if (settings.connectionType === "usb") {
    const found = await findSystemPrinterByName(settings.address);
    if (!found) {
      return settings.address
        ? { success: false, message: `No printer named "${settings.address}" was found on this device.` }
        : { success: false, message: "No printers are installed on this device." };
    }
    return { success: true, message: `Found printer: ${found.name}` };
  }

  try {
    const connected = await buildPrinter(settings).isPrinterConnected();
    return connected
      ? { success: true, message: "Printer connected successfully" }
      : { success: false, message: "Could not reach the printer at this address" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to connect to printer" };
  }
}

/** Sends the receipt to the configured printer — a named Windows print queue for "usb" connections,
 * or straight ESC/POS bytes for network/serial thermal printers. */
export async function printReceipt(saleId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  const settings = loadPrinterSettings();
  if (!settings.enabled || (requiresExplicitAddress(settings) && !settings.address)) {
    return { success: false, message: "No printer is configured yet. Set one up in Settings." };
  }

  const { sale, business } = loadReceiptData(saleId);
  const viewModel = buildReceiptViewModel(sale, business);

  if (settings.connectionType === "usb") {
    try {
      await printReceiptToSystemPrinter(viewModel, settings);
      return { success: true, message: "Receipt sent to printer" };
    } catch (err) {
      console.error("[printer] printReceipt (usb) failed", err);
      return { success: false, message: err instanceof Error ? err.message : "Failed to print receipt" };
    }
  }

  const printerInstance = buildPrinter(settings);
  try {
    const connected = await printerInstance.isPrinterConnected();
    if (!connected) {
      return { success: false, message: "Could not connect to the printer. Check the connection and try again." };
    }
    writeReceiptToPrinter(printerInstance, viewModel);
    await printerInstance.execute();
    return { success: true, message: "Receipt sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print receipt" };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The tax breakdown table every document template renders below its main totals — tax never
 * contributes to the total (see tax-calculation.ts), this is the one place it's actually shown, as
 * required by law. Shared across every template below so the wording/column order never drifts;
 * each caller supplies its own `money` formatter and `tableClass` (matching whatever CSS class its
 * own <style> block already defines for a bordered table) so it fits that template's own visual
 * system. Returns "" when there's nothing to show (should never happen for a real document, but a
 * defensive empty state is cheap). */
function buildTaxBreakdownHtml(
  breakdown: TaxBreakdownEntry[],
  vatRatePercent: number,
  money: (cents: number) => string,
  tableClass: string
): string {
  if (breakdown.length === 0) return "";
  const rows = breakdown
    .map(
      (entry) => `
      <tr>
        <td>${escapeHtml(taxBreakdownLabel(entry.taxType, { vatRatePercent, pricesTaxInclusive: true }, entry.pricingMode))}</td>
        <td class="right">${money(entry.netCents)}</td>
        <td class="right">${money(entry.taxCents)}</td>
        <td class="right">${money(entry.grossCents)}</td>
      </tr>`
    )
    .join("");
  return `
    <p class="tax-breakdown-title">Tax Breakdown</p>
    <table class="${tableClass}">
      <thead>
        <tr><th>Category</th><th class="right">Net</th><th class="right">Tax</th><th class="right">Gross</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Renders for an actual 80mm thermal roll (full-bleed width, tight padding, bold text — thermal
 * printheads burn regular-weight anti-aliased text too faintly to register reliably) — used ONLY
 * when printing straight to a system/USB thermal printer. The Download PDF / share-link version is a
 * completely different, full letterhead-style document (see buildReceiptLetterheadHtml below),
 * matching the rest of the document family instead of looking like a till receipt. */
function buildReceiptHtml(vm: ReceiptViewModel): string {
  const money = (cents: number | null): string => `${vm.currency} ${formatReceiptCents(cents)}`;

  const itemRows = [...vm.items, ...vm.extraLines]
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="center">${item.quantity}</td>
        <td class="right">${money(item.unitPriceCents)}</td>
        <td class="right">${money(item.lineTotalCents)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, 'Segoe UI', Helvetica, sans-serif; color: #000; margin: 0; padding: 1px 2px; font-size: 11px; font-weight: 700; }
  .receipt { max-width: 100%; margin: 0 auto; border: 2px solid #000; padding: 3px; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #000; font-size: 10px; }
  hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  table.items { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }
  table.items th, table.items td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
  table.items th { background: #d9d9d9; text-transform: uppercase; font-size: 9px; text-align: left; }
  .center { text-align: center; }
  .right { text-align: right; white-space: nowrap; }
  table.totals { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
  table.totals td { border: 1px solid #000; padding: 3px 6px; }
  table.totals td.label { background: #d9d9d9; font-weight: bold; }
  table.totals tr.grand td { font-size: 12.5px; font-weight: bold; }
  .tax-breakdown-title { margin: 6px 0 2px; font-size: 9px; text-transform: uppercase; font-weight: bold; }
</style>
</head>
<body>
  <div class="receipt">
    <h1>${escapeHtml(vm.businessName)}</h1>
    ${vm.physicalAddress ? `<p class="center muted">${escapeHtml(vm.physicalAddress)}</p>` : ""}
    ${vm.primaryPhone ? `<p class="center muted">${escapeHtml(vm.primaryPhone)}</p>` : ""}
    ${vm.receiptHeader ? `<p class="center muted">${escapeHtml(vm.receiptHeader)}</p>` : ""}
    <hr/>
    <p class="muted">
      Receipt: ${escapeHtml(vm.receiptNumber ?? "-")}<br/>
      Date: ${escapeHtml(vm.dateLabel)}<br/>
      Cashier: ${escapeHtml(vm.cashierName)} &middot; Branch: ${escapeHtml(vm.branchName)}
      ${vm.customerName ? `<br/>Customer: ${escapeHtml(vm.customerName)}` : ""}
    </p>
    <table class="items">
      <thead>
        <tr>
          <th>Item Description</th>
          <th class="center">Qty</th>
          <th class="right">Unit Price</th>
          <th class="right">Sub Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <table class="totals">
      <tr><td class="label">Subtotal</td><td class="right">${money(vm.subtotalCents)}</td></tr>
      ${vm.discountAmountCents > 0 ? `<tr><td class="label">Discount</td><td class="right">-${money(vm.discountAmountCents)}</td></tr>` : ""}
      ${vm.includeTaxBreakdown && vm.addedTaxCents > 0 ? `<tr><td class="label">Total Tax</td><td class="right">${money(vm.addedTaxCents)}</td></tr>` : ""}
      <tr class="grand"><td class="label">Total</td><td class="right">${money(vm.grandTotalCents)}</td></tr>
    </table>
    ${vm.includeTaxBreakdown ? buildTaxBreakdownHtml(vm.taxBreakdown, vm.vatRatePercent, (cents) => money(cents), "items") : ""}
    <hr/>
    <p class="muted">
      Payment: ${escapeHtml(vm.paymentMethodName ?? "-")}
      ${vm.paymentReference ? `<br/>Ref: ${escapeHtml(vm.paymentReference)}` : ""}
      ${vm.amountReceivedCents !== null ? `<br/>Received: ${money(vm.amountReceivedCents)}` : ""}
      ${vm.changeGivenCents !== null && vm.changeGivenCents > 0 ? `<br/>Change: ${money(vm.changeGivenCents)}` : ""}
    </p>
    <hr/>
    <p class="center muted">${escapeHtml(vm.receiptFooter ?? "Thank you for your business!")}</p>
  </div>
</body>
</html>`;
}

/** Shared by buildReceiptLetterheadHtml/buildInvoiceHtml/buildQuotationHtml — one CSS block instead
 * of three independently-copy-pasted ones, so a future tweak is one edit here instead of three (kept
 * in sync by hand with SERVER's own identical copy in document-html.ts — no code sharing is possible
 * across the Electron-main/Express runtime boundary).
 *
 * The bordered `.items-frame` is the actual point of this redesign — field feedback asked for a
 * printed-form look where the item table's rectangle fills most of the page even with only one line
 * item, not a short table floating in a lot of blank space. `min-height` on the frame plus a
 * `flex: 1` spacer between the item rows and the totals table (itself pinned to the bottom via
 * `margin-top: auto`) achieves that with plain flexbox.
 *
 * That flex treatment is now applied CONDITIONALLY, via a `.fill-page` modifier class added at
 * render time (see renderHtmlToPdfBuffer/DESKTOP and renderHtmlToPdf/SERVER) only once the frame's
 * own natural (unpadded) content height is measured and confirmed to genuinely fit under 500px —
 * NOT unconditionally in the template. A real multi-page invoice (any document whose item table
 * needs more than one physical page) surfaced a serious bug when this was unconditional: Electron's
 * `webContents.printToPDF` (its native print-preview pipeline, a different code path from the
 * headless CDP `Page.printToPDF` Puppeteer/SERVER's own PDF pipeline uses) does not reliably
 * fragment a `display:flex` container across more than one physical page — content beyond the first
 * page silently got dropped, not just visually misplaced. Reproduced with a throwaway
 * puppeteer+pdfjs-dist script: SERVER's own CDP-based pipeline paginated a 90-item invoice across 4
 * pages with every item intact; the same HTML through Electron's printToPDF cut off partway through
 * page 2 for any document actually needing to fragment the frame. The safe fix is to only ever force
 * `min-height: 500px` (via flex) when we've confirmed the content is already short enough that no
 * fragmentation is needed — a document that already needs 2+ pages doesn't need the "fills the page"
 * cosmetic anyway, since it's already filling multiple pages with real content, and letting it fall
 * back to a plain block box means Chromium's ordinary (reliable) block/table pagination handles it
 * instead. 500px itself was tuned against a real 7-item invoice with BOTH a Payments Made table and a
 * Tax Breakdown table rendered below the frame (not counted in the frame's own height) — fits one A4
 * page with a comfortable margin; 640px was tried first and overflowed that same scenario onto a 2nd
 * page, 420px left more blank space than necessary.
 *
 * `.bill-to`/`.doc-vat`/`.payment-terms` are the three pieces extracted OUT of the old flex `.meta`
 * row (per field feedback: drop the redundant Storefront/Transaction-Type fields, move Bill-To above
 * the info block, and add a computed payment-terms line) — `table.meta-table` is what `.meta` became:
 * a real bordered table with a shaded header row instead of stacked label/value blocks, one row of
 * values (Invoice Date / Due Date / Issued By / Your VAT No. for an invoice), matching the reference
 * layout's own info-row table. */
const LETTERHEAD_STYLES = `
  * { box-sizing: border-box; }
  /* Every border in this file is the same 1.5px/#4b5563 — was a mix of 1px/1.3px at various points.
     A hairline width that thin risks landing on a fractional pixel once Chromium rasterizes the page
     (worse on the table's own OUTER right edge specifically, confirmed live: it visibly thinned out
     to near-invisible at some zoom levels while the same table's other edges stayed crisp) — a real
     anti-aliasing artifact of the border's own sub-pixel position, not just a display quirk, so it
     would show up printed too, not only on screen. 1.5px is comfortably thick enough to survive that
     rounding at any zoom or print DPI. */
  /* No body padding — edge whitespace on every page now comes entirely from renderHtmlToPdfBuffer's
     own real print margins (all four sides), not from CSS padding on this box. CSS padding on a tall
     element that fragments across a physical page break is NOT guaranteed to keep providing left/right
     whitespace on continuation pages in Electron's print pipeline — confirmed live: page 2+ of a real
     multi-page invoice rendered its tables edge-to-edge with no side margin at all, while page 1 (never
     fragmented, so nothing exposed the bug) looked correct. A real print margin is enforced by Chromium
     per-PAGE, independent of content fragmentation, so it can't have this failure mode. */
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1710; margin: 0; padding: 0; font-size: 12px; }
  /* max-width was 720px — right at (very slightly over) the ~717px actually available on an A4 page
     once the 0.4in print margins on each side are subtracted, leaving zero slack. With no margin for
     error, the rightmost border (wherever a table/frame's own right edge landed) got clipped by a
     hair by the page's own boundary — thin/faint rather than a normal 1.5px line, and thickening the
     border itself didn't fix it since a border partially outside the printable area is still only
     partially rendered no matter how wide it's declared. 700px leaves real headroom so this can't
     recur even if the margin-to-pixel conversion rounds slightly differently than expected. */
  .sheet { max-width: 700px; margin: 0 auto; }
  .header { border-bottom: 1.5px solid #4b5563; }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
  .logo { display: block; height: auto; max-height: 60px; width: auto; max-width: 200px; object-fit: contain; margin-bottom: 6px; }
  .business-name { font-size: 19px; font-weight: bold; color: #1c1710; margin: 0; }
  .muted { color: #555; font-size: 11px; }
  .invoice-title, .doc-title { font-size: 27px; font-weight: bold; text-align: right; color: #1c1710; margin: 0; letter-spacing: 1.5px; }
  .badge { display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: bold; text-transform: uppercase; background: #f1ede1; color: #1c1710; }

  /* Sits inside .header, below .header-row but ABOVE the header's own border-bottom rule — so it
     reads as "on the line", matching the reference layout, not floating below it. margin-bottom is
     deliberately small (not the header-row/doc-vat gap's own 14px) — that gap collapses fine with
     header-row's margin-bottom above it, but a comparable gap BELOW would visually separate this
     text from the rule it's meant to sit on. */
  .doc-vat { margin: 10px 0 3px; font-size: 10px; font-style: italic; color: #555; }
  .bill-to { margin-top: 12px; }
  .bill-to .label { font-size: 9px; text-transform: uppercase; color: #83795f; font-weight: bold; }
  .bill-to .name { font-size: 13px; font-weight: bold; margin: 2px 0 0; }

  table.meta-table { width: 100%; border-collapse: collapse; margin-top: 8px; border: 1.5px solid #4b5563; }
  table.meta-table th { background: #f0f0f0; color: #1c1710; text-transform: uppercase; font-size: 9px; font-weight: bold; padding: 6px 8px; text-align: left; border-bottom: 1.5px solid #4b5563; }
  table.meta-table th + th, table.meta-table td + td { border-left: 1.5px solid #4b5563; }
  table.meta-table td { padding: 6px 8px; font-size: 11px; font-weight: 600; }
  .payment-terms { margin-top: 8px; font-size: 10.5px; font-style: italic; color: #555; }

  /* box-decoration-break: clone — without it, a browser only draws a bordered block's border at the
     very start of its first page-fragment and the very end of its last, leaving every fragment in
     between (and the fragment edges themselves) with no border at all: the box looks like it's been
     cut open rather than continuing on the next page. clone makes EVERY fragment get the box's full
     border independently, so a table that spans a page break reads as two complete, closed boxes —
     matching how the item table's own <thead> already repeats itself on each new page. */
  .items-frame { border: 1.5px solid #4b5563; margin-top: 12px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .items-frame.fill-page { display: flex; flex-direction: column; min-height: 500px; }
  table.items-table { width: 100%; border-collapse: collapse; }
  table.items-table th { text-align: left; font-size: 10px; text-transform: uppercase; font-weight: bold; padding: 7px 8px; border-bottom: 1.5px solid #4b5563; background: #f0f0f0; }
  table.items-table th + th, table.items-table td + td { border-left: 1.5px solid #4b5563; }
  table.items-table td { padding: 7px 8px; vertical-align: top; font-size: 11px; border-bottom: 1.5px solid #4b5563; }
  .items-spacer { flex: 1 1 auto; }
  .center { text-align: center; }
  .right { text-align: right; white-space: nowrap; }

  table.totals-table { width: 100%; border-collapse: collapse; margin-top: auto; border-top: 1.5px solid #4b5563; }
  table.totals-table td { padding: 5px 8px; font-size: 11px; }
  table.totals-table td:first-child { text-align: left; font-weight: bold; width: 70%; }
  table.totals-table td:last-child { text-align: right; }
  table.totals-table tr.grand td { font-weight: bold; font-size: 13px; border-top: 1.5px solid #4b5563; }
  table.totals-table tr.balance td { font-weight: bold; font-size: 13px; color: #ad3a29; }

  .tax-breakdown-title { margin-top: 16px; font-size: 10px; text-transform: uppercase; color: #83795f; font-weight: bold; }
  table.tax-breakdown { width: 100%; border-collapse: collapse; margin-top: 6px; border: 1.5px solid #4b5563; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  table.tax-breakdown th { font-size: 10px; text-transform: uppercase; font-weight: bold; padding: 6px 8px; border-bottom: 1.5px solid #4b5563; background: #f0f0f0; text-align: left; }
  table.tax-breakdown th + th, table.tax-breakdown td + td { border-left: 1.5px solid #4b5563; }
  table.tax-breakdown td { padding: 5px 8px; font-size: 11px; }

  .payment { margin-top: 16px; }
  .payment p { margin: 2px 0; }
  .notes { margin-top: 16px; padding: 10px 12px; background: #f1ede1; border-radius: 4px; }
  .terms { margin-top: 14px; font-size: 11px; color: #666; }
  .signatures { display: flex; gap: 40px; margin-top: 48px; }
  .signature { flex: 1; }
  .signature .line { border-top: 1.5px solid #4b5563; margin-top: 40px; padding-top: 4px; font-size: 11px; color: #83795f; }
  .footer { margin-top: 20px; text-align: center; color: #83795f; font-size: 11px; }
  .item-cell { display: flex; align-items: center; gap: 8px; }
  .item-thumb { width: 96px; height: 96px; object-fit: contain; border-radius: 4px; flex: none; background: #f1ede1; }
`;

/** Letterhead-style receipt for the Download PDF / share-link path — same visual family as the
 * invoice/quotation/statement documents (buildInvoiceHtml etc.), not the narrow thermal-roll look
 * above. Deliberately a simpler 5-column item table (no per-item discount/tax/SKU) — ReceiptViewModel
 * itself never carries that detail (see shared/lib/receipt.ts), so this shows only what's really
 * there rather than fabricating columns an invoice happens to have. */
function buildReceiptLetterheadHtml(vm: ReceiptViewModel, logo: DocumentLogo): string {
  const money = (cents: number | null): string => (cents === null ? "-" : `${vm.currency} ${formatReceiptCents(cents)}`);

  const itemRows = [...vm.items, ...vm.extraLines]
    .map(
      (item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.name)}</td>
        <td class="center">${item.quantity}</td>
        <td class="right">${money(item.unitPriceCents)}</td>
        <td class="right">${money(item.lineTotalCents)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${LETTERHEAD_STYLES}</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="header-row">
        <div>
          ${logo.logoDataUrl ? `<img src="${logo.logoDataUrl}" class="logo" alt="" />` : ""}
          <p class="business-name">${escapeHtml(vm.businessName)}</p>
          ${vm.physicalAddress ? `<p class="muted">${escapeHtml(vm.physicalAddress)}</p>` : ""}
          ${vm.primaryPhone ? `<p class="muted">${escapeHtml(vm.primaryPhone)}</p>` : ""}
          ${vm.receiptHeader ? `<p class="muted">${escapeHtml(vm.receiptHeader)}</p>` : ""}
        </div>
        <div>
          <p class="invoice-title">RECEIPT</p>
          <p class="muted" style="text-align:right;">${escapeHtml(vm.receiptNumber ?? "-")}</p>
        </div>
      </div>
    </div>

    <div class="bill-to">
      <p class="label">Sold To</p>
      <p class="name">${escapeHtml(vm.customerName ?? "Walk-in Customer")}</p>
    </div>

    <table class="meta-table">
      <thead>
        <tr><th>Date</th><th>Served By</th></tr>
      </thead>
      <tbody>
        <tr><td>${escapeHtml(vm.dateLabel)}</td><td>${escapeHtml(vm.cashierName)}</td></tr>
      </tbody>
    </table>

    <div class="items-frame">
      <table class="items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Product</th>
            <th class="center">Qty</th>
            <th class="right">Unit Price</th>
            <th class="right">Line Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="items-spacer"></div>
      <table class="totals-table">
        <tr><td>Subtotal</td><td>${money(vm.subtotalCents)}</td></tr>
        ${vm.discountAmountCents > 0 ? `<tr><td>Discount</td><td>-${money(vm.discountAmountCents)}</td></tr>` : ""}
        ${vm.includeTaxBreakdown && vm.addedTaxCents > 0 ? `<tr><td>Total Tax</td><td>${money(vm.addedTaxCents)}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td>${money(vm.grandTotalCents)}</td></tr>
      </table>
    </div>

    ${vm.includeTaxBreakdown ? buildTaxBreakdownHtml(vm.taxBreakdown, vm.vatRatePercent, (cents) => money(cents), "tax-breakdown") : ""}

    <div class="payment">
      <p class="label" style="font-size:10px;text-transform:uppercase;color:#83795f;font-weight:bold;">Payment</p>
      <p>${escapeHtml(vm.paymentMethodName ?? "-")}</p>
      ${vm.paymentReference ? `<p>Ref: ${escapeHtml(vm.paymentReference)}</p>` : ""}
      ${vm.amountReceivedCents !== null ? `<p>Received: ${money(vm.amountReceivedCents)}</p>` : ""}
      ${vm.changeGivenCents !== null && vm.changeGivenCents > 0 ? `<p>Change: ${money(vm.changeGivenCents)}</p>` : ""}
    </div>

    <div class="footer">${escapeHtml(vm.receiptFooter ?? "Thank you for your business!")}</div>
  </div>
</body>
</html>`;
}

async function renderHtmlToPdfBuffer(
  html: string,
  options?: { landscape?: boolean; pageSize?: Electron.PrintToPDFOptions["pageSize"]; margins?: Electron.Margins }
): Promise<Buffer> {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString("base64")}`);
    // Only ever adds `.fill-page` (the flex/min-height treatment — see LETTERHEAD_STYLES's own doc
    // comment) once fonts have settled AND the frame's real content is confirmed short enough that
    // forcing it to 500px can't possibly require fragmentation. This is the actual fix for content
    // silently getting cut off on any document whose item table needed to span more than one physical
    // page: Electron's printToPDF cannot reliably fragment a flex container across pages, so a
    // document that's already going to need 2+ pages must never be flex in the first place — it's
    // left as a plain block/border, and Chromium's ordinary (reliable) block/table pagination takes
    // over instead. A no-op for document templates with no `.items-frame` at all (payslip/delivery
    // note/stock receipt use their own layouts).
    await win.webContents.executeJavaScript(`
      document.fonts.ready.then(function () {
        var frame = document.querySelector(".items-frame");
        if (frame && frame.getBoundingClientRect().height < 500) frame.classList.add("fill-page");
        return document.body.offsetHeight;
      });
    `);
    return await win.webContents.printToPDF({
      printBackground: true,
      landscape: options?.landscape ?? false,
      // Defaults to true A4, not printToPDF's own Letter/"default"-margin default — every non-thermal
      // document builder (receipt/invoice/quotation/payslip/stock-receipt/statement/delivery-note)
      // calls this with no options at all, so they were all silently rendering on US Letter paper
      // while SERVER's puppeteer pipeline for the same documents already renders true A4
      // (`page.pdf({ format: "a4" })`, document-html.ts).
      pageSize: options?.pageSize ?? "A4",
      // Real print margins on all four sides, not CSS body padding — LETTERHEAD_STYLES' `body` rule
      // now has NO padding at all; see its own doc comment for why (CSS padding on a fragmented box
      // isn't guaranteed to keep providing left/right whitespace on continuation pages in Electron's
      // print pipeline — confirmed live: page 2 of a real multi-page invoice rendered edge-to-edge).
      // 0.4in on every side ≈ the 40px this used to be, applied via Chromium's own per-page margin
      // mechanism instead, which can't have that failure mode. Despite PrintToPDFOptions.margins' own
      // doc comment saying "in pixels", it's actually inches (same unit pageSize's custom Size object
      // uses, and confirmed by Electron's own margin-vs-pageSize validation rejecting anything that
      // isn't inches-scale — a genuinely wrong doc comment, not a mistake here).
      margins: options?.margins ?? { marginType: "custom", top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      // Centered "Page N out of total" footer on every document — Electron exposes the same
      // header/footer template mechanism Puppeteer/CDP does. headerTemplate is set to an empty span
      // rather than left unset: displayHeaderFooter defaults to showing BOTH, and an unset
      // headerTemplate falls back to Chromium's own default (date/title/URL), not nothing.
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#83795f;text-align:center;">Page <span class="pageNumber"></span> out of <span class="totalPages"></span></div>'
    });
  } finally {
    win.destroy();
  }
}

/** In-memory only — a preview is single-window, single-session, and never needs to survive the app
 * restarting, so there's no reason to touch disk until the user actually asks to print or download.
 * Keyed by a random id that only this process ever hands out (via the hash it loads the preview
 * window with), so nothing else can address an entry. Cleared when its window closes. */
const pdfPreviewRegistry = new Map<string, { buffer: Buffer; filename: string; title: string }>();

/** Opens a rendered PDF in its own dedicated window instead of forcing a save-dialog-then-locate-
 * then-open-externally round trip — field feedback specifically asked for an in-app way to just SEE
 * a document immediately.
 *
 * Chromium's own native PDF viewer (`webPreferences.plugins: true`) was the first thing tried here —
 * it produced nothing but a black screen with no error (did-finish-load fired clean, did-fail-load
 * never fired), and turned out to be a genuinely long-standing, unfixed weakness in Electron itself
 * (spanning years of open GitHub issues; Electron's own official replacement package,
 * @electron/pdf-viewer, was archived/abandoned in Feb 2021). This function instead opens a SECOND
 * instance of our own renderer bundle — same pattern as billing-pesapal-service.ts's
 * openPesapalCheckout for an isolated window, but pointed at ourselves rather than a third party —
 * navigated to a `#/pdf-preview/<id>` hash that main.tsx checks before deciding whether to boot the
 * full app shell or a lightweight PdfPreviewApp that renders the PDF itself via pdfjs-dist onto a
 * canvas. The `id` only keys an in-memory buffer (see pdfPreviewRegistry above); the PDF bytes are
 * fetched over the same IPC bridge (window.blueLedger.printer.getPdfPreviewData) the rest of the app
 * already uses, not written to disk. Own `partition` keeps this window OUT of the main window's
 * session, matching every other secondary window this app opens. */
export async function openPdfPreviewWindow(pdfBuffer: Buffer, suggestedFilename: string, windowTitle: string): Promise<void> {
  const previewId = randomUUID();
  pdfPreviewRegistry.set(previewId, { buffer: pdfBuffer, filename: suggestedFilename, title: windowTitle });

  const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL);

  const previewWindow = new BrowserWindow({
    width: 900,
    height: 1000,
    minWidth: 640,
    minHeight: 600,
    title: windowTitle,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), "out/preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: "pdf-preview"
    }
  });

  // Own session (via `partition` above), so this does NOT inherit main-window.ts's CSP injection —
  // applied again here explicitly rather than relying on that, both for defense-in-depth (this window
  // loads our own trusted bundle either way) and because pdfjs-dist's worker asset must load under it.
  previewWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [buildRendererCsp(isDev)]
      }
    });
  });
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const hash = `/pdf-preview/${previewId}`;
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await previewWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`);
  } else {
    await previewWindow.loadFile(join(app.getAppPath(), "out/renderer/index.html"), { hash });
  }
  previewWindow.maximize();
  previewWindow.show();

  previewWindow.on("closed", () => {
    pdfPreviewRegistry.delete(previewId);
  });
}

/** Renderer-side counterpart of openPdfPreviewWindow — PdfPreviewApp calls this once on mount to fetch
 * the actual bytes for the id its own `#/pdf-preview/<id>` hash was opened with. Base64 over IPC
 * (rather than a raw Buffer/Uint8Array) is deliberate: contextBridge's structured-clone boundary
 * handles plain strings unambiguously, where a Node Buffer arriving in the renderer would need its own
 * re-wrapping anyway. Null means the window somehow outlived its registry entry (e.g. a reload after
 * the app restarted) — the caller shows an error instead of throwing. */
export function getPdfPreviewData(previewId: string): { data: string; filename: string; title: string } | null {
  const entry = pdfPreviewRegistry.get(previewId);
  if (!entry) return null;
  return { data: entry.buffer.toString("base64"), filename: entry.filename, title: entry.title };
}

/** The preview window's own Print button — reuses the exact same pdf-to-printer pipeline every other
 * "Print" action in this file already relies on (see printHtmlViaSystemPrinter's own reasoning: this
 * sidesteps webContents.print()'s "Invalid printer settings" failures against real POS/label printer
 * drivers), just skipping the HTML-render step since the buffer already exists in the registry. */
export async function printPdfPreview(previewId: string): Promise<PrinterActionResult> {
  const entry = pdfPreviewRegistry.get(previewId);
  if (!entry) return { success: false, message: "This preview has expired — close the window and open it again." };

  const tempPath = join(app.getPath("temp"), `blue-ledger-preview-print-${randomUUID()}.pdf`);
  await writeFile(tempPath, entry.buffer);
  try {
    await printPdfToPrinter(tempPath, { silent: true });
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print" };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

/** The preview window's own Download button — identical save-dialog tail every generate*Pdf function
 * already used before this feature existed, just fed from the registry's buffer instead of a fresh
 * render. */
export async function downloadPdfPreview(previewId: string): Promise<PrinterActionResult> {
  const entry = pdfPreviewRegistry.get(previewId);
  if (!entry) return { success: false, message: "This preview has expired — close the window and open it again." };

  const result = await dialog.showSaveDialog({
    title: "Save PDF",
    defaultPath: entry.filename,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) return { success: false, message: "Cancelled" };

  await writeFile(result.filePath, entry.buffer);
  return { success: true, message: `Saved to ${result.filePath}` };
}

/** Renders HTML to a PDF sized EXACTLY to its own content, for continuous-roll thermal printing.
 * Every thermal document used to pass a generic fixed page height (11in/11.69in, picked as a
 * generous ceiling so nothing would ever clip) — but nothing ever trimmed that back down to the
 * actual content height, so a receipt/invoice/quotation that only needed 4in left ~7in of blank
 * page. The Windows driver then centers/pads that short content within the declared page length,
 * printing a huge blank gap before the content — one that grows worse the wider the page gets,
 * since a wider page reflows the SAME content into fewer/shorter lines (exactly what got reported).
 *
 * Fix: measure the real rendered content height, then generate the PDF at exactly that height. The
 * FIRST attempt at this sized the hidden BrowserWindow itself to the target width in pixels
 * (`width: Math.round(widthIn * 96)`) hoping on-screen layout would then match what printToPDF
 * renders — it didn't: Windows' own window sizing doesn't translate 1:1 into CSS layout pixels (DPI
 * scaling, `useContentSize` quirks on a window that's never shown), and the mismatch grew WORSE the
 * wider the target width, up to genuinely under-measuring a long receipt's height enough to spill
 * it onto a second physical print. Fixed properly here by forcing the width via CSS `in` units
 * instead — an absolute, DPI-independent unit (1in is ALWAYS exactly 96px by the CSS spec, on any
 * display) that both this on-screen measurement pass and printToPDF's own internal print-layout
 * pass interpret identically, with no OS window-sizing step in between to drift. */
async function renderThermalHtmlToPdfBuffer(html: string, widthIn: number): Promise<Buffer> {
  const sizedHtml = html.replace("<head>", `<head><style>html, body { width: ${widthIn}in !important; }</style>`);
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(sizedHtml).toString("base64")}`);
    const contentHeightPx = (await win.webContents.executeJavaScript("document.documentElement.scrollHeight")) as number;
    // Padded by 0.25in (not a token 0.1in) deliberately: under-measuring even slightly means real
    // content overflows onto a second physical print (the exact regression this fix addresses), so
    // this errs generous — a little extra blank paper is a far smaller cost than a split receipt.
    // Floor of widthIn (not just some small minimum) guarantees the page is never wider than it is
    // tall — a landscape-shaped page is what caused an earlier, separate sideways-print bug.
    const heightIn = Math.max(widthIn + 0.25, contentHeightPx / 96 + 0.25);
    return await win.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: { width: widthIn, height: heightIn },
      margins: { marginType: "none" }
    });
  } finally {
    win.destroy();
  }
}

/** Renders the receipt to PDF and prompts the user for a save location. Returns the saved path, or null if cancelled. */
export async function generateReceiptPdf(saleId: string): Promise<string | null> {
  requirePermission("sales", "view");
  const { sale, business } = loadReceiptData(saleId);
  const viewModel = buildReceiptViewModel(sale, business);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(sale.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildReceiptLetterheadHtml(viewModel, logo);
  const buffer = await renderHtmlToPdfBuffer(html);

  const result = await dialog.showSaveDialog({
    title: "Save Receipt",
    defaultPath: `Receipt-${viewModel.receiptNumber ?? saleId}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  await writeFile(result.filePath, buffer);
  return result.filePath;
}

/** Opens the receipt in a preview window instead of prompting for a save location — see
 * openPdfPreviewWindow's own doc comment. Same data-loading/HTML-build as generateReceiptPdf. */
export async function previewReceiptPdf(saleId: string): Promise<void> {
  requirePermission("sales", "view");
  const { sale, business } = loadReceiptData(saleId);
  const viewModel = buildReceiptViewModel(sale, business);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(sale.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildReceiptLetterheadHtml(viewModel, logo);
  const buffer = await renderHtmlToPdfBuffer(html);
  const filename = `Receipt-${viewModel.receiptNumber ?? saleId}.pdf`;
  await openPdfPreviewWindow(buffer, filename, `Receipt ${viewModel.receiptNumber ?? saleId}`);
}

function paymentStatusLabel(status: Sale["paymentStatus"]): string {
  return PAYMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function formatInvoiceDate(value: string | null): string {
  return formatDocumentDate(value);
}

/** Whole days between two ISO dates, rounded — used for the computed "Payment Terms: Payment due
 * within N days" (invoice) / "Quotation expires within N days" (quotation) line, since neither is a
 * stored field, just the gap between two dates every document already carries. Null if either date
 * is missing, so the caller can skip the line entirely rather than show a nonsense "within NaN days". */
function daysBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(diffMs)) return null;
  // Clamped at 0 — a same-day due date can round to -1 purely from time-of-day noise (e.g. invoice
  // timestamped 14:03, due date stored as that same calendar day's midnight), and there's no such
  // thing as a real invoice whose stated term is a negative number of days.
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

type DocumentLogo = { logoDataUrl: string | null; logoRatio: LogoRatio | null };

type DocumentBusinessInfo = {
  businessName: string;
  physicalAddress: string | null;
  primaryPhone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  /** Invoices/quotations used to just borrow receiptFooter (and had no header at all) — these give
   * each document type its own. */
  invoiceHeader: string | null;
  invoiceFooter: string | null;
  quotationHeader: string | null;
  quotationFooter: string | null;
  /** Per-line product photos on the downloaded/printed PDF only — see this storefront setting's own
   * doc comment in shared/types/location.ts for why this can never reach the Share app. */
  showProductImagesOnInvoices: boolean;
  showProductImagesOnQuotations: boolean;
  currency: string;
  vatRatePercent: number;
  /** The business's own KRA PIN — shown as "Our VAT No." on the invoice PDF only, always tenant-
   * wide (no per-storefront override exists for this, unlike header/footer text). */
  kraPin: string | null;
};

/** Every customer-facing document belongs to a specific storefront, and must show THAT storefront's
 * own identity — never the tenant-wide Business Profile's, which may be an unrelated holding/legal
 * name. The storefront's name is always used (it's a required field); address/phone/header/footer
 * fall back to the tenant-wide default only when the storefront hasn't set its own. Pass null when
 * there's no specific storefront (e.g. the employee has no branch assigned) to go straight to the
 * tenant defaults. Mirrors resolveDocumentLogo's per-location-first approach. */
function resolveDocumentBusiness(locationId: string | null, tenantRow: tenantRepository.TenantRow): DocumentBusinessInfo {
  const locationRow = locationId ? locationRepository.findLocationRowById(locationId) : undefined;
  return {
    businessName: locationRow?.location_name ?? tenantRow.business_name,
    physicalAddress: locationRow?.physical_address ?? tenantRow.physical_address,
    primaryPhone: locationRow?.phone ?? tenantRow.primary_phone,
    receiptHeader: locationRow?.receipt_header ?? tenantRow.receipt_header,
    receiptFooter: locationRow?.receipt_footer ?? tenantRow.receipt_footer,
    invoiceHeader: locationRow?.invoice_header ?? tenantRow.invoice_header,
    invoiceFooter: locationRow?.invoice_footer ?? tenantRow.invoice_footer,
    quotationHeader: locationRow?.quotation_header ?? tenantRow.quotation_header,
    quotationFooter: locationRow?.quotation_footer ?? tenantRow.quotation_footer,
    // No tenant-level fallback for these two — a boolean toggle has no sensible "unset" default to
    // fall back to beyond off, unlike the header/footer text fields above.
    showProductImagesOnInvoices: Boolean(locationRow?.show_product_images_on_invoices),
    showProductImagesOnQuotations: Boolean(locationRow?.show_product_images_on_quotations),
    currency: tenantRow.currency,
    vatRatePercent: tenantRow.vat_rate_percent,
    kraPin: tenantRow.kra_pin
  };
}

/** Prefers the storefront's own logo (if set); falls back to the business logo otherwise. Shared by
 * every document builder (invoice, quotation, payslip) — pass null when there's no specific
 * storefront to check (e.g. the employee has no branch assigned) to go straight to the business logo. */
async function resolveDocumentLogo(locationId: string | null, tenantRow: tenantRepository.TenantRow): Promise<DocumentLogo> {
  const locationRow = locationId ? locationRepository.findLocationRowById(locationId) : undefined;
  if (locationRow?.logo_path) {
    const logoDataUrl = await readManagedLocationLogoPreview(locationRow.logo_path);
    if (logoDataUrl) {
      return { logoDataUrl, logoRatio: locationRow.logo_ratio as LogoRatio | null };
    }
  }

  if (tenantRow.business_logo_path) {
    const logoDataUrl = await readManagedBusinessLogoPreview(tenantRow.business_logo_path);
    if (logoDataUrl) {
      return { logoDataUrl, logoRatio: tenantRow.business_logo_ratio as LogoRatio | null };
    }
  }

  return { logoDataUrl: null, logoRatio: null };
}

/** Data URLs for each item's product photo, keyed by product id — resolved once per document build
 * so buildInvoiceHtml/buildQuotationHtml can stay synchronous (same reason resolveDocumentLogo is
 * called ahead of time by every caller instead of from inside the builder). Only worth calling when
 * the storefront's own toggle is on; returns an empty map instantly otherwise. Skips any item whose
 * product has no image_path, or whose stored file no longer reads cleanly. */
async function resolveItemProductImages(items: Array<{ productId: string }>): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  for (const item of items) {
    if (images.has(item.productId)) continue;
    const product = productRepository.findProductRowById(item.productId);
    if (!product?.image_path) continue;
    const dataUrl = await readManagedProductImagePreview(product.image_path);
    if (dataUrl) images.set(item.productId, dataUrl);
  }
  return images;
}

/** Renders service charges + delivery fee as ordinary rows appended to an invoice/quotation's item
 * table — Discount shows as "-" since these aren't product lines, and the hidden cost never
 * appears here (only the customer-facing fee). Shared by buildInvoiceHtml and buildQuotationHtml. */
function buildExtraChargeRows(
  startIndex: number,
  serviceCharges: SaleServiceCharge[],
  delivery: SaleDelivery | null,
  money: (cents: number | null) => string
): string {
  const rows: string[] = [];
  let index = startIndex;

  for (const charge of serviceCharges) {
    index += 1;
    rows.push(`
      <tr>
        <td>${index}</td>
        <td>${escapeHtml(charge.name)}</td>
        <td class="center">1</td>
        <td class="right">${money(charge.feeCents)}</td>
        <td class="right">-</td>
        <td class="right">${money(charge.feeCents)}</td>
      </tr>`);
  }

  // A seller who absorbs the delivery cost themselves charges the customer nothing for it — skip
  // the row entirely rather than print "Delivery Fee: 0.00".
  if (delivery && delivery.feeCents > 0) {
    index += 1;
    rows.push(`
      <tr>
        <td>${index}</td>
        <td>Delivery Fee</td>
        <td class="center">1</td>
        <td class="right">${money(delivery.feeCents)}</td>
        <td class="right">-</td>
        <td class="right">${money(delivery.feeCents)}</td>
      </tr>`);
  }

  return rows.join("");
}

/** Builds a professional, letterhead-style A4 invoice document — a distinct template from the
 * narrow thermal receipt, reused for both print and PDF download. */
function buildInvoiceHtml(
  sale: Sale,
  business: DocumentBusinessInfo,
  logo: DocumentLogo,
  productImages: Map<string, string>
): string {
  const money = (cents: number | null): string =>
    `${business.currency} ${formatReceiptCents(cents)}`;

  const itemRows = sale.items
    .map((item, index) => {
      const imageUrl = productImages.get(item.productId);
      return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <div class="item-cell">
            ${imageUrl ? `<img src="${imageUrl}" class="item-thumb" alt="" />` : ""}
            <div>${escapeHtml(item.productName)}<div class="muted">${escapeHtml(item.sku)}</div></div>
          </div>
        </td>
        <td class="center">${item.quantity}</td>
        <td class="right">${money(item.unitPriceCents)}</td>
        <td class="right">${item.discountAmountCents > 0 ? `-${money(item.discountAmountCents)}` : "-"}</td>
        <td class="right">${money(item.lineTotalCents)}</td>
      </tr>`;
    })
    .join("") + buildExtraChargeRows(sale.items.length, sale.serviceCharges, sale.delivery, money);

  const paymentRows = sale.payments
    .map(
      (payment) => `
      <tr>
        <td>${formatInvoiceDate(payment.receivedAt)}</td>
        <td>${escapeHtml(payment.paymentMethodName)}</td>
        <td>${escapeHtml(payment.reference ?? "-")}</td>
        <td>${escapeHtml(payment.receivedByName)}</td>
        <td class="right">${money(payment.amountCents)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${LETTERHEAD_STYLES}</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="header-row">
        <div>
          ${logo.logoDataUrl ? `<img src="${logo.logoDataUrl}" class="logo" alt="" />` : ""}
          <p class="business-name">${escapeHtml(business.businessName)}</p>
          ${business.physicalAddress ? `<p class="muted">${escapeHtml(business.physicalAddress)}</p>` : ""}
          ${business.primaryPhone ? `<p class="muted">${escapeHtml(business.primaryPhone)}</p>` : ""}
          ${business.invoiceHeader ? `<p class="muted">${escapeHtml(business.invoiceHeader)}</p>` : ""}
        </div>
        <div>
          <p class="invoice-title">INVOICE</p>
          <p class="muted" style="text-align:right;">${escapeHtml(sale.invoiceNumber ?? "-")}</p>
          <div style="text-align:right;"><span class="badge">${escapeHtml(paymentStatusLabel(sale.paymentStatus))}</span></div>
        </div>
      </div>
      ${business.kraPin ? `<p class="doc-vat">Our VAT No. ${escapeHtml(business.kraPin)}</p>` : ""}
    </div>

    <div class="bill-to">
      <p class="label">Billed To:</p>
      <p class="name">${escapeHtml(sale.customerName ?? "Walk-in Customer")}</p>
    </div>

    <table class="meta-table">
      <thead>
        <tr><th>Invoice Date</th><th>Due Date</th><th>Issued By</th><th>Your VAT No.</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${formatInvoiceDate(sale.invoiceDate)}</td>
          <td>${formatInvoiceDate(sale.dueDate)}</td>
          <td>${escapeHtml(sale.employeeName)}</td>
          <td>${escapeHtml(sale.customerKraPin ?? "-")}</td>
        </tr>
      </tbody>
    </table>

    ${
      (() => {
        const days = daysBetween(sale.invoiceDate, sale.dueDate);
        return days === null ? "" : `<p class="payment-terms">Payment Terms: Payment due within ${days} day${days === 1 ? "" : "s"}</p>`;
      })()
    }

    <div class="items-frame">
      <table class="items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Product</th>
            <th class="center">Qty</th>
            <th class="right">Unit Price</th>
            <th class="right">Discount</th>
            <th class="right">Line Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="items-spacer"></div>
      <table class="totals-table">
        <tr><td>Subtotal</td><td>${money(sale.subtotalCents)}</td></tr>
        ${sale.discountAmountCents > 0 ? `<tr><td>Discount</td><td>-${money(sale.discountAmountCents)}</td></tr>` : ""}
        ${sale.includeTaxBreakdown && computeAddedTaxCents(sale.items) > 0 ? `<tr><td>Total Tax</td><td>${money(computeAddedTaxCents(sale.items))}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td>${money(sale.grandTotalCents)}</td></tr>
        <tr><td>Amount Paid</td><td>${money(sale.amountPaidCents)}</td></tr>
        <tr class="balance"><td>Balance Due</td><td>${money(sale.balanceDueCents)}</td></tr>
      </table>
    </div>

    ${
      sale.payments.length > 0
        ? `<p class="tax-breakdown-title">Payments Made</p>
    <table class="tax-breakdown">
      <thead>
        <tr><th>Date</th><th>Method</th><th>Reference</th><th>Received By</th><th class="right">Amount</th></tr>
      </thead>
      <tbody>${paymentRows}</tbody>
    </table>`
        : ""
    }

    ${sale.includeTaxBreakdown ? buildTaxBreakdownHtml(computeTaxBreakdown(sale.items), business.vatRatePercent, (cents) => money(cents), "tax-breakdown") : ""}

    ${sale.invoiceNotes ? `<div class="notes"><strong>Notes</strong><p>${escapeHtml(sale.invoiceNotes)}</p></div>` : ""}

    <div class="footer">${escapeHtml(business.invoiceFooter ?? "Thank you for your business!")}</div>
  </div>
</body>
</html>`;
}

/** Renders the invoice to PDF and prompts the user for a save location. Returns the saved path, or null if cancelled. */
export async function generateInvoicePdf(saleId: string): Promise<string | null> {
  requirePermission("sales", "view");
  const { sale, business } = loadReceiptData(saleId);
  if (!sale.invoiceNumber) {
    throw new Error("This sale is not an invoice");
  }
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(sale.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const productImages = business.showProductImagesOnInvoices ? await resolveItemProductImages(sale.items) : new Map();
  const html = buildInvoiceHtml(sale, business, logo, productImages);
  const buffer = await renderHtmlToPdfBuffer(html);

  const result = await dialog.showSaveDialog({
    title: "Save Invoice",
    defaultPath: `${sale.invoiceNumber}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  await writeFile(result.filePath, buffer);
  return result.filePath;
}

/** Opens the invoice in a preview window instead of prompting for a save location — see
 * openPdfPreviewWindow's own doc comment. Same data-loading/HTML-build as generateInvoicePdf. */
export async function previewInvoicePdf(saleId: string): Promise<void> {
  requirePermission("sales", "view");
  const { sale, business } = loadReceiptData(saleId);
  if (!sale.invoiceNumber) {
    throw new Error("This sale is not an invoice");
  }
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(sale.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const productImages = business.showProductImagesOnInvoices ? await resolveItemProductImages(sale.items) : new Map();
  const html = buildInvoiceHtml(sale, business, logo, productImages);
  const buffer = await renderHtmlToPdfBuffer(html);
  await openPdfPreviewWindow(buffer, `${sale.invoiceNumber}.pdf`, `Invoice ${sale.invoiceNumber}`);
}

/** Sends the invoice document straight to Windows' default printer — a regular A4 printer, not the
 * ESC/POS thermal one. Uses pdf-to-printer (see printHtmlViaSystemPrinter), not webContents.print(),
 * which fails with "Invalid printer settings" whenever a POS/label printer is among the installed
 * devices — the same root cause already fixed for receipts. */
export async function printInvoiceDocument(saleId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  const { sale, business } = loadReceiptData(saleId);
  if (!sale.invoiceNumber) {
    return { success: false, message: "This sale is not an invoice" };
  }

  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(sale.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const productImages = business.showProductImagesOnInvoices ? await resolveItemProductImages(sale.items) : new Map();
  const html = buildInvoiceHtml(sale, business, logo, productImages);

  try {
    await printHtmlViaSystemPrinter(html, "invoice");
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print invoice" };
  }
}

/** Same portrait, bold, bordered style as the compact receipt (buildReceiptHtml) — an invoice's own
 * narrow-roll counterpart to the A4 letterhead version above. Deliberately a simpler 4-column item
 * table (no per-item discount/tax columns) to match the receipt's own compact shape; the header
 * already carries the invoice's own subtotal/discount/tax breakdown in the totals block below. */
function buildInvoiceThermalHtml(sale: Sale, business: DocumentBusinessInfo): string {
  const money = (cents: number | null): string => `${business.currency} ${formatReceiptCents(cents)}`;

  const itemRows = sale.items
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.productName)}</td>
        <td class="center">${item.quantity}</td>
        <td class="right">${money(item.unitPriceCents)}</td>
        <td class="right">${money(item.lineTotalCents)}</td>
      </tr>`
    )
    .join("");

  const extraRows = [
    ...sale.serviceCharges.map(
      (charge) => `
      <tr>
        <td>${escapeHtml(charge.name)}</td>
        <td class="center">1</td>
        <td class="right">${money(charge.feeCents)}</td>
        <td class="right">${money(charge.feeCents)}</td>
      </tr>`
    ),
    ...(sale.delivery && sale.delivery.feeCents > 0
      ? [
          `
      <tr>
        <td>Delivery Fee</td>
        <td class="center">1</td>
        <td class="right">${money(sale.delivery.feeCents)}</td>
        <td class="right">${money(sale.delivery.feeCents)}</td>
      </tr>`
        ]
      : [])
  ].join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, 'Segoe UI', Helvetica, sans-serif; color: #000; margin: 0; padding: 1px 2px; font-size: 11px; font-weight: 700; }
  .receipt { max-width: 100%; margin: 0 auto; border: 2px solid #000; padding: 3px; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #000; font-size: 10px; }
  hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  .doc-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  table.items { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }
  table.items th, table.items td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
  table.items th { background: #d9d9d9; text-transform: uppercase; font-size: 9px; text-align: left; }
  .right { text-align: right; white-space: nowrap; }
  table.totals { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
  table.totals td { border: 1px solid #000; padding: 3px 6px; }
  table.totals td.label { background: #d9d9d9; font-weight: bold; }
  table.totals tr.grand td { font-size: 12.5px; font-weight: bold; }
  table.totals tr.balance td { color: #ad3a29; }
  .tax-breakdown-title { margin: 6px 0 2px; font-size: 9px; text-transform: uppercase; font-weight: bold; }
</style>
</head>
<body>
  <div class="receipt">
    <h1>${escapeHtml(business.businessName)}</h1>
    ${business.physicalAddress ? `<p class="center muted">${escapeHtml(business.physicalAddress)}</p>` : ""}
    ${business.primaryPhone ? `<p class="center muted">${escapeHtml(business.primaryPhone)}</p>` : ""}
    <p class="center doc-title">Invoice</p>
    <p class="center muted">${escapeHtml(sale.invoiceNumber ?? "-")} &middot; ${escapeHtml(paymentStatusLabel(sale.paymentStatus))}</p>
    <hr/>
    <p class="muted">
      Bill To: ${escapeHtml(sale.customerName ?? "Walk-in Customer")}<br/>
      Invoice Date: ${formatInvoiceDate(sale.invoiceDate)}<br/>
      Due Date: ${formatInvoiceDate(sale.dueDate)}<br/>
      Storefront: ${escapeHtml(sale.locationName)} &middot; Issued By: ${escapeHtml(sale.employeeName)}
    </p>
    <table class="items">
      <thead>
        <tr>
          <th>Item Description</th>
          <th class="center">Qty</th>
          <th class="right">Unit Price</th>
          <th class="right">Sub Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}${extraRows}</tbody>
    </table>
    <table class="totals">
      <tr><td class="label">Subtotal</td><td class="right">${money(sale.subtotalCents)}</td></tr>
      ${sale.discountAmountCents > 0 ? `<tr><td class="label">Discount</td><td class="right">-${money(sale.discountAmountCents)}</td></tr>` : ""}
      ${sale.includeTaxBreakdown && computeAddedTaxCents(sale.items) > 0 ? `<tr><td class="label">Total Tax</td><td class="right">${money(computeAddedTaxCents(sale.items))}</td></tr>` : ""}
      <tr class="grand"><td class="label">Total</td><td class="right">${money(sale.grandTotalCents)}</td></tr>
      <tr><td class="label">Amount Paid</td><td class="right">${money(sale.amountPaidCents)}</td></tr>
      <tr class="balance"><td class="label">Balance Due</td><td class="right">${money(sale.balanceDueCents)}</td></tr>
    </table>
    ${sale.includeTaxBreakdown ? buildTaxBreakdownHtml(computeTaxBreakdown(sale.items), business.vatRatePercent, (cents) => money(cents), "items") : ""}
    ${sale.invoiceNotes ? `<hr/><p class="muted">Notes: ${escapeHtml(sale.invoiceNotes)}</p>` : ""}
    <hr/>
    <p class="center muted">${escapeHtml(business.invoiceFooter ?? "Thank you for your business!")}</p>
  </div>
</body>
</html>`;
}

/** Prints the invoice through the configured system/USB thermal printer, straight down the roll —
 * same pipeline as the compact receipt (see printReceiptToSystemPrinter). */
export async function printInvoiceViaThermal(saleId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  const settings = loadPrinterSettings();
  if (!settings.enabled || (requiresExplicitAddress(settings) && !settings.address)) {
    return { success: false, message: "No printer is configured yet. Set one up in Settings." };
  }
  if (settings.connectionType !== "usb") {
    return {
      success: false,
      message: "This backup print needs a printer set up as a Windows/USB printer in Settings (not a raw network/serial connection)."
    };
  }

  const { sale, business } = loadReceiptData(saleId);
  if (!sale.invoiceNumber) {
    return { success: false, message: "This sale is not an invoice" };
  }

  const html = buildInvoiceThermalHtml(sale, business);
  const buffer = await renderThermalHtmlToPdfBuffer(html, resolveThermalPageWidthIn(settings.paperWidth));
  const tempPath = join(app.getPath("temp"), `blue-ledger-invoice-${randomUUID()}.pdf`);
  await writeFile(tempPath, buffer);
  try {
    // See printReceiptToSystemPrinter's own comment — noscale is the real fix for the blank-space
    // bug, not the page height above.
    await printPdfToPrinter(tempPath, { silent: true, scale: "noscale", ...(settings.address ? { printer: settings.address } : {}) });
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print invoice" };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

function loadQuotationData(
  quotationId: string
): { quotation: Quotation; business: DocumentBusinessInfo } {
  const row = quotationRepository.findQuotationDetailRowById(quotationId);
  if (!row) {
    throw new Error("Quotation not found");
  }
  const items = quotationRepository.findQuotationItemDetailRows(quotationId).map(quotationRepository.mapQuotationItemDetailRow);
  const serviceCharges = serviceChargeRepository
    .findServiceChargeRowsForQuotation(quotationId)
    .map(serviceChargeRepository.mapServiceChargeRow);
  const deliveryRow = deliveryNoteRepository.findDeliveryNoteRowByQuotationId(quotationId);
  const delivery = deliveryRow ? deliveryNoteRepository.mapDeliveryNoteRow(deliveryRow) : null;
  const quotation = quotationRepository.mapQuotationDetailRow(row, items, serviceCharges, delivery);

  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Business profile not found");
  }

  return {
    quotation,
    business: resolveDocumentBusiness(row.location_id, tenantRow)
  };
}

function quotationStatusLabel(status: Quotation["status"]): string {
  return QUOTATION_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Builds a professional, letterhead-style A4 quotation document — reused for both print and PDF
 * download, and structured for later reuse by email/WhatsApp delivery. */
function buildQuotationHtml(
  quotation: Quotation,
  business: DocumentBusinessInfo,
  logo: DocumentLogo,
  productImages: Map<string, string>
): string {
  const money = (cents: number | null): string => `${business.currency} ${formatReceiptCents(cents)}`;

  const itemRows = quotation.items
    .map((item, index) => {
      const imageUrl = productImages.get(item.productId);
      return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <div class="item-cell">
            ${imageUrl ? `<img src="${imageUrl}" class="item-thumb" alt="" />` : ""}
            <div>${escapeHtml(item.productName)}<div class="muted">${escapeHtml(item.sku)}</div></div>
          </div>
        </td>
        <td class="center">${item.quantity}</td>
        <td class="right">${money(item.unitPriceCents)}</td>
        <td class="right">${item.discountAmountCents > 0 ? `-${money(item.discountAmountCents)}` : "-"}</td>
        <td class="right">${money(item.lineTotalCents)}</td>
      </tr>`;
    })
    .join("") + buildExtraChargeRows(quotation.items.length, quotation.serviceCharges, quotation.delivery, money);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${LETTERHEAD_STYLES}</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="header-row">
        <div>
          ${logo.logoDataUrl ? `<img src="${logo.logoDataUrl}" class="logo" alt="" />` : ""}
          <p class="business-name">${escapeHtml(business.businessName)}</p>
          ${business.physicalAddress ? `<p class="muted">${escapeHtml(business.physicalAddress)}</p>` : ""}
          ${business.primaryPhone ? `<p class="muted">${escapeHtml(business.primaryPhone)}</p>` : ""}
          ${business.quotationHeader ? `<p class="muted">${escapeHtml(business.quotationHeader)}</p>` : ""}
        </div>
        <div>
          <p class="doc-title">QUOTATION</p>
          <p class="muted" style="text-align:right;">${escapeHtml(quotation.quotationNumber)}</p>
          <div style="text-align:right;"><span class="badge">${escapeHtml(quotationStatusLabel(quotation.status))}</span></div>
        </div>
      </div>
    </div>

    <div class="bill-to">
      <p class="label">Quoted To</p>
      <p class="name">${escapeHtml(quotation.customerName ?? "Walk-in Customer")}</p>
    </div>

    <table class="meta-table">
      <thead>
        <tr><th>Date Prepared</th><th>Valid Until</th><th>Prepared By</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${formatInvoiceDate(quotation.createdAt)}</td>
          <td>${formatInvoiceDate(quotation.validUntil)}</td>
          <td>${escapeHtml(quotation.employeeName)}</td>
        </tr>
      </tbody>
    </table>

    ${
      (() => {
        const days = daysBetween(quotation.createdAt, quotation.validUntil);
        return days === null ? "" : `<p class="payment-terms">Quotation expires within ${days} day${days === 1 ? "" : "s"}</p>`;
      })()
    }

    <div class="items-frame">
      <table class="items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Product</th>
            <th class="center">Qty</th>
            <th class="right">Unit Price</th>
            <th class="right">Discount</th>
            <th class="right">Line Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="items-spacer"></div>
      <table class="totals-table">
        <tr><td>Subtotal</td><td>${money(quotation.subtotalCents)}</td></tr>
        ${quotation.discountAmountCents > 0 ? `<tr><td>Discount</td><td>-${money(quotation.discountAmountCents)}</td></tr>` : ""}
        ${quotation.includeTaxBreakdown && computeAddedTaxCents(quotation.items) > 0 ? `<tr><td>Total Tax</td><td>${money(computeAddedTaxCents(quotation.items))}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td>${money(quotation.grandTotalCents)}</td></tr>
      </table>
    </div>

    ${quotation.includeTaxBreakdown ? buildTaxBreakdownHtml(computeTaxBreakdown(quotation.items), business.vatRatePercent, (cents) => money(cents), "tax-breakdown") : ""}

    ${quotation.notes ? `<div class="notes"><strong>Notes</strong><p>${escapeHtml(quotation.notes)}</p></div>` : ""}

    <div class="terms">
      This quotation is valid until ${formatInvoiceDate(quotation.validUntil)}. Prices, discounts, and availability
      are subject to confirmation at the time of order. Acceptance of this quotation does not reserve stock.
    </div>

    <div class="signatures">
      <div class="signature">
        <div class="line">Customer Signature &amp; Date</div>
      </div>
      <div class="signature">
        <div class="line">Authorized Signature &amp; Date</div>
      </div>
    </div>

    <div class="footer">${escapeHtml(business.quotationFooter ?? "Thank you for considering us!")}</div>
  </div>
</body>
</html>`;
}

/** Renders the quotation to PDF and prompts the user for a save location. Returns the saved path, or null if cancelled. */
export async function generateQuotationPdf(quotationId: string): Promise<string | null> {
  requirePermission("quotations", "view");
  const { quotation, business } = loadQuotationData(quotationId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(quotation.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const productImages = business.showProductImagesOnQuotations ? await resolveItemProductImages(quotation.items) : new Map();
  const html = buildQuotationHtml(quotation, business, logo, productImages);
  const buffer = await renderHtmlToPdfBuffer(html);

  const result = await dialog.showSaveDialog({
    title: "Save Quotation",
    defaultPath: `${quotation.quotationNumber}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  await writeFile(result.filePath, buffer);
  return result.filePath;
}

/** Opens the quotation in a preview window instead of prompting for a save location — see
 * openPdfPreviewWindow's own doc comment. Same data-loading/HTML-build as generateQuotationPdf. */
export async function previewQuotationPdf(quotationId: string): Promise<void> {
  requirePermission("quotations", "view");
  const { quotation, business } = loadQuotationData(quotationId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(quotation.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const productImages = business.showProductImagesOnQuotations ? await resolveItemProductImages(quotation.items) : new Map();
  const html = buildQuotationHtml(quotation, business, logo, productImages);
  const buffer = await renderHtmlToPdfBuffer(html);
  await openPdfPreviewWindow(buffer, `${quotation.quotationNumber}.pdf`, `Quotation ${quotation.quotationNumber}`);
}

/** Opens the native print dialog for the quotation document — a regular A4 printer, not the ESC/POS thermal one. */
/** Same fix as printInvoiceDocument — pdf-to-printer instead of webContents.print(). */
export async function printQuotationDocument(quotationId: string): Promise<PrinterActionResult> {
  requirePermission("quotations", "view");
  const { quotation, business } = loadQuotationData(quotationId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(quotation.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const productImages = business.showProductImagesOnQuotations ? await resolveItemProductImages(quotation.items) : new Map();
  const html = buildQuotationHtml(quotation, business, logo, productImages);

  try {
    await printHtmlViaSystemPrinter(html, "quotation");
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print quotation" };
  }
}

/** Same portrait, bold, bordered style as the compact receipt (buildReceiptHtml) — a quotation's own
 * narrow-roll counterpart to the A4 letterhead version above. No balance-due row (a quotation is
 * never a payment record), otherwise the same simplified 4-column item table as the invoice's
 * thermal version. */
function buildQuotationThermalHtml(quotation: Quotation, business: DocumentBusinessInfo): string {
  const money = (cents: number | null): string => `${business.currency} ${formatReceiptCents(cents)}`;

  const itemRows = quotation.items
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.productName)}</td>
        <td class="center">${item.quantity}</td>
        <td class="right">${money(item.unitPriceCents)}</td>
        <td class="right">${money(item.lineTotalCents)}</td>
      </tr>`
    )
    .join("");

  const extraRows = [
    ...quotation.serviceCharges.map(
      (charge) => `
      <tr>
        <td>${escapeHtml(charge.name)}</td>
        <td class="center">1</td>
        <td class="right">${money(charge.feeCents)}</td>
        <td class="right">${money(charge.feeCents)}</td>
      </tr>`
    ),
    ...(quotation.delivery && quotation.delivery.feeCents > 0
      ? [
          `
      <tr>
        <td>Delivery Fee</td>
        <td class="center">1</td>
        <td class="right">${money(quotation.delivery.feeCents)}</td>
        <td class="right">${money(quotation.delivery.feeCents)}</td>
      </tr>`
        ]
      : [])
  ].join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, 'Segoe UI', Helvetica, sans-serif; color: #000; margin: 0; padding: 1px 2px; font-size: 11px; font-weight: 700; }
  .receipt { max-width: 100%; margin: 0 auto; border: 2px solid #000; padding: 3px; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #000; font-size: 10px; }
  hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  .doc-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  table.items { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }
  table.items th, table.items td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
  table.items th { background: #d9d9d9; text-transform: uppercase; font-size: 9px; text-align: left; }
  .right { text-align: right; white-space: nowrap; }
  table.totals { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
  table.totals td { border: 1px solid #000; padding: 3px 6px; }
  table.totals td.label { background: #d9d9d9; font-weight: bold; }
  table.totals tr.grand td { font-size: 12.5px; font-weight: bold; }
  .tax-breakdown-title { margin: 6px 0 2px; font-size: 9px; text-transform: uppercase; font-weight: bold; }
</style>
</head>
<body>
  <div class="receipt">
    <h1>${escapeHtml(business.businessName)}</h1>
    ${business.physicalAddress ? `<p class="center muted">${escapeHtml(business.physicalAddress)}</p>` : ""}
    ${business.primaryPhone ? `<p class="center muted">${escapeHtml(business.primaryPhone)}</p>` : ""}
    <p class="center doc-title">Quotation</p>
    <p class="center muted">${escapeHtml(quotation.quotationNumber)} &middot; ${escapeHtml(quotationStatusLabel(quotation.status))}</p>
    <hr/>
    <p class="muted">
      Quoted To: ${escapeHtml(quotation.customerName ?? "Walk-in Customer")}<br/>
      Date Prepared: ${formatInvoiceDate(quotation.createdAt)}<br/>
      Valid Until: ${formatInvoiceDate(quotation.validUntil)}<br/>
      Storefront: ${escapeHtml(quotation.locationName)} &middot; Prepared By: ${escapeHtml(quotation.employeeName)}
    </p>
    <table class="items">
      <thead>
        <tr>
          <th>Item Description</th>
          <th class="center">Qty</th>
          <th class="right">Unit Price</th>
          <th class="right">Sub Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}${extraRows}</tbody>
    </table>
    <table class="totals">
      <tr><td class="label">Subtotal</td><td class="right">${money(quotation.subtotalCents)}</td></tr>
      ${quotation.discountAmountCents > 0 ? `<tr><td class="label">Discount</td><td class="right">-${money(quotation.discountAmountCents)}</td></tr>` : ""}
      ${quotation.includeTaxBreakdown && computeAddedTaxCents(quotation.items) > 0 ? `<tr><td class="label">Total Tax</td><td class="right">${money(computeAddedTaxCents(quotation.items))}</td></tr>` : ""}
      <tr class="grand"><td class="label">Total</td><td class="right">${money(quotation.grandTotalCents)}</td></tr>
    </table>
    ${quotation.includeTaxBreakdown ? buildTaxBreakdownHtml(computeTaxBreakdown(quotation.items), business.vatRatePercent, (cents) => money(cents), "items") : ""}
    ${quotation.notes ? `<hr/><p class="muted">Notes: ${escapeHtml(quotation.notes)}</p>` : ""}
    <hr/>
    <p class="center muted">${escapeHtml(business.quotationFooter ?? "Thank you for considering us!")}</p>
  </div>
</body>
</html>`;
}

/** Prints the quotation through the configured system/USB thermal printer, straight down the roll —
 * same pipeline as the compact receipt (see printReceiptToSystemPrinter). */
export async function printQuotationViaThermal(quotationId: string): Promise<PrinterActionResult> {
  requirePermission("quotations", "view");
  const settings = loadPrinterSettings();
  if (!settings.enabled || (requiresExplicitAddress(settings) && !settings.address)) {
    return { success: false, message: "No printer is configured yet. Set one up in Settings." };
  }
  if (settings.connectionType !== "usb") {
    return {
      success: false,
      message: "This backup print needs a printer set up as a Windows/USB printer in Settings (not a raw network/serial connection)."
    };
  }

  const { quotation, business } = loadQuotationData(quotationId);
  const html = buildQuotationThermalHtml(quotation, business);
  const buffer = await renderThermalHtmlToPdfBuffer(html, resolveThermalPageWidthIn(settings.paperWidth));
  const tempPath = join(app.getPath("temp"), `blue-ledger-quotation-${randomUUID()}.pdf`);
  await writeFile(tempPath, buffer);
  try {
    // See printReceiptToSystemPrinter's own comment — noscale is the real fix for the blank-space
    // bug, not the page height above.
    await printPdfToPrinter(tempPath, { silent: true, scale: "noscale", ...(settings.address ? { printer: settings.address } : {}) });
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print quotation" };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

function formatPayPeriodLabel(payPeriod: string): string {
  try {
    const [year, month] = payPeriod.split("-").map(Number);
    return new Date(year ?? 0, (month ?? 1) - 1, 1).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric"
    });
  } catch {
    return payPeriod;
  }
}

/** getSalary() (not the raw repository) is used here deliberately — it re-enforces the same
 * self-vs-admin visibility boundary as the rest of the Salaries module, so an employee can only
 * ever generate a PDF or share link for their own payslip, never someone else's. */
async function loadSalaryData(salaryId: string): Promise<{
  salary: Salary;
  business: DocumentBusinessInfo;
  logo: DocumentLogo;
}> {
  const salary = getSalary(salaryId);
  if (salary.status === "draft") {
    throw new Error("This payslip hasn't been completed yet — there's nothing to print or share");
  }
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Business profile not found");
  }

  const employeeRow = employeeRepository.findEmployeeRowById(salary.employeeId);
  const logo = await resolveDocumentLogo(employeeRow?.branch_id ?? null, tenantRow);

  return {
    salary,
    business: resolveDocumentBusiness(employeeRow?.branch_id ?? null, tenantRow),
    logo
  };
}

/** Builds a professional, letterhead-style A4 payslip — the same visual language as the invoice
 * and quotation documents, reused for both PDF download and the manual-share flow. */
function buildPayslipHtml(
  salary: Salary,
  business: DocumentBusinessInfo,
  logo: DocumentLogo
): string {
  const money = (cents: number): string => `${business.currency} ${formatReceiptCents(cents)}`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1710; margin: 0; padding: 48px; font-size: 13px; }
  .sheet { max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #061e64; padding-bottom: 16px; }
  .logo { display: block; height: auto; max-height: 64px; width: auto; max-width: 220px; object-fit: contain; margin-bottom: 8px; }
  .business-name { font-size: 20px; font-weight: bold; color: #061e64; margin: 0; }
  .muted { color: #666; font-size: 11px; }
  .doc-title { font-size: 26px; font-weight: bold; text-align: right; color: #061e64; margin: 0; letter-spacing: 1px; }
  .badge { display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: bold; text-transform: uppercase; background: #f1ede1; color: #1c1710; }
  .meta { display: flex; justify-content: space-between; margin-top: 20px; gap: 24px; }
  .meta-block p { margin: 2px 0; }
  .meta-block .label { font-size: 10px; text-transform: uppercase; color: #83795f; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #83795f; border-bottom: 2px solid #ddd5c2; padding: 6px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  .right { text-align: right; white-space: nowrap; }
  .totals { width: 280px; margin-left: auto; margin-top: 16px; }
  .totals td { border-bottom: none; padding: 3px 4px; }
  .totals .grand td { font-size: 15px; font-weight: bold; border-top: 2px solid #061e64; padding-top: 8px; }
  .notes { margin-top: 24px; padding: 12px; background: #f1ede1; border-radius: 8px; }
  .footer { margin-top: 32px; text-align: center; color: #83795f; font-size: 11px; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        ${logo.logoDataUrl ? `<img src="${logo.logoDataUrl}" class="logo" alt="" />` : ""}
        <p class="business-name">${escapeHtml(business.businessName)}</p>
        ${business.physicalAddress ? `<p class="muted">${escapeHtml(business.physicalAddress)}</p>` : ""}
        ${business.primaryPhone ? `<p class="muted">${escapeHtml(business.primaryPhone)}</p>` : ""}
      </div>
      <div>
        <p class="doc-title">PAYSLIP</p>
        <p class="muted" style="text-align:right;">${escapeHtml(salary.payslipNumber)}</p>
        ${salary.status === "voided" ? `<div style="text-align:right;"><span class="badge">Voided</span></div>` : ""}
      </div>
    </div>

    <div class="meta">
      <div class="meta-block">
        <p class="label">Employee</p>
        <p><strong>${escapeHtml(salary.employeeName)}</strong></p>
        <p class="muted">${escapeHtml(salary.employeeCode)}</p>
      </div>
      <div class="meta-block">
        <p class="label">Pay Period</p>
        <p>${escapeHtml(formatPayPeriodLabel(salary.payPeriod))}</p>
        <p class="label" style="margin-top:10px;">Date Processed</p>
        <p>${formatInvoiceDate(salary.createdAt)}</p>
      </div>
      <div class="meta-block">
        <p class="label">Payment Method</p>
        <p>${escapeHtml(salary.paymentMethodName ?? "—")}</p>
        ${salary.paymentReference ? `<p class="label" style="margin-top:10px;">Reference</p><p>${escapeHtml(salary.paymentReference)}</p>` : ""}
      </div>
    </div>

    <table class="totals">
      <tr><td>Basic Salary</td><td class="right">${money(salary.basicSalaryCents)}</td></tr>
      ${salary.allowances.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td class="right">${money(item.amountCents)}</td></tr>`).join("")}
      ${salary.deductions.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td class="right">-${money(item.amountCents)}</td></tr>`).join("")}
      <tr class="grand"><td>Net Pay</td><td class="right">${money(salary.netPayCents)}</td></tr>
    </table>

    ${salary.notes ? `<div class="notes"><strong>Notes</strong><p>${escapeHtml(salary.notes)}</p></div>` : ""}

    <div class="footer">This is a system-generated payslip.</div>
  </div>
</body>
</html>`;
}

/** Renders the payslip to PDF and prompts the user for a save location. Returns the saved path, or
 * null if cancelled. Access is gated inside loadSalaryData() -> getSalary(), not here. */
export async function generateSalaryPdf(salaryId: string): Promise<string | null> {
  const { salary, business, logo } = await loadSalaryData(salaryId);
  const html = buildPayslipHtml(salary, business, logo);
  const buffer = await renderHtmlToPdfBuffer(html);

  const result = await dialog.showSaveDialog({
    title: "Save Payslip",
    defaultPath: `${salary.payslipNumber}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  await writeFile(result.filePath, buffer);
  return result.filePath;
}

/** Opens the payslip in a preview window instead of prompting for a save location — see
 * openPdfPreviewWindow's own doc comment. Same data-loading/HTML-build as generateSalaryPdf. */
export async function previewSalaryPdf(salaryId: string): Promise<void> {
  const { salary, business, logo } = await loadSalaryData(salaryId);
  const html = buildPayslipHtml(salary, business, logo);
  const buffer = await renderHtmlToPdfBuffer(html);
  await openPdfPreviewWindow(buffer, `${salary.payslipNumber}.pdf`, `Payslip ${salary.payslipNumber}`);
}

/**
 * "Share" for a desktop app without a native OS share sheet: renders the payslip to a PDF in a
 * scratch folder, then reveals it in the file explorer so the user can manually attach it to
 * WhatsApp, email, etc. Nothing here is persisted as managed application data.
 */
export async function shareSalaryPayslip(salaryId: string): Promise<PrinterActionResult> {
  try {
    const { salary, business, logo } = await loadSalaryData(salaryId);
    const html = buildPayslipHtml(salary, business, logo);
    const buffer = await renderHtmlToPdfBuffer(html);

    const shareDir = join(app.getPath("temp"), "BlueLedger", "payslips");
    mkdirSync(shareDir, { recursive: true });
    const filePath = join(shareDir, `${salary.payslipNumber}.pdf`);
    await writeFile(filePath, buffer);

    shell.showItemInFolder(filePath);
    return { success: true, message: "Payslip ready — attach it from the file that just opened." };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to prepare payslip for sharing" };
  }
}

/** Resolves a delivery note's business + source-document (sale/invoice/quotation) context — a
 * delivery note always belongs to exactly one of those, matching the DB's CHECK constraint. */
function loadDeliveryNoteData(deliveryNoteId: string): { vm: DeliveryNoteViewModel; locationId: string } {
  const row = deliveryNoteRepository.findDeliveryNoteRowById(deliveryNoteId);
  if (!row) {
    throw new Error("Delivery note not found");
  }
  const delivery = deliveryNoteRepository.mapDeliveryNoteRow(row);

  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Business profile not found");
  }

  let locationId: string;
  let sourceLabel: string;
  let sourceNumber: string | null;
  let sourceCreatedAt: string;

  if (row.sale_id) {
    const saleRow = saleRepository.findSaleRowById(row.sale_id);
    if (!saleRow) {
      throw new Error("Source sale not found");
    }
    locationId = saleRow.location_id;
    sourceLabel = saleRow.invoice_number ? "Invoice" : "Receipt";
    sourceNumber = saleRow.invoice_number ?? saleRow.receipt_number;
    sourceCreatedAt = saleRow.created_at;
  } else if (row.quotation_id) {
    const quotationRow = quotationRepository.findQuotationRowById(row.quotation_id);
    if (!quotationRow) {
      throw new Error("Source quotation not found");
    }
    locationId = quotationRow.location_id;
    sourceLabel = "Quotation";
    sourceNumber = quotationRow.quotation_number;
    sourceCreatedAt = quotationRow.created_at;
  } else {
    throw new Error("Delivery note has no source document");
  }

  const business = resolveDocumentBusiness(locationId, tenantRow);
  const vm = buildDeliveryNoteViewModel(
    delivery,
    {
      businessName: business.businessName,
      physicalAddress: business.physicalAddress,
      primaryPhone: business.primaryPhone
    },
    { label: sourceLabel, number: sourceNumber, createdAt: sourceCreatedAt }
  );

  return { vm, locationId };
}

function deliveryNoteField(label: string, value: string | null): string {
  if (!value) return "";
  return `
      <div class="field">
        <span class="field-label">${escapeHtml(label)}</span>
        <span class="field-value">${escapeHtml(value)}</span>
      </div>`;
}

/**
 * A labeled, dashed-border card centered on an ordinary A4 sheet. Sized to fill most of the page
 * (180mm of ~210mm width) — an earlier 100mm version left the sheet looking almost entirely blank.
 * Deliberately excludes every fee/cost figure (the view-model itself has no such fields).
 */
function buildDeliveryNoteHtml(vm: DeliveryNoteViewModel, logo: DocumentLogo): string {
  const townCountry = [vm.town, vm.country].filter(Boolean).join(", ");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 0; }
  html, body { height: 100%; }
  body {
    font-family: Arial, Helvetica, sans-serif; color: #1c1710; margin: 0;
    display: flex; align-items: center; justify-content: center; min-height: 100vh;
  }
  .card {
    width: 180mm;
    border: 3px dashed #83795f;
    border-radius: 10px;
    padding: 28px 36px 24px;
  }
  .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 3px solid #061e64; padding-bottom: 14px; }
  .logo { display: block; height: auto; max-height: 58px; width: auto; max-width: 190px; object-fit: contain; margin-bottom: 5px; }
  .business-name { font-size: 20px; font-weight: bold; color: #061e64; margin: 0; }
  .muted { color: #83795f; font-size: 15px; margin: 3px 0 0; }
  .doc-title { font-size: 22px; font-weight: bold; text-align: right; color: #061e64; margin: 0; letter-spacing: 1px; }
  .doc-number { font-size: 16px; font-weight: bold; text-align: right; color: #83795f; margin-top: 4px; }
  .badge { display: inline-block; margin-top: 8px; padding: 4px 14px; border-radius: 999px; font-size: 13px; font-weight: bold; text-transform: uppercase; background: #1f9d55; color: #fff; }
  .section-label { margin: 18px 0 8px; font-size: 15px; text-transform: uppercase; letter-spacing: 1px; font-weight: bold; color: #061e64; }
  .field { display: flex; gap: 14px; padding: 6px 0; border-bottom: 1px dotted #ddd5c2; }
  .field-label { flex: 0 0 110px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.4px; color: #83795f; font-weight: bold; padding-top: 2px; }
  .field-value { flex: 1; font-size: 18px; font-weight: 700; color: #1c1710; line-height: 1.3; word-break: break-word; }
  .recipient-name .field-value { font-size: 24px; }
  .divider { margin-top: 18px; border-top: 1px dashed #ddd5c2; }
  .footer { margin-top: 16px; display: flex; justify-content: space-between; font-size: 13px; color: #83795f; }
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        ${logo.logoDataUrl ? `<img src="${logo.logoDataUrl}" class="logo" alt="" />` : ""}
        <p class="business-name">${escapeHtml(vm.businessName)}</p>
        ${vm.businessPhone ? `<p class="muted">${escapeHtml(vm.businessPhone)}</p>` : ""}
      </div>
      <div>
        <p class="doc-title">DELIVERY NOTE</p>
        <p class="doc-number">${escapeHtml(vm.deliveryNoteNumber)}</p>
        ${vm.isDelivered ? `<div style="text-align:right;"><span class="badge">Delivered</span></div>` : ""}
      </div>
    </div>

    <p class="section-label">Deliver To</p>
    <div class="recipient-name">${deliveryNoteField("Recipient", vm.recipientName)}</div>
    ${deliveryNoteField("Address", vm.deliveryAddress)}
    ${deliveryNoteField("Town", townCountry || null)}
    ${deliveryNoteField("Notes", vm.deliveryNotes)}

    <p class="section-label">Rider</p>
    ${deliveryNoteField("Name", vm.riderName ?? "Not assigned")}
    ${deliveryNoteField("Phone", vm.riderPhone)}
    ${deliveryNoteField("Vehicle", vm.riderVehicleDescription)}

    <div class="divider"></div>
    <div class="footer">
      <span>${escapeHtml(vm.sourceDocumentLabel)}: ${escapeHtml(vm.sourceDocumentNumber ?? "-")}</span>
      <span>${escapeHtml(vm.dateLabel)}</span>
    </div>
  </div>
</body>
</html>`;
}

/** One label-then-value pair, stacked vertically — the label small/muted, the value bold and large
 * enough to actually register on a thermal printhead. Skips entirely when there's nothing to show. */
function deliveryNoteThermalField(label: string, value: string | null): string {
  if (!value) return "";
  return `<p class="field-label">${escapeHtml(label)}</p><p class="field-value">${escapeHtml(value)}</p>`;
}

/** Same portrait, top-to-bottom, bold/bordered style as the compact receipt (buildReceiptHtml) —
 * previously this laid the note out "landscape" and rotated it 90° so a thermal roll (which only
 * ever prints a fixed-width portrait strip) could show it wide, with instructions to physically
 * rotate the printed strip afterward to read it. In practice that rotation produced broken, faint
 * text — thermal printheads burn a 90°-rotated glyph unevenly compared to normal upright text — so
 * this now prints straight down the roll like every other document, no rotation, no aftermarket
 * paper-turning required. */
function buildDeliveryNoteThermalHtml(vm: DeliveryNoteViewModel): string {
  const townCountry = [vm.town, vm.country].filter(Boolean).join(", ");
  const address = townCountry ? `${vm.deliveryAddress}, ${townCountry}` : vm.deliveryAddress;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, 'Segoe UI', Helvetica, sans-serif; color: #000; margin: 0; padding: 1px 2px; font-size: 11px; font-weight: 700; }
  .receipt { max-width: 100%; margin: 0 auto; border: 2px solid #000; padding: 3px; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #000; font-size: 10px; }
  hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  .doc-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; margin: 0 0 4px; }
  .field-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; margin: 6px 0 0; }
  .field-value { font-size: 14px; font-weight: 700; margin: 1px 0 0; line-height: 1.25; word-break: break-word; }
</style>
</head>
<body>
  <div class="receipt">
    <h1>${escapeHtml(vm.businessName)}</h1>
    ${vm.businessPhone ? `<p class="center muted">${escapeHtml(vm.businessPhone)}</p>` : ""}
    <p class="center doc-title">Delivery Note</p>
    <p class="center muted">${escapeHtml(vm.deliveryNoteNumber)}</p>
    <hr/>
    <p class="section-label">Deliver To</p>
    ${deliveryNoteThermalField("Recipient", vm.recipientName)}
    ${deliveryNoteThermalField("Address", address)}
    ${deliveryNoteThermalField("Notes", vm.deliveryNotes)}
    <hr/>
    <p class="section-label">Rider</p>
    ${deliveryNoteThermalField("Name", vm.riderName ?? "Not assigned")}
    ${deliveryNoteThermalField("Phone", vm.riderPhone)}
    ${deliveryNoteThermalField("Vehicle", vm.riderVehicleDescription)}
    <hr/>
    <p class="muted">
      ${escapeHtml(vm.sourceDocumentLabel)}: ${escapeHtml(vm.sourceDocumentNumber ?? "-")}<br/>
      ${escapeHtml(vm.dateLabel)}
    </p>
  </div>
</body>
</html>`;
}

/** Prints the delivery note through the configured system/USB thermal printer via the same
 * pdf-to-printer pipeline used for compact receipts, straight down the roll like every other
 * document — no logo (matches the compact receipt, which is text-only for the same reason: a
 * thermal printhead burns a photo/logo far too faint to be worth the space). */
export async function printDeliveryNoteViaThermal(deliveryNoteId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  const settings = loadPrinterSettings();
  if (!settings.enabled || (requiresExplicitAddress(settings) && !settings.address)) {
    return { success: false, message: "No printer is configured yet. Set one up in Settings." };
  }
  if (settings.connectionType !== "usb") {
    return {
      success: false,
      message: "This backup print needs a printer set up as a Windows/USB printer in Settings (not a raw network/serial connection)."
    };
  }

  const { vm } = loadDeliveryNoteData(deliveryNoteId);
  const html = buildDeliveryNoteThermalHtml(vm);
  const buffer = await renderThermalHtmlToPdfBuffer(html, resolveThermalPageWidthIn(settings.paperWidth));
  const tempPath = join(app.getPath("temp"), `blue-ledger-delivery-note-${randomUUID()}.pdf`);
  await writeFile(tempPath, buffer);
  try {
    // See printReceiptToSystemPrinter's own comment — noscale is the real fix for the blank-space
    // bug, not the page height above.
    await printPdfToPrinter(tempPath, { silent: true, scale: "noscale", ...(settings.address ? { printer: settings.address } : {}) });
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print delivery note" };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

/** Sends the delivery note straight to Windows' default printer — an A4 cut-out sticker card, meant
 * to be printed and stuck onto a package. Uses pdf-to-printer (see printHtmlViaSystemPrinter), not
 * webContents.print(), which fails with "Invalid printer settings" whenever a POS/label printer is
 * among the installed devices — the same root cause already fixed for receipts. For a narrow thermal
 * roll printer with no A4 tray at all, use printDeliveryNoteViaThermal instead. */
export async function printDeliveryNote(deliveryNoteId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  const { vm, locationId } = loadDeliveryNoteData(deliveryNoteId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildDeliveryNoteHtml(vm, logo);

  try {
    await printHtmlViaSystemPrinter(html, "delivery-note");
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print delivery note" };
  }
}

/** Renders the delivery note to PDF and prompts the user for a save location. Returns the saved
 * path, or null if cancelled. */
export async function generateDeliveryNotePdf(deliveryNoteId: string): Promise<string | null> {
  requirePermission("sales", "view");
  const { vm, locationId } = loadDeliveryNoteData(deliveryNoteId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildDeliveryNoteHtml(vm, logo);
  const buffer = await renderHtmlToPdfBuffer(html);

  const result = await dialog.showSaveDialog({
    title: "Save Delivery Note",
    defaultPath: `${vm.deliveryNoteNumber}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  await writeFile(result.filePath, buffer);
  return result.filePath;
}

/** Opens the delivery note in a preview window instead of prompting for a save location — see
 * openPdfPreviewWindow's own doc comment. Same data-loading/HTML-build as generateDeliveryNotePdf. */
export async function previewDeliveryNotePdf(deliveryNoteId: string): Promise<void> {
  requirePermission("sales", "view");
  const { vm, locationId } = loadDeliveryNoteData(deliveryNoteId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildDeliveryNoteHtml(vm, logo);
  const buffer = await renderHtmlToPdfBuffer(html);
  await openPdfPreviewWindow(buffer, `${vm.deliveryNoteNumber}.pdf`, `Delivery Note ${vm.deliveryNoteNumber}`);
}

type StockReceiptDocumentViewModel = {
  receiptNumber: string;
  locationName: string;
  allocationStorefrontName: string | null;
  receivedByName: string;
  notes: string | null;
  createdAt: string;
  /** See StockReceiptRow.is_transfer's own comment (stock-receipt-repository.ts) — derived, not
   * stored; distinguishes a plain Goods Received Note from an internal Main Store transfer note. */
  isTransfer: boolean;
  items: Array<{
    productName: string;
    sku: string;
    quantityReceived: number;
    previousQuantity: number;
    newQuantity: number;
  }>;
};

function loadStockReceiptData(stockReceiptId: string): { vm: StockReceiptDocumentViewModel; locationId: string } {
  const row = stockReceiptRepository.findStockReceiptRowById(stockReceiptId);
  if (!row) {
    throw new Error("Goods received note not found");
  }
  const items = stockReceiptRepository.findStockReceiptItemRows(stockReceiptId);

  return {
    vm: {
      receiptNumber: row.receipt_number,
      locationName: row.location_name,
      allocationStorefrontName: row.allocation_storefront_name,
      receivedByName: row.received_by_name,
      notes: row.notes,
      createdAt: row.created_at,
      isTransfer: row.is_transfer > 0,
      items: items.map((item) => ({
        productName: item.product_name,
        sku: item.sku,
        quantityReceived: item.quantity_received,
        previousQuantity: item.previous_quantity,
        newQuantity: item.new_quantity
      }))
    },
    locationId: row.location_id
  };
}

/** A plain A4 portrait table document — deliberately not one of the three types (receipts/invoices/
 * quotations) with tenant-configurable custom headers/footers, since a Goods Received Note is an
 * internal stock record, not a customer-facing document. Explicit `@page { size: A4 portrait }`
 * per this feature's own requirement that it never print landscape like the wide item tables
 * elsewhere in this file sometimes do. */
function buildStockReceiptHtml(vm: StockReceiptDocumentViewModel, business: DocumentBusinessInfo, logo: DocumentLogo): string {
  const itemRows = vm.items
    .map(
      (item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.productName)}<div class="muted">${escapeHtml(item.sku)}</div></td>
        <td class="center">${item.quantityReceived}</td>
        <td class="right">${item.previousQuantity}</td>
        <td class="right">${item.newQuantity}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1710; margin: 0; padding: 48px; font-size: 13px; }
  .sheet { max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #061e64; padding-bottom: 16px; }
  .logo { display: block; height: auto; max-height: 64px; width: auto; max-width: 220px; object-fit: contain; margin-bottom: 8px; }
  .business-name { font-size: 20px; font-weight: bold; color: #061e64; margin: 0; }
  .muted { color: #666; font-size: 11px; }
  .doc-title { font-size: 24px; font-weight: bold; text-align: right; color: #061e64; margin: 0; letter-spacing: 1px; }
  .meta { display: flex; justify-content: space-between; margin-top: 20px; gap: 24px; }
  .meta-block p { margin: 2px 0; }
  .meta-block .label { font-size: 10px; text-transform: uppercase; color: #83795f; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #83795f; border-bottom: 2px solid #ddd5c2; padding: 6px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  .center { text-align: center; }
  .right { text-align: right; white-space: nowrap; }
  .notes { margin-top: 24px; padding: 12px; background: #f1ede1; border-radius: 8px; }
  .footer { margin-top: 32px; text-align: center; color: #83795f; font-size: 11px; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        ${logo.logoDataUrl ? `<img src="${logo.logoDataUrl}" class="logo" alt="" />` : ""}
        <p class="business-name">${escapeHtml(business.businessName)}</p>
        ${business.physicalAddress ? `<p class="muted">${escapeHtml(business.physicalAddress)}</p>` : ""}
        ${business.primaryPhone ? `<p class="muted">${escapeHtml(business.primaryPhone)}</p>` : ""}
      </div>
      <div>
        <p class="doc-title">${vm.isTransfer ? "STOCK TRANSFER" : "GOODS RECEIVED"}</p>
        <p class="muted" style="text-align:right;">${escapeHtml(vm.receiptNumber)}</p>
      </div>
    </div>

    <div class="meta">
      <div class="meta-block">
        <p class="label">${vm.isTransfer ? "Transferred To" : "Received Into"}</p>
        <p><strong>${escapeHtml(vm.locationName)}</strong></p>
        ${vm.isTransfer ? `<p class="label" style="margin-top:10px;">Source</p><p>Main Store</p>` : ""}
        ${vm.allocationStorefrontName ? `<p class="label" style="margin-top:10px;">Earmarked For</p><p>${escapeHtml(vm.allocationStorefrontName)}</p>` : ""}
      </div>
      <div class="meta-block">
        <p class="label">Received By</p>
        <p>${escapeHtml(vm.receivedByName)}</p>
        <p class="label" style="margin-top:10px;">Date</p>
        <p>${formatInvoiceDate(vm.createdAt)}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th class="center">Qty Received</th>
          <th class="right">Stock Before</th>
          <th class="right">Stock After</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    ${vm.notes ? `<div class="notes"><strong>Notes</strong><p>${escapeHtml(vm.notes)}</p></div>` : ""}

    <div class="footer">Internal stock record — generated by Blue Ledger POS</div>
  </div>
</body>
</html>`;
}

export async function printStockReceipt(stockReceiptId: string): Promise<PrinterActionResult> {
  requirePermission("inventory", "view");
  const { vm, locationId } = loadStockReceiptData(stockReceiptId);
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Business profile not found");
  }
  const business = resolveDocumentBusiness(locationId, tenantRow);
  const logo = await resolveDocumentLogo(locationId, tenantRow);
  const html = buildStockReceiptHtml(vm, business, logo);

  try {
    await printHtmlViaSystemPrinter(html, "stock-receipt");
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print goods received note" };
  }
}

/** Renders the goods received note to PDF and prompts the user for a save location. Returns the
 * saved path, or null if cancelled. */
export async function generateStockReceiptPdf(stockReceiptId: string): Promise<string | null> {
  requirePermission("inventory", "view");
  const { vm, locationId } = loadStockReceiptData(stockReceiptId);
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Business profile not found");
  }
  const business = resolveDocumentBusiness(locationId, tenantRow);
  const logo = await resolveDocumentLogo(locationId, tenantRow);
  const html = buildStockReceiptHtml(vm, business, logo);
  const buffer = await renderHtmlToPdfBuffer(html);

  const result = await dialog.showSaveDialog({
    title: "Save Goods Received Note",
    defaultPath: `${vm.receiptNumber}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  await writeFile(result.filePath, buffer);
  return result.filePath;
}

/** Opens the goods received note in a preview window instead of prompting for a save location — see
 * openPdfPreviewWindow's own doc comment. Same data-loading/HTML-build as generateStockReceiptPdf. */
export async function previewStockReceiptPdf(stockReceiptId: string): Promise<void> {
  requirePermission("inventory", "view");
  const { vm, locationId } = loadStockReceiptData(stockReceiptId);
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Business profile not found");
  }
  const business = resolveDocumentBusiness(locationId, tenantRow);
  const logo = await resolveDocumentLogo(locationId, tenantRow);
  const html = buildStockReceiptHtml(vm, business, logo);
  const buffer = await renderHtmlToPdfBuffer(html);
  await openPdfPreviewWindow(buffer, `${vm.receiptNumber}.pdf`, `${vm.isTransfer ? "Stock Transfer" : "Goods Received"} ${vm.receiptNumber}`);
}

/** Builds a Statement of Account — not tied to one storefront (a customer's invoices can span
 * several), so unlike every other document template here this one never resolves a per-location
 * business override; vm's business fields are already the tenant-wide default (see
 * statement-service.ts). Reuses the same letterhead styling as buildInvoiceHtml for visual family. */
function buildStatementHtml(vm: CustomerStatementViewModel): string {
  const money = (cents: number): string => `${vm.currency} ${formatReceiptCents(cents)}`;

  const rows =
    vm.invoices
      .map(
        (invoice, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(invoice.invoiceNumber ?? "-")}</td>
        <td>${formatInvoiceDate(invoice.invoiceDate)}</td>
        <td>${formatInvoiceDate(invoice.dueDate)}</td>
        <td class="right">${money(invoice.grandTotalCents)}</td>
        <td class="right">${money(invoice.amountPaidCents)}</td>
        <td class="right">${money(invoice.balanceDueCents)}</td>
        <td><span class="badge">${escapeHtml(paymentStatusLabel(invoice.paymentStatus))}</span></td>
      </tr>`
      )
      .join("") ||
    `<tr><td colspan="8" class="center muted" style="padding:16px 4px;">No outstanding invoices</td></tr>`;

  const availableCreditCents =
    vm.creditLimitCents !== null ? Math.max(0, vm.creditLimitCents - vm.totalOutstandingCents) : null;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${LETTERHEAD_STYLES}</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div class="header-row">
        <div>
          <p class="business-name">${escapeHtml(vm.businessName)}</p>
          ${vm.physicalAddress ? `<p class="muted">${escapeHtml(vm.physicalAddress)}</p>` : ""}
          ${vm.primaryPhone ? `<p class="muted">${escapeHtml(vm.primaryPhone)}</p>` : ""}
        </div>
        <div>
          <p class="invoice-title">STATEMENT</p>
          <p class="muted" style="text-align:right;">${formatInvoiceDate(vm.generatedAt)}</p>
        </div>
      </div>
    </div>

    <div class="bill-to">
      <p class="label">Statement For</p>
      <p class="name">${escapeHtml(vm.customerName)}</p>
      <p class="muted">${escapeHtml(vm.customerPhone)}</p>
      ${vm.customerEmail ? `<p class="muted">${escapeHtml(vm.customerEmail)}</p>` : ""}
    </div>

    ${
      vm.creditLimitCents !== null && availableCreditCents !== null
        ? `<table class="meta-table">
      <thead>
        <tr><th>Credit Limit</th><th>Available Credit</th></tr>
      </thead>
      <tbody>
        <tr><td>${money(vm.creditLimitCents)}</td><td>${money(availableCreditCents)}</td></tr>
      </tbody>
    </table>`
        : ""
    }

    <div class="items-frame">
      <table class="items-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Invoice</th>
            <th>Date</th>
            <th>Due</th>
            <th class="right">Total</th>
            <th class="right">Paid</th>
            <th class="right">Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="items-spacer"></div>
      <table class="totals-table">
        <tr><td>Total Invoiced</td><td>${money(vm.totalInvoicedCents)}</td></tr>
        <tr><td>Total Paid</td><td>${money(vm.totalPaidCents)}</td></tr>
        <tr class="balance"><td>Total Outstanding</td><td>${money(vm.totalOutstandingCents)}</td></tr>
      </table>
    </div>

    <div class="footer">Generated by ${escapeHtml(vm.businessName)} — please settle outstanding invoices at your earliest convenience.</div>
  </div>
</body>
</html>`;
}

/** Renders the statement to PDF and prompts the user for a save location. Returns the saved path, or null if cancelled. */
export async function generateStatementPdf(customerId: string): Promise<string | null> {
  requirePermission("sales", "view");
  const vm = getCustomerStatement(customerId);
  const html = buildStatementHtml(vm);
  const buffer = await renderHtmlToPdfBuffer(html);

  const result = await dialog.showSaveDialog({
    title: "Save Statement",
    defaultPath: `Statement-${vm.customerName.replace(/[^a-z0-9]+/gi, "-")}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (result.canceled || !result.filePath) {
    return null;
  }

  await writeFile(result.filePath, buffer);
  return result.filePath;
}

/** Opens the statement in a preview window instead of prompting for a save location — see
 * openPdfPreviewWindow's own doc comment. Same data-loading/HTML-build as generateStatementPdf. */
export async function previewStatementPdf(customerId: string): Promise<void> {
  requirePermission("sales", "view");
  const vm = getCustomerStatement(customerId);
  const html = buildStatementHtml(vm);
  const buffer = await renderHtmlToPdfBuffer(html);
  const filename = `Statement-${vm.customerName.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
  await openPdfPreviewWindow(buffer, filename, `Statement — ${vm.customerName}`);
}

/** Sends the statement straight to Windows' default printer — same A4 system-printer path as
 * printInvoiceDocument, not the ESC/POS thermal one. */
export async function printStatementDocument(customerId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  try {
    const vm = getCustomerStatement(customerId);
    const html = buildStatementHtml(vm);
    await printHtmlViaSystemPrinter(html, "statement");
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print statement" };
  }
}


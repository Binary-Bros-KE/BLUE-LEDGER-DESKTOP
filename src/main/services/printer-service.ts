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
import * as quotationRepository from "@main/database/repositories/quotation-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import * as serviceChargeRepository from "@main/database/repositories/service-charge-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { requirePermission } from "@main/services/auth-service";
import { readManagedBusinessLogoPreview, readManagedLocationLogoPreview } from "@main/services/image-service";
import { getSalary } from "@main/services/salary-service";
import { getCustomerStatement } from "@main/services/statement-service";
import { PRINTER_SETTINGS_STORAGE_KEY } from "@shared/constants/app";
import { buildDeliveryNoteViewModel, type DeliveryNoteViewModel } from "@shared/lib/delivery-note";
import { buildReceiptViewModel, formatReceiptCents, type ReceiptViewModel } from "@shared/lib/receipt";
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
  TRANSACTION_TYPE_OPTIONS,
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

function loadReceiptData(saleId: string): { sale: Sale; business: Parameters<typeof buildReceiptViewModel>[1] } {
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
  printerInstance.leftRight("Tax", money(vm.taxAmountCents));
  printerInstance.bold(true);
  printerInstance.leftRight("TOTAL", money(vm.grandTotalCents));
  printerInstance.bold(false);
  printerInstance.drawLine();

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

async function printReceiptToSystemPrinter(vm: ReceiptViewModel, deviceName: string): Promise<void> {
  const html = buildReceiptHtml(vm);
  // Matches the Aclas driver's own reported page size (80(72.1)x297mm) — without an explicit narrow
  // pageSize, printToPDF defaults to a full Letter page, which the thermal driver can't reconcile
  // with an 80mm roll and simply prints blank.
  const buffer = await renderHtmlToPdfBuffer(html, {
    pageSize: { width: 3.15, height: 11.69 },
    margins: { marginType: "none" }
  });
  const tempPath = join(app.getPath("temp"), `blue-ledger-receipt-${randomUUID()}.pdf`);
  await writeFile(tempPath, buffer);
  try {
    await printPdfToPrinter(tempPath, { silent: true, ...(deviceName ? { printer: deviceName } : {}) });
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
      await printReceiptToSystemPrinter(viewModel, settings.address);
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
        <td>${escapeHtml(item.name)}<br/><span class="muted">${item.quantity} x ${money(item.unitPriceCents)}</span></td>
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
  body { font-family: Arial, 'Segoe UI', Helvetica, sans-serif; color: #1c1710; margin: 0; padding: 4px 8px; font-size: 12px; font-weight: 700; }
  .receipt { max-width: 100%; margin: 0 auto; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #1c1710; font-size: 10.5px; }
  hr { border: none; border-top: 1px dashed #999; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 4px 0; vertical-align: top; }
  .right { text-align: right; white-space: nowrap; }
  .totals td { padding: 2px 0; }
  .grand { font-weight: bold; font-size: 13px; }
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
    <hr/>
    <table>${itemRows}</table>
    <hr/>
    <table class="totals">
      <tr><td>Subtotal</td><td class="right">${money(vm.subtotalCents)}</td></tr>
      ${vm.discountAmountCents > 0 ? `<tr><td>Discount</td><td class="right">-${money(vm.discountAmountCents)}</td></tr>` : ""}
      <tr><td>Tax</td><td class="right">${money(vm.taxAmountCents)}</td></tr>
      <tr class="grand"><td>Total</td><td class="right">${money(vm.grandTotalCents)}</td></tr>
    </table>
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
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1710; margin: 0; padding: 48px; font-size: 13px; }
  .sheet { max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #061e64; padding-bottom: 16px; }
  .logo { display: block; height: auto; max-height: 64px; width: auto; max-width: 220px; object-fit: contain; margin-bottom: 8px; }
  .business-name { font-size: 20px; font-weight: bold; color: #061e64; margin: 0; }
  .muted { color: #666; font-size: 11px; }
  .invoice-title { font-size: 26px; font-weight: bold; text-align: right; color: #061e64; margin: 0; letter-spacing: 1px; }
  .meta { display: flex; justify-content: space-between; margin-top: 20px; gap: 24px; }
  .meta-block p { margin: 2px 0; }
  .meta-block .label { font-size: 10px; text-transform: uppercase; color: #83795f; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #83795f; border-bottom: 2px solid #ddd5c2; padding: 6px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  .center { text-align: center; }
  .right { text-align: right; white-space: nowrap; }
  .totals { width: 260px; margin-left: auto; margin-top: 16px; }
  .totals td { border-bottom: none; padding: 3px 4px; }
  .totals .grand td { font-size: 15px; font-weight: bold; border-top: 2px solid #061e64; padding-top: 8px; }
  .payment { margin-top: 20px; }
  .payment p { margin: 2px 0; }
  .footer { margin-top: 32px; text-align: center; color: #83795f; font-size: 11px; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
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

    <div class="meta">
      <div class="meta-block">
        <p class="label">Sold To</p>
        <p><strong>${escapeHtml(vm.customerName ?? "Walk-in Customer")}</strong></p>
      </div>
      <div class="meta-block">
        <p class="label">Date</p>
        <p>${escapeHtml(vm.dateLabel)}</p>
      </div>
      <div class="meta-block">
        <p class="label">Storefront</p>
        <p>${escapeHtml(vm.branchName)}</p>
        <p class="label" style="margin-top:10px;">Served By</p>
        <p>${escapeHtml(vm.cashierName)}</p>
      </div>
    </div>

    <table>
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

    <table class="totals">
      <tr><td>Subtotal</td><td class="right">${money(vm.subtotalCents)}</td></tr>
      ${vm.discountAmountCents > 0 ? `<tr><td>Discount</td><td class="right">-${money(vm.discountAmountCents)}</td></tr>` : ""}
      <tr><td>Tax</td><td class="right">${money(vm.taxAmountCents)}</td></tr>
      <tr class="grand"><td>Total</td><td class="right">${money(vm.grandTotalCents)}</td></tr>
    </table>

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
    return await win.webContents.printToPDF({
      printBackground: true,
      landscape: options?.landscape ?? false,
      ...(options?.pageSize ? { pageSize: options.pageSize } : {}),
      ...(options?.margins ? { margins: options.margins } : {})
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

function paymentStatusLabel(status: Sale["paymentStatus"]): string {
  return PAYMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function transactionTypeLabel(type: Sale["transactionType"]): string {
  return TRANSACTION_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function formatInvoiceDate(value: string | null): string {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

type DocumentLogo = { logoDataUrl: string | null; logoRatio: LogoRatio | null };

type DocumentBusinessInfo = {
  businessName: string;
  physicalAddress: string | null;
  primaryPhone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  currency: string;
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
    currency: tenantRow.currency
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

/** Renders service charges + delivery fee as ordinary rows appended to an invoice/quotation's item
 * table — Discount/Tax show as "-" since these aren't product lines, and the hidden cost never
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
        <td class="right">-</td>
        <td class="right">${money(charge.feeCents)}</td>
      </tr>`);
  }

  if (delivery) {
    index += 1;
    rows.push(`
      <tr>
        <td>${index}</td>
        <td>Delivery Fee</td>
        <td class="center">1</td>
        <td class="right">${money(delivery.feeCents)}</td>
        <td class="right">-</td>
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
  logo: DocumentLogo
): string {
  const money = (cents: number | null): string =>
    `${business.currency} ${formatReceiptCents(cents)}`;

  const itemRows = sale.items
    .map(
      (item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.productName)}<div class="muted">${escapeHtml(item.sku)}</div></td>
        <td class="center">${item.quantity}</td>
        <td class="right">${money(item.unitPriceCents)}</td>
        <td class="right">${item.discountAmountCents > 0 ? `-${money(item.discountAmountCents)}` : "-"}</td>
        <td class="right">${money(item.taxAmountCents)}</td>
        <td class="right">${money(item.lineTotalCents)}</td>
      </tr>`
    )
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
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1710; margin: 0; padding: 48px; font-size: 13px; }
  .sheet { max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #061e64; padding-bottom: 16px; }
  .logo { display: block; height: auto; max-height: 64px; width: auto; max-width: 220px; object-fit: contain; margin-bottom: 8px; }
  .business-name { font-size: 20px; font-weight: bold; color: #061e64; margin: 0; }
  .muted { color: #666; font-size: 11px; }
  .invoice-title { font-size: 26px; font-weight: bold; text-align: right; color: #061e64; margin: 0; letter-spacing: 1px; }
  .badge { display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: bold; text-transform: uppercase; background: #f1ede1; color: #1c1710; }
  .meta { display: flex; justify-content: space-between; margin-top: 20px; gap: 24px; }
  .meta-block p { margin: 2px 0; }
  .meta-block .label { font-size: 10px; text-transform: uppercase; color: #83795f; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #83795f; border-bottom: 2px solid #ddd5c2; padding: 6px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  .center { text-align: center; }
  .right { text-align: right; white-space: nowrap; }
  .totals { width: 260px; margin-left: auto; margin-top: 16px; }
  .totals td { border-bottom: none; padding: 3px 4px; }
  .totals .grand td { font-size: 15px; font-weight: bold; border-top: 2px solid #061e64; padding-top: 8px; }
  .totals .balance td { font-size: 15px; font-weight: bold; color: #ad3a29; }
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
        <p class="invoice-title">INVOICE</p>
        <p class="muted" style="text-align:right;">${escapeHtml(sale.invoiceNumber ?? "-")}</p>
        <div style="text-align:right;"><span class="badge">${escapeHtml(paymentStatusLabel(sale.paymentStatus))}</span></div>
      </div>
    </div>

    <div class="meta">
      <div class="meta-block">
        <p class="label">Bill To</p>
        <p><strong>${escapeHtml(sale.customerName ?? "Walk-in Customer")}</strong></p>
        <p class="label" style="margin-top:10px;">Transaction Type</p>
        <p>${escapeHtml(transactionTypeLabel(sale.transactionType))}</p>
      </div>
      <div class="meta-block">
        <p class="label">Invoice Date</p>
        <p>${formatInvoiceDate(sale.invoiceDate)}</p>
        <p class="label" style="margin-top:10px;">Due Date</p>
        <p>${formatInvoiceDate(sale.dueDate)}</p>
      </div>
      <div class="meta-block">
        <p class="label">Storefront</p>
        <p>${escapeHtml(sale.locationName)}</p>
        <p class="label" style="margin-top:10px;">Issued By</p>
        <p>${escapeHtml(sale.employeeName)}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th class="center">Qty</th>
          <th class="right">Unit Price</th>
          <th class="right">Discount</th>
          <th class="right">Tax</th>
          <th class="right">Line Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <table class="totals">
      <tr><td>Subtotal</td><td class="right">${money(sale.subtotalCents)}</td></tr>
      ${sale.discountAmountCents > 0 ? `<tr><td>Discount</td><td class="right">-${money(sale.discountAmountCents)}</td></tr>` : ""}
      <tr><td>Tax</td><td class="right">${money(sale.taxAmountCents)}</td></tr>
      <tr class="grand"><td>Total</td><td class="right">${money(sale.grandTotalCents)}</td></tr>
      <tr><td>Amount Paid</td><td class="right">${money(sale.amountPaidCents)}</td></tr>
      <tr class="balance"><td>Balance Due</td><td class="right">${money(sale.balanceDueCents)}</td></tr>
    </table>

    ${
      sale.payments.length > 0
        ? `<table>
      <thead>
        <tr><th>Date</th><th>Method</th><th>Reference</th><th>Received By</th><th class="right">Amount</th></tr>
      </thead>
      <tbody>${paymentRows}</tbody>
    </table>`
        : ""
    }

    ${sale.invoiceNotes ? `<div class="notes"><strong>Notes</strong><p>${escapeHtml(sale.invoiceNotes)}</p></div>` : ""}

    <div class="footer">${escapeHtml(business.receiptFooter ?? "Thank you for your business!")}</div>
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
  const html = buildInvoiceHtml(sale, business, logo);
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
  const html = buildInvoiceHtml(sale, business, logo);

  try {
    await printHtmlViaSystemPrinter(html, "invoice");
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print invoice" };
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
  logo: DocumentLogo
): string {
  const money = (cents: number | null): string => `${business.currency} ${formatReceiptCents(cents)}`;

  const itemRows = quotation.items
    .map(
      (item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.productName)}<div class="muted">${escapeHtml(item.sku)}</div></td>
        <td class="center">${item.quantity}</td>
        <td class="right">${money(item.unitPriceCents)}</td>
        <td class="right">${item.discountAmountCents > 0 ? `-${money(item.discountAmountCents)}` : "-"}</td>
        <td class="right">${money(item.taxAmountCents)}</td>
        <td class="right">${money(item.lineTotalCents)}</td>
      </tr>`
    )
    .join("") + buildExtraChargeRows(quotation.items.length, quotation.serviceCharges, quotation.delivery, money);

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
  .center { text-align: center; }
  .right { text-align: right; white-space: nowrap; }
  .totals { width: 260px; margin-left: auto; margin-top: 16px; }
  .totals td { border-bottom: none; padding: 3px 4px; }
  .totals .grand td { font-size: 15px; font-weight: bold; border-top: 2px solid #061e64; padding-top: 8px; }
  .notes { margin-top: 24px; padding: 12px; background: #f1ede1; border-radius: 8px; }
  .terms { margin-top: 16px; font-size: 11px; color: #666; }
  .signatures { display: flex; gap: 40px; margin-top: 56px; }
  .signature { flex: 1; }
  .signature .line { border-top: 1px solid #999; margin-top: 40px; padding-top: 4px; font-size: 11px; color: #83795f; }
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
        <p class="doc-title">QUOTATION</p>
        <p class="muted" style="text-align:right;">${escapeHtml(quotation.quotationNumber)}</p>
        <div style="text-align:right;"><span class="badge">${escapeHtml(quotationStatusLabel(quotation.status))}</span></div>
      </div>
    </div>

    <div class="meta">
      <div class="meta-block">
        <p class="label">Quoted To</p>
        <p><strong>${escapeHtml(quotation.customerName)}</strong></p>
      </div>
      <div class="meta-block">
        <p class="label">Date Prepared</p>
        <p>${formatInvoiceDate(quotation.createdAt)}</p>
        <p class="label" style="margin-top:10px;">Valid Until</p>
        <p>${formatInvoiceDate(quotation.validUntil)}</p>
      </div>
      <div class="meta-block">
        <p class="label">Storefront</p>
        <p>${escapeHtml(quotation.locationName)}</p>
        <p class="label" style="margin-top:10px;">Prepared By</p>
        <p>${escapeHtml(quotation.employeeName)}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Product</th>
          <th class="center">Qty</th>
          <th class="right">Unit Price</th>
          <th class="right">Discount</th>
          <th class="right">Tax</th>
          <th class="right">Line Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <table class="totals">
      <tr><td>Subtotal</td><td class="right">${money(quotation.subtotalCents)}</td></tr>
      ${quotation.discountAmountCents > 0 ? `<tr><td>Discount</td><td class="right">-${money(quotation.discountAmountCents)}</td></tr>` : ""}
      <tr><td>Tax</td><td class="right">${money(quotation.taxAmountCents)}</td></tr>
      <tr class="grand"><td>Total</td><td class="right">${money(quotation.grandTotalCents)}</td></tr>
    </table>

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

    <div class="footer">${escapeHtml(business.receiptFooter ?? "Thank you for considering us!")}</div>
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
  const html = buildQuotationHtml(quotation, business, logo);
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

/** Opens the native print dialog for the quotation document — a regular A4 printer, not the ESC/POS thermal one. */
/** Same fix as printInvoiceDocument — pdf-to-printer instead of webContents.print(). */
export async function printQuotationDocument(quotationId: string): Promise<PrinterActionResult> {
  requirePermission("quotations", "view");
  const { quotation, business } = loadQuotationData(quotationId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(quotation.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildQuotationHtml(quotation, business, logo);

  try {
    await printHtmlViaSystemPrinter(html, "quotation");
    return { success: true, message: "Sent to printer" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print quotation" };
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

/**
 * A backup for shops with only a narrow thermal receipt printer and no pre-printed sticker labels.
 * A thermal roll has no orientation concept — it only prints a fixed-width strip — so this lays the
 * note out at "landscape" proportions (wide x short) and rotates the whole thing 90° before printing.
 * The strip comes out with text running bottom-to-top; physically rotating the printed strip 90°
 * (portrait -> landscape) then reads it right-side-up, ready to stick onto a package with clear tape.
 * Deliberately excludes every fee/cost figure, same as the regular delivery note.
 */
function buildDeliveryNoteThermalHtml(vm: DeliveryNoteViewModel, logo: DocumentLogo, paperWidthIn: number): string {
  const townCountry = [vm.town, vm.country].filter(Boolean).join(", ");
  // The "true" design is a short, wide landscape strip (stageHeight x stageWidth); rotating it 90°
  // clockwise around its top-left corner and shifting up by its own height turns that WxH box into an
  // HxW strip that exactly fills the printer's actual (narrow, tall) page — the standard CSS recipe
  // for printing landscape content on a portrait-only device.
  const stageHeight = paperWidthIn;
  const stageWidth = 11; // generous — the printer driver clips/continues the roll, it doesn't paginate

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  @page { size: ${paperWidthIn}in ${stageWidth}in; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, 'Segoe UI', Helvetica, sans-serif; color: #1c1710; font-weight: 700; }
  .stage {
    position: absolute; top: 0; left: 0;
    width: ${stageWidth}in; height: ${stageHeight}in;
    transform-origin: top left;
    transform: rotate(90deg) translateY(-100%);
    padding: 0.12in 0.2in;
    display: flex; align-items: center; gap: 0.3in;
  }
  .col { flex: 1; min-width: 0; }
  .logo { display: block; height: auto; max-height: 0.45in; width: auto; max-width: 1.1in; object-fit: contain; margin-bottom: 2px; }
  .business-name { font-size: 13px; font-weight: 700; margin: 0; }
  .muted { color: #1c1710; font-size: 9px; margin: 1px 0 0; font-weight: 700; }
  .doc-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 3px; }
  .field-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.4px; margin: 0; }
  .field-value { font-size: 13px; font-weight: 700; margin: 0 0 4px; line-height: 1.2; word-break: break-word; }
  .recipient .field-value { font-size: 17px; }
  .divider { width: 1px; align-self: stretch; background: #1c1710; opacity: 0.25; }
</style>
</head>
<body>
  <div class="stage">
    <div class="col" style="flex: 0 0 1.3in;">
      ${logo.logoDataUrl ? `<img src="${logo.logoDataUrl}" class="logo" alt="" />` : ""}
      <p class="business-name">${escapeHtml(vm.businessName)}</p>
      ${vm.businessPhone ? `<p class="muted">${escapeHtml(vm.businessPhone)}</p>` : ""}
      <p class="doc-title" style="margin-top: 6px;">Delivery Note</p>
      <p class="muted">${escapeHtml(vm.deliveryNoteNumber)}</p>
    </div>
    <div class="divider"></div>
    <div class="col recipient">
      <p class="field-label">Deliver To</p>
      <p class="field-value">${escapeHtml(vm.recipientName)}</p>
      <p class="field-label">Address</p>
      <p class="field-value">${escapeHtml(vm.deliveryAddress)}${townCountry ? `, ${escapeHtml(townCountry)}` : ""}</p>
      ${vm.deliveryNotes ? `<p class="field-label">Notes</p><p class="field-value">${escapeHtml(vm.deliveryNotes)}</p>` : ""}
    </div>
    <div class="divider"></div>
    <div class="col" style="flex: 0 0 1.8in;">
      <p class="field-label">Rider</p>
      <p class="field-value">${escapeHtml(vm.riderName ?? "Not assigned")}</p>
      ${vm.riderPhone ? `<p class="field-label">Phone</p><p class="field-value">${escapeHtml(vm.riderPhone)}</p>` : ""}
      <p class="muted" style="margin-top: 6px;">${escapeHtml(vm.sourceDocumentLabel)}: ${escapeHtml(vm.sourceDocumentNumber ?? "-")}</p>
    </div>
  </div>
</body>
</html>`;
}

/** Prints the delivery note through the configured system/USB thermal printer via the same
 * pdf-to-printer pipeline used for compact receipts, using the rotated layout above. */
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

  const { vm, locationId } = loadDeliveryNoteData(deliveryNoteId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  // Matches the same fixed 80mm-roll page size the compact receipt print already uses (see
  // printReceiptToSystemPrinter) — there's no per-tenant physical-paper-width setting in this app;
  // `settings.paperWidth` is the thermal-printer character width, an unrelated unit.
  const paperWidthIn = 3.15;
  const html = buildDeliveryNoteThermalHtml(vm, logo, paperWidthIn);
  const buffer = await renderHtmlToPdfBuffer(html, {
    pageSize: { width: paperWidthIn, height: 11 },
    margins: { marginType: "none" }
  });
  const tempPath = join(app.getPath("temp"), `blue-ledger-delivery-note-${randomUUID()}.pdf`);
  await writeFile(tempPath, buffer);
  try {
    await printPdfToPrinter(tempPath, { silent: true, ...(settings.address ? { printer: settings.address } : {}) });
    return { success: true, message: "Sent to the receipt printer — rotate the printed strip 90° once it's out." };
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
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1710; margin: 0; padding: 48px; font-size: 13px; }
  .sheet { max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #061e64; padding-bottom: 16px; }
  .business-name { font-size: 20px; font-weight: bold; color: #061e64; margin: 0; }
  .muted { color: #666; font-size: 11px; }
  .invoice-title { font-size: 26px; font-weight: bold; text-align: right; color: #061e64; margin: 0; letter-spacing: 1px; }
  .meta { display: flex; justify-content: space-between; margin-top: 20px; gap: 24px; }
  .meta-block p { margin: 2px 0; }
  .meta-block .label { font-size: 10px; text-transform: uppercase; color: #83795f; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: #83795f; border-bottom: 2px solid #ddd5c2; padding: 6px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  .center { text-align: center; }
  .right { text-align: right; white-space: nowrap; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 10px; font-weight: bold; text-transform: uppercase; background: #f1ede1; color: #1c1710; }
  .totals { width: 260px; margin-left: auto; margin-top: 16px; }
  .totals td { border-bottom: none; padding: 3px 4px; }
  .totals .grand td { font-size: 15px; font-weight: bold; border-top: 2px solid #061e64; padding-top: 8px; color: #ad3a29; }
  .footer { margin-top: 32px; text-align: center; color: #83795f; font-size: 11px; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
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

    <div class="meta">
      <div class="meta-block">
        <p class="label">Statement For</p>
        <p><strong>${escapeHtml(vm.customerName)}</strong></p>
        <p>${escapeHtml(vm.customerPhone)}</p>
        ${vm.customerEmail ? `<p>${escapeHtml(vm.customerEmail)}</p>` : ""}
      </div>
      ${
        vm.creditLimitCents !== null && availableCreditCents !== null
          ? `<div class="meta-block">
        <p class="label">Credit Limit</p>
        <p>${money(vm.creditLimitCents)}</p>
        <p class="label" style="margin-top:10px;">Available Credit</p>
        <p>${money(availableCreditCents)}</p>
      </div>`
          : ""
      }
    </div>

    <table>
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

    <table class="totals">
      <tr><td>Total Invoiced</td><td class="right">${money(vm.totalInvoicedCents)}</td></tr>
      <tr><td>Total Paid</td><td class="right">${money(vm.totalPaidCents)}</td></tr>
      <tr class="grand"><td>Total Outstanding</td><td class="right">${money(vm.totalOutstandingCents)}</td></tr>
    </table>

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


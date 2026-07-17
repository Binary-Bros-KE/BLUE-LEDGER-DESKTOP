import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import { ThermalPrinter, PrinterTypes } from "node-thermal-printer";
import { getDatabase } from "@main/database/connection";
import * as deliveryNoteRepository from "@main/database/repositories/delivery-note-repository";
import * as locationRepository from "@main/database/repositories/location-repository";
import * as quotationRepository from "@main/database/repositories/quotation-repository";
import * as saleRepository from "@main/database/repositories/sale-repository";
import * as serviceChargeRepository from "@main/database/repositories/service-charge-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { requirePermission } from "@main/services/auth-service";
import { readManagedBusinessLogoPreview, readManagedLocationLogoPreview } from "@main/services/image-service";
import { getSalary } from "@main/services/salary-service";
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
    business: {
      businessName: tenantRow.business_name,
      physicalAddress: tenantRow.physical_address,
      primaryPhone: tenantRow.primary_phone,
      receiptHeader: tenantRow.receipt_header,
      receiptFooter: tenantRow.receipt_footer,
      currency: tenantRow.currency
    }
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

export async function testPrinterConnection(): Promise<PrinterActionResult> {
  requirePermission("settings", "edit");
  const settings = loadPrinterSettings();
  if (!settings.address) {
    return { success: false, message: "Enter a printer address first" };
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

/** Sends the receipt straight to the configured ESC/POS thermal printer. */
export async function printReceipt(saleId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  const settings = loadPrinterSettings();
  if (!settings.enabled || !settings.address) {
    return { success: false, message: "No printer is configured yet. Set one up in Settings." };
  }

  const { sale, business } = loadReceiptData(saleId);
  const viewModel = buildReceiptViewModel(sale, business);
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
  body { font-family: 'Courier New', monospace; color: #1c1710; margin: 0; padding: 32px; }
  .receipt { max-width: 360px; margin: 0 auto; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 4px; }
  .center { text-align: center; }
  .muted { color: #666; font-size: 11px; }
  hr { border: none; border-top: 1px dashed #999; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 4px 0; vertical-align: top; }
  .right { text-align: right; white-space: nowrap; }
  .totals td { padding: 2px 0; }
  .grand { font-weight: bold; font-size: 14px; }
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

async function renderHtmlToPdfBuffer(html: string, options?: { landscape?: boolean }): Promise<Buffer> {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString("base64")}`);
    return await win.webContents.printToPDF({ printBackground: true, landscape: options?.landscape ?? false });
  } finally {
    win.destroy();
  }
}

/** Renders the receipt to PDF and prompts the user for a save location. Returns the saved path, or null if cancelled. */
export async function generateReceiptPdf(saleId: string): Promise<string | null> {
  requirePermission("sales", "view");
  const { sale, business } = loadReceiptData(saleId);
  const viewModel = buildReceiptViewModel(sale, business);
  const html = buildReceiptHtml(viewModel);
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

/** Prefers the storefront's own logo (if set); falls back to the business logo otherwise. Shared by
 * the invoice and quotation document builders. */
async function resolveDocumentLogo(locationId: string, tenantRow: tenantRepository.TenantRow): Promise<DocumentLogo> {
  const locationRow = locationRepository.findLocationRowById(locationId);
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
  business: { businessName: string; physicalAddress: string | null; primaryPhone: string | null; receiptFooter: string | null; currency: string },
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

/** Opens the native print dialog for the invoice document — a regular A4 printer, not the ESC/POS thermal one. */
export async function printInvoiceDocument(saleId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  const { sale, business } = loadReceiptData(saleId);
  if (!sale.invoiceNumber) {
    return { success: false, message: "This sale is not an invoice" };
  }

  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(sale.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildInvoiceHtml(sale, business, logo);
  const win = new BrowserWindow({ show: false });

  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString("base64")}`);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, errorType) => {
        if (success) resolve();
        else reject(new Error(errorType || "Print was cancelled"));
      });
    });
    return { success: true, message: "Print dialog opened" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print invoice" };
  } finally {
    win.destroy();
  }
}

function loadQuotationData(
  quotationId: string
): { quotation: Quotation; business: { businessName: string; physicalAddress: string | null; primaryPhone: string | null; receiptFooter: string | null; currency: string } } {
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
    business: {
      businessName: tenantRow.business_name,
      physicalAddress: tenantRow.physical_address,
      primaryPhone: tenantRow.primary_phone,
      receiptFooter: tenantRow.receipt_footer,
      currency: tenantRow.currency
    }
  };
}

function quotationStatusLabel(status: Quotation["status"]): string {
  return QUOTATION_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Builds a professional, letterhead-style A4 quotation document — reused for both print and PDF
 * download, and structured for later reuse by email/WhatsApp delivery. */
function buildQuotationHtml(
  quotation: Quotation,
  business: { businessName: string; physicalAddress: string | null; primaryPhone: string | null; receiptFooter: string | null; currency: string },
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
export async function printQuotationDocument(quotationId: string): Promise<PrinterActionResult> {
  requirePermission("quotations", "view");
  const { quotation, business } = loadQuotationData(quotationId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(quotation.locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildQuotationHtml(quotation, business, logo);
  const win = new BrowserWindow({ show: false });

  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString("base64")}`);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, errorType) => {
        if (success) resolve();
        else reject(new Error(errorType || "Print was cancelled"));
      });
    });
    return { success: true, message: "Print dialog opened" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print quotation" };
  } finally {
    win.destroy();
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
function loadSalaryData(salaryId: string): {
  salary: Salary;
  business: { businessName: string; physicalAddress: string | null; primaryPhone: string | null; receiptFooter: string | null; currency: string };
} {
  const salary = getSalary(salaryId);
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow) {
    throw new Error("Business profile not found");
  }

  return {
    salary,
    business: {
      businessName: tenantRow.business_name,
      physicalAddress: tenantRow.physical_address,
      primaryPhone: tenantRow.primary_phone,
      receiptFooter: tenantRow.receipt_footer,
      currency: tenantRow.currency
    }
  };
}

/** Builds a professional, letterhead-style A4 payslip — the same visual language as the invoice
 * and quotation documents, reused for both PDF download and the manual-share flow. */
function buildPayslipHtml(
  salary: Salary,
  business: { businessName: string; physicalAddress: string | null; primaryPhone: string | null; receiptFooter: string | null; currency: string },
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
        <p>${escapeHtml(salary.paymentMethodName)}</p>
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

    <div class="footer">${escapeHtml(business.receiptFooter ?? "This is a system-generated payslip.")}</div>
  </div>
</body>
</html>`;
}

async function resolveBusinessLogo(): Promise<DocumentLogo> {
  const tenantRow = tenantRepository.findTenantRow();
  if (!tenantRow?.business_logo_path) {
    return { logoDataUrl: null, logoRatio: null };
  }
  const logoDataUrl = await readManagedBusinessLogoPreview(tenantRow.business_logo_path);
  return logoDataUrl
    ? { logoDataUrl, logoRatio: tenantRow.business_logo_ratio as LogoRatio | null }
    : { logoDataUrl: null, logoRatio: null };
}

/** Renders the payslip to PDF and prompts the user for a save location. Returns the saved path, or
 * null if cancelled. Access is gated inside loadSalaryData() -> getSalary(), not here. */
export async function generateSalaryPdf(salaryId: string): Promise<string | null> {
  const { salary, business } = loadSalaryData(salaryId);
  const logo = await resolveBusinessLogo();
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
    const { salary, business } = loadSalaryData(salaryId);
    const logo = await resolveBusinessLogo();
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

  const vm = buildDeliveryNoteViewModel(
    delivery,
    {
      businessName: tenantRow.business_name,
      physicalAddress: tenantRow.physical_address,
      primaryPhone: tenantRow.primary_phone
    },
    { label: sourceLabel, number: sourceNumber, createdAt: sourceCreatedAt }
  );

  return { vm, locationId };
}

/** Wide/landscape, large-font layout meant to be printed and stuck onto a package with adhesive —
 * deliberately excludes every fee/cost figure (the view-model itself has no such fields). */
function buildDeliveryNoteHtml(vm: DeliveryNoteViewModel, logo: DocumentLogo): string {
  const addressLine = [vm.town, vm.country].filter(Boolean).join(", ");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  @page { size: A5 landscape; margin: 10mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c1710; margin: 0; padding: 16px; }
  .sheet { display: flex; flex-direction: column; height: 100%; min-height: 480px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 4px solid #061e64; padding-bottom: 12px; }
  .logo { display: block; height: auto; max-height: 60px; width: auto; max-width: 200px; object-fit: contain; margin-bottom: 6px; }
  .business-name { font-size: 20px; font-weight: bold; color: #061e64; margin: 0; }
  .muted { color: #666; font-size: 13px; }
  .doc-title { font-size: 30px; font-weight: bold; text-align: right; color: #061e64; margin: 0; letter-spacing: 2px; }
  .doc-number { font-size: 16px; font-weight: bold; text-align: right; margin-top: 4px; }
  .badge { display: inline-block; margin-top: 8px; padding: 4px 14px; border-radius: 999px; font-size: 13px; font-weight: bold; text-transform: uppercase; background: #1f9d55; color: #fff; }
  .body { flex: 1; display: flex; gap: 24px; margin-top: 20px; }
  .recipient { flex: 1.4; }
  .label { font-size: 13px; text-transform: uppercase; color: #83795f; font-weight: bold; letter-spacing: 1px; }
  .recipient-name { font-size: 38px; font-weight: bold; color: #1c1710; margin: 4px 0 10px; line-height: 1.1; }
  .address { font-size: 22px; font-weight: 600; line-height: 1.4; }
  .notes { margin-top: 14px; font-size: 15px; color: #444; }
  .rider { flex: 1; border-left: 3px dashed #ddd5c2; padding-left: 24px; }
  .rider-name { font-size: 24px; font-weight: bold; margin: 4px 0 2px; }
  .rider-field { font-size: 16px; margin-top: 6px; }
  .footer { margin-top: 20px; padding-top: 12px; border-top: 2px solid #ddd5c2; display: flex; justify-content: space-between; font-size: 12px; color: #83795f; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        ${logo.logoDataUrl ? `<img src="${logo.logoDataUrl}" class="logo" alt="" />` : ""}
        <p class="business-name">${escapeHtml(vm.businessName)}</p>
        ${vm.businessAddress ? `<p class="muted">${escapeHtml(vm.businessAddress)}</p>` : ""}
        ${vm.businessPhone ? `<p class="muted">${escapeHtml(vm.businessPhone)}</p>` : ""}
      </div>
      <div>
        <p class="doc-title">DELIVERY NOTE</p>
        <p class="doc-number">${escapeHtml(vm.deliveryNoteNumber)}</p>
        ${vm.isDelivered ? `<div style="text-align:right;"><span class="badge">Delivered</span></div>` : ""}
      </div>
    </div>

    <div class="body">
      <div class="recipient">
        <p class="label">Deliver To</p>
        <p class="recipient-name">${escapeHtml(vm.recipientName)}</p>
        <p class="address">${escapeHtml(vm.deliveryAddress)}</p>
        ${addressLine ? `<p class="address">${escapeHtml(addressLine)}</p>` : ""}
        ${vm.deliveryNotes ? `<p class="notes"><strong>Notes:</strong> ${escapeHtml(vm.deliveryNotes)}</p>` : ""}
      </div>
      <div class="rider">
        <p class="label">Rider</p>
        <p class="rider-name">${escapeHtml(vm.riderName ?? "Not assigned")}</p>
        ${vm.riderPhone ? `<p class="rider-field">${escapeHtml(vm.riderPhone)}</p>` : ""}
        ${vm.riderCompany ? `<p class="rider-field">${escapeHtml(vm.riderCompany)}</p>` : ""}
        ${vm.riderVehicleDescription ? `<p class="rider-field">${escapeHtml(vm.riderVehicleDescription)}</p>` : ""}
      </div>
    </div>

    <div class="footer">
      <span>${escapeHtml(vm.sourceDocumentLabel)}: ${escapeHtml(vm.sourceDocumentNumber ?? "-")}</span>
      <span>${escapeHtml(vm.dateLabel)}</span>
    </div>
  </div>
</body>
</html>`;
}

/** Opens the native print dialog for the delivery note — landscape, large font, meant to be printed
 * and stuck onto a package. Uses the same HTML->native-print pipeline as invoices/quotations, not the
 * ESC/POS thermal receipt path (which has no orientation concept at all). */
export async function printDeliveryNote(deliveryNoteId: string): Promise<PrinterActionResult> {
  requirePermission("sales", "view");
  const { vm, locationId } = loadDeliveryNoteData(deliveryNoteId);
  const tenantRow = tenantRepository.findTenantRow();
  const logo = tenantRow ? await resolveDocumentLogo(locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
  const html = buildDeliveryNoteHtml(vm, logo);
  const win = new BrowserWindow({ show: false });

  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString("base64")}`);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true, landscape: true }, (success, errorType) => {
        if (success) resolve();
        else reject(new Error(errorType || "Print was cancelled"));
      });
    });
    return { success: true, message: "Print dialog opened" };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print delivery note" };
  } finally {
    win.destroy();
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
  const buffer = await renderHtmlToPdfBuffer(html, { landscape: true });

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

/** Mirrors shareSalaryPayslip — the one working "share" implementation in the app: render to a temp
 * PDF, then reveal it in the file explorer so the user can manually attach it to WhatsApp, email, etc. */
export async function shareDeliveryNote(deliveryNoteId: string): Promise<PrinterActionResult> {
  try {
    const { vm, locationId } = loadDeliveryNoteData(deliveryNoteId);
    const tenantRow = tenantRepository.findTenantRow();
    const logo = tenantRow ? await resolveDocumentLogo(locationId, tenantRow) : { logoDataUrl: null, logoRatio: null };
    const html = buildDeliveryNoteHtml(vm, logo);
    const buffer = await renderHtmlToPdfBuffer(html, { landscape: true });

    const shareDir = join(app.getPath("temp"), "BlueLedger", "delivery-notes");
    mkdirSync(shareDir, { recursive: true });
    const filePath = join(shareDir, `${vm.deliveryNoteNumber}.pdf`);
    await writeFile(filePath, buffer);

    shell.showItemInFolder(filePath);
    return { success: true, message: "Delivery note ready — attach it from the file that just opened." };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to prepare delivery note for sharing"
    };
  }
}

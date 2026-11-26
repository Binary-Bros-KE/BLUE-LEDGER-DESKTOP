import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import { getPrinters as getSystemPrinters, print as printPdfToPrinter } from "pdf-to-printer";
import * as productRepository from "@main/database/repositories/product-repository";
import * as tenantRepository from "@main/database/repositories/tenant-repository";
import { requirePermission } from "@main/services/auth-service";
import { loadHtmlIntoWindow } from "@main/services/html-window-loader";
import { loadPrinterSettings, resolveThermalPageWidthIn } from "@main/services/printer-service";
import { buildPriceTagsHtml, priceTagFor, priceTagLayout, type PriceTag, type PriceTagLayout } from "@shared/lib/price-tags";
import { priceTagPrintSchema } from "@shared/schemas/price-tags";
import type { PriceTagPrinters } from "@shared/types/price-tags";
import type { PrinterActionResult } from "@shared/types/printer";

const { app, BrowserWindow } = electron;

/** Installed Windows printers, so a label printer can be picked separately from the receipt printer. */
export async function listPriceTagPrinters(): Promise<PriceTagPrinters> {
  requirePermission("products", "view");
  const printers = await getSystemPrinters().catch(() => []);
  return {
    printers: printers.map((printer) => printer.name),
    receiptPrinter: receiptPrinterName(),
    rollWidthMm: rollWidthMm()
  };
}

function rollWidthMm(): number {
  return Math.round(resolveThermalPageWidthIn(loadPrinterSettings().paperWidth) * 25.4 * 10) / 10;
}

/** Stickers: one PDF page per tag, exactly the sticker's size, so each lands on its own label. Roll: one
 * page as long as the tags themselves. Every tag has a fixed height, so the length is known without
 * measuring (a measured scrollHeight never drops below the hidden window's height, which would feed
 * inches of blank roll after a couple of tags). */
async function renderPriceTagsPdf(html: string, layout: PriceTagLayout, tagCount: number): Promise<Buffer> {
  const win = new BrowserWindow({ show: false });
  try {
    await loadHtmlIntoWindow(win, html);
    return await win.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: { width: layout.widthMm / 25.4, height: (layout.roll ? layout.heightMm * tagCount + 5 : layout.heightMm) / 25.4 },
      margins: { marginType: "none" },
      preferCSSPageSize: !layout.roll
    });
  } finally {
    win.destroy();
  }
}

export async function printPriceTags(input: unknown): Promise<PrinterActionResult> {
  requirePermission("products", "view");
  const request = priceTagPrintSchema.parse(input);
  const currency = tenantRepository.findTenantRow()?.currency ?? "";

  const tags: PriceTag[] = [];
  for (const item of request.items) {
    const row = productRepository.findProductRowById(item.productId);
    if (!row) continue;
    const tag = priceTagFor(productRepository.mapProductRow(row), currency);
    for (let copy = 0; copy < item.copies; copy++) tags.push(tag);
  }
  if (tags.length === 0) return { success: false, message: "None of the selected products were found." };

  const layout = priceTagLayout(request.size, rollWidthMm());
  const html = buildPriceTagsHtml(tags, layout);
  const buffer = await renderPriceTagsPdf(html, layout, tags.length);

  // Same pipeline as receipts (see printReceiptToSystemPrinter): noscale keeps each tag at its true
  // size instead of SumatraPDF stretching it to the driver's paper.
  const printer = request.printerName || receiptPrinterName();
  const tempPath = join(app.getPath("temp"), `blue-ledger-price-tags-${randomUUID()}.pdf`);
  await writeFile(tempPath, buffer);
  try {
    await printPdfToPrinter(tempPath, { silent: true, scale: "noscale", ...(printer ? { printer } : {}) });
    return { success: true, message: `Sent ${tags.length} price tag${tags.length === 1 ? "" : "s"} to the printer` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to print price tags" };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

/** The receipt printer, when it is a Windows printer; tags go there unless another one is picked. */
function receiptPrinterName(): string | null {
  const settings = loadPrinterSettings();
  return settings.connectionType === "usb" && settings.address ? settings.address : null;
}

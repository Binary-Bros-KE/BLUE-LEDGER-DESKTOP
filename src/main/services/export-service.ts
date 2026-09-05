import { writeFile } from "node:fs/promises";
import electron from "electron";
import ExcelJS from "exceljs";
import { requirePermission } from "@main/services/auth-service";
import {
  BRAND_BORDER,
  BRAND_GOLD,
  BRAND_NAVY,
  BRAND_SOFT,
  escapeHtml,
  generatedAtLabel,
  INK,
  timestampedFileName
} from "@main/services/export-shared";
import { loadHtmlIntoWindow } from "@main/services/html-window-loader";
import { openPdfPreviewWindow } from "@main/services/printer-service";
import type { ExportListRequest } from "@shared/types/export";

const { BrowserWindow, dialog } = electron;

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Renders the export to PDF and opens it in the in-app preview window — same "view, print, or
 * download" pattern as every document preview (see printer-service.ts's preview*Pdf functions), so a
 * client clicking "Export as PDF" from any list sees it immediately instead of a save dialog. */
export async function exportListToPdf(request: ExportListRequest): Promise<void> {
  requirePermission(request.module, "export");

  const html = buildExportHtml(request);
  const win = new BrowserWindow({ show: false });
  let buffer: Buffer;
  try {
    // See loadHtmlIntoWindow's own doc comment — a data:base64 URL here hit the same
    // ERR_INVALID_URL ceiling on a large export, not just the invoice/quotation case it was first
    // found on.
    await loadHtmlIntoWindow(win, html);
    buffer = await win.webContents.printToPDF({ printBackground: true, landscape: true });
  } finally {
    win.destroy();
  }

  await openPdfPreviewWindow(buffer, timestampedFileName(request.fileBaseName, "pdf"), request.title);
}

/** Writes the export to a CSV file and prompts the user for a save location. Returns the saved path, or null if cancelled. */
export async function exportListToCsv(request: ExportListRequest): Promise<string | null> {
  requirePermission(request.module, "export");

  const headerLine = request.columns.map((column) => escapeCsvCell(column.header)).join(",");
  const dataLines = request.rows.map((row) =>
    request.columns.map((column) => escapeCsvCell(row[column.key] ?? "")).join(",")
  );
  const csv = [headerLine, ...dataLines].join("\r\n");

  const result = await dialog.showSaveDialog({
    title: "Export as CSV",
    defaultPath: timestampedFileName(request.fileBaseName, "csv"),
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, csv, "utf-8");
  return result.filePath;
}

/** Writes the export to an Excel workbook and prompts the user for a save location. Returns the saved path, or null if cancelled. */
export async function exportListToExcel(request: ExportListRequest): Promise<string | null> {
  requirePermission(request.module, "export");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Blue Ledger";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(request.title.slice(0, 31) || "Export");

  let rowCursor = 1;
  const titleRow = sheet.getRow(rowCursor++);
  titleRow.getCell(1).value = request.title;
  titleRow.getCell(1).font = { bold: true, size: 14 };
  if (request.subtitle) {
    const subtitleRow = sheet.getRow(rowCursor++);
    subtitleRow.getCell(1).value = request.subtitle;
    subtitleRow.getCell(1).font = { italic: true, color: { argb: "FF83795F" } };
  }
  const generatedRow = sheet.getRow(rowCursor++);
  generatedRow.getCell(1).value = `Generated ${generatedAtLabel()}`;
  generatedRow.getCell(1).font = { size: 9, color: { argb: "FF83795F" } };
  rowCursor++;

  if (request.stats && request.stats.length > 0) {
    const statsHeaderRow = sheet.getRow(rowCursor++);
    statsHeaderRow.getCell(1).value = "Summary";
    statsHeaderRow.getCell(1).font = { bold: true, size: 11 };
    for (const stat of request.stats) {
      const row = sheet.getRow(rowCursor++);
      row.getCell(1).value = stat.label;
      row.getCell(1).font = { bold: true };
      row.getCell(2).value = stat.value;
    }
    rowCursor++;
  }

  const headerRow = sheet.getRow(rowCursor++);
  request.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF061E64" } };
    cell.alignment = { horizontal: column.align ?? "left" };
  });

  for (const dataRow of request.rows) {
    const row = sheet.getRow(rowCursor++);
    request.columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.value = dataRow[column.key] ?? "";
      cell.alignment = { horizontal: column.align ?? "left" };
    });
  }

  sheet.columns.forEach((column, index) => {
    const header = request.columns[index]?.header ?? "";
    const longestRow = request.rows.reduce((max, row) => {
      const value = row[request.columns[index]?.key ?? ""] ?? "";
      return Math.max(max, value.length);
    }, header.length);
    column.width = Math.min(Math.max(longestRow + 2, 10), 40);
  });

  const result = await dialog.showSaveDialog({
    title: "Export as Excel",
    defaultPath: timestampedFileName(request.fileBaseName, "xlsx"),
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }]
  });
  if (result.canceled || !result.filePath) return null;
  await workbook.xlsx.writeFile(result.filePath);
  return result.filePath;
}

function buildExportHtml(request: ExportListRequest): string {
  const statCards =
    request.stats && request.stats.length > 0
      ? `<div class="stats">${request.stats
          .map(
            (stat) => `
        <div class="stat">
          <p class="stat-label">${escapeHtml(stat.label)}</p>
          <p class="stat-value">${escapeHtml(stat.value)}</p>
        </div>`
          )
          .join("")}</div>`
      : "";

  const headerCells = request.columns
    .map((column) => `<th class="${column.align ?? "left"}">${escapeHtml(column.header)}</th>`)
    .join("");

  const bodyRows = request.rows
    .map(
      (row) => `
      <tr>
        ${request.columns
          .map((column) => `<td class="${column.align ?? "left"}">${escapeHtml(row[column.key] ?? "")}</td>`)
          .join("")}
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: ${INK}; margin: 0; padding: 24px; font-size: 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid ${BRAND_NAVY}; padding-bottom: 12px; }
  .title { font-size: 22px; font-weight: bold; color: ${BRAND_NAVY}; margin: 0; }
  .subtitle { font-size: 12px; color: ${BRAND_GOLD}; margin: 4px 0 0; }
  .generated { font-size: 10px; color: ${BRAND_GOLD}; text-align: right; margin: 0; }
  .stats { display: flex; gap: 12px; margin-top: 16px; }
  .stat { flex: 1; background: ${BRAND_SOFT}; border-radius: 8px; padding: 10px 14px; }
  .stat-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: ${BRAND_GOLD}; font-weight: bold; margin: 0; }
  .stat-value { font-size: 15px; font-weight: bold; color: ${INK}; margin: 4px 0 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; color: ${BRAND_GOLD}; border-bottom: 2px solid ${BRAND_BORDER}; padding: 6px 8px; }
  td { padding: 7px 8px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) td { background: #fafaf8; }
  .left { text-align: left; }
  .right { text-align: right; white-space: nowrap; }
  .center { text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <p class="title">${escapeHtml(request.title)}</p>
      ${request.subtitle ? `<p class="subtitle">${escapeHtml(request.subtitle)}</p>` : ""}
    </div>
    <p class="generated">Generated ${generatedAtLabel()}</p>
  </div>
  ${statCards}
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
}

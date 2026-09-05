import { writeFile } from "node:fs/promises";
import electron from "electron";
import ExcelJS from "exceljs";
import { requirePermission } from "@main/services/auth-service";
import {
  BRAND_BORDER,
  BRAND_DANGER,
  BRAND_GOLD,
  BRAND_NAVY,
  BRAND_SOFT,
  BRAND_SUCCESS,
  BRAND_TEAL,
  BRAND_WARNING,
  escapeHtml,
  generatedAtLabel,
  INK,
  timestampedFileName
} from "@main/services/export-shared";
import { loadHtmlIntoWindow } from "@main/services/html-window-loader";
import { openPdfPreviewWindow } from "@main/services/printer-service";
import type {
  ReportCardTone,
  ReportExportRequest,
  ReportExportSection,
  ReportExportTableRow
} from "@shared/types/report-export";

const { BrowserWindow, dialog } = electron;

const SEQUENTIAL_BAR_HUE = "#2b5fd9"; // matches renderer's CHART_SEQUENTIAL_HUE / --color-accent

const TONE_HEX: Record<ReportCardTone, string> = {
  primary: BRAND_NAVY,
  teal: BRAND_TEAL,
  danger: BRAND_DANGER,
  success: BRAND_SUCCESS,
  warning: BRAND_WARNING
};

/** Renders a full multi-section report to PDF, visually mirroring the on-screen report — colorful
 * stat cards, real progress bars, and styled tables — rather than flattening it into one list. Opens
 * in the in-app preview window (see printer-service.ts's preview*Pdf functions) instead of a save
 * dialog, same as every document preview and exportListToPdf. */
export async function exportReportToPdf(request: ReportExportRequest): Promise<void> {
  requirePermission(request.module, "export");

  const html = buildReportHtml(request);
  const win = new BrowserWindow({ show: false });
  let buffer: Buffer;
  try {
    // See loadHtmlIntoWindow's own doc comment — a data:base64 URL here hit the same
    // ERR_INVALID_URL ceiling on a large report, not just the invoice/quotation case it was first
    // found on.
    await loadHtmlIntoWindow(win, html);
    buffer = await win.webContents.printToPDF({ printBackground: true, landscape: true });
  } finally {
    win.destroy();
  }

  await openPdfPreviewWindow(buffer, timestampedFileName(request.fileBaseName, "pdf"), request.title);
}

/** Re-presents the same insight as clean tabular sheets — a Summary sheet for every card/tile
 * figure, then one sheet per bar/table section — rather than trying to replicate cards/bars
 * visually, which a spreadsheet isn't the right tool for. */
export async function exportReportToExcel(request: ReportExportRequest): Promise<string | null> {
  requirePermission(request.module, "export");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Blue Ledger";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Summary");
  let row = 1;
  const titleRow = summarySheet.getRow(row++);
  titleRow.getCell(1).value = request.title;
  titleRow.getCell(1).font = { bold: true, size: 14 };
  if (request.subtitle) {
    const subtitleRow = summarySheet.getRow(row++);
    subtitleRow.getCell(1).value = request.subtitle;
    subtitleRow.getCell(1).font = { italic: true, color: { argb: "FF83795F" } };
  }
  const generatedRow = summarySheet.getRow(row++);
  generatedRow.getCell(1).value = `Generated ${generatedAtLabel()}`;
  generatedRow.getCell(1).font = { size: 9, color: { argb: "FF83795F" } };
  row++;

  const usedSheetNames = new Set<string>(["Summary"]);

  for (const section of request.sections) {
    if (section.type === "cards" || section.type === "tiles") {
      if (section.title) {
        const headerRow = summarySheet.getRow(row++);
        headerRow.getCell(1).value = section.title;
        headerRow.getCell(1).font = { bold: true, size: 11 };
      }
      const items: Array<{ label: string; value: string; caption?: string }> =
        section.type === "cards"
          ? section.cards.map((card) => ({ label: card.label, value: card.value, caption: card.caption }))
          : section.tiles.map((tile) => ({ label: tile.label, value: tile.value }));
      for (const item of items) {
        const itemRow = summarySheet.getRow(row++);
        itemRow.getCell(1).value = item.label;
        itemRow.getCell(1).font = { bold: true };
        itemRow.getCell(2).value = item.value;
        if (item.caption) {
          itemRow.getCell(3).value = item.caption;
          itemRow.getCell(3).font = { italic: true, size: 9, color: { argb: "FF83795F" } };
        }
      }
      row++;
    } else {
      const sheetName = uniqueSheetName(section.title, usedSheetNames);
      const sheet = workbook.addWorksheet(sheetName);
      writeSectionSheet(sheet, section);
    }
  }

  summarySheet.columns.forEach((column) => {
    column.width = 34;
  });

  const result = await dialog.showSaveDialog({
    title: "Export Report as Excel",
    defaultPath: timestampedFileName(request.fileBaseName, "xlsx"),
    filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }]
  });
  if (result.canceled || !result.filePath) return null;
  await workbook.xlsx.writeFile(result.filePath);
  return result.filePath;
}

function uniqueSheetName(title: string, used: Set<string>): string {
  const sanitized = title.replace(/[*?:/\\[\]]/g, "").slice(0, 31) || "Sheet";
  let candidate = sanitized;
  let suffix = 2;
  while (used.has(candidate)) {
    const base = sanitized.slice(0, 31 - String(suffix).length - 1);
    candidate = `${base} ${suffix}`;
    suffix++;
  }
  used.add(candidate);
  return candidate;
}

function writeSectionSheet(sheet: ExcelJS.Worksheet, section: Extract<ReportExportSection, { type: "bars" | "table" }>): void {
  let row = 1;
  const titleRow = sheet.getRow(row++);
  titleRow.getCell(1).value = section.title;
  titleRow.getCell(1).font = { bold: true, size: 13 };
  if (section.description) {
    const descRow = sheet.getRow(row++);
    descRow.getCell(1).value = section.description;
    descRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF83795F" } };
  }
  row++;

  const columns =
    section.type === "bars"
      ? [
          { key: "label", header: "Name" },
          { key: "value", header: "Value", align: "right" as const },
          { key: "share", header: "Share", align: "right" as const }
        ]
      : section.columns;

  const headerRow = sheet.getRow(row++);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF061E64" } };
    cell.alignment = { horizontal: column.align ?? "left" };
  });

  const dataRows: ReportExportTableRow[] =
    section.type === "bars"
      ? section.items.map((item) => ({
          label: item.label,
          value: item.value,
          share: `${item.percent.toFixed(1)}%`
        }))
      : section.rows;

  for (const dataRow of dataRows) {
    const excelRow = sheet.getRow(row++);
    columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      cell.value = dataRow[column.key] ?? "";
      cell.alignment = { horizontal: column.align ?? "left" };
      if (dataRow._tone) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: dataRow._tone === "danger" ? "FFFBE9E7" : "FFFDF3E3" }
        };
      }
    });
  }

  sheet.columns.forEach((column, index) => {
    const header = columns[index]?.header ?? "";
    const longest = dataRows.reduce((max, dataRow) => {
      const value = dataRow[columns[index]?.key ?? ""] ?? "";
      return Math.max(max, value.length);
    }, header.length);
    column.width = Math.min(Math.max(longest + 2, 12), 42);
  });
}

function buildReportHtml(request: ReportExportRequest): string {
  const body = request.sections.map((section) => renderSectionHtml(section)).join("");

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
  .section { margin-top: 22px; break-inside: avoid; }
  .section-title { font-size: 15px; font-weight: bold; color: ${INK}; margin: 0 0 2px; }
  .section-desc { font-size: 10.5px; color: ${BRAND_GOLD}; margin: 0 0 10px; }
  .cards { display: flex; gap: 10px; flex-wrap: wrap; }
  .card { flex: 1 1 200px; border-radius: 10px; padding: 14px; color: #fff; }
  .card-label { font-size: 9.5px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.8; margin: 0; }
  .card-value { font-size: 20px; font-weight: bold; margin: 6px 0 0; }
  .card-caption { font-size: 10px; opacity: 0.75; margin: 6px 0 0; }
  .tiles { display: flex; gap: 10px; flex-wrap: wrap; }
  .tile { flex: 1 1 180px; border: 1px solid ${BRAND_BORDER}; border-radius: 10px; padding: 12px 14px; background: #fff; }
  .tile-label { font-size: 9.5px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; color: ${BRAND_GOLD}; margin: 0; }
  .tile-value { font-size: 18px; font-weight: bold; color: ${INK}; margin: 5px 0 0; }
  .bars { display: flex; flex-direction: column; gap: 7px; }
  .bar-row { display: flex; align-items: center; gap: 10px; }
  .bar-label { flex: 0 0 170px; font-size: 11px; font-weight: bold; color: ${INK}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-sublabel { font-weight: 600; color: ${BRAND_GOLD}; }
  .bar-track { flex: 1; height: 16px; background: ${BRAND_SOFT}; border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; }
  .bar-value { flex: 0 0 90px; text-align: right; font-size: 11px; font-weight: bold; color: ${INK}; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 9.5px; text-transform: uppercase; color: ${BRAND_GOLD}; border-bottom: 2px solid ${BRAND_BORDER}; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
  tr:nth-child(even) td { background: #fafaf8; }
  tr.tone-danger td { background: #fbe9e7 !important; }
  tr.tone-warning td { background: #fdf3e3 !important; }
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
  ${body}
</body>
</html>`;
}

function renderSectionHtml(section: ReportExportSection): string {
  const heading =
    "title" in section && section.title
      ? `<p class="section-title">${escapeHtml(section.title)}</p>${
          "description" in section && section.description
            ? `<p class="section-desc">${escapeHtml(section.description)}</p>`
            : ""
        }`
      : "";

  if (section.type === "cards") {
    const cards = section.cards
      .map(
        (card) => `
      <div class="card" style="background:${TONE_HEX[card.tone]};">
        <p class="card-label">${escapeHtml(card.label)}</p>
        <p class="card-value">${escapeHtml(card.value)}</p>
        ${card.caption ? `<p class="card-caption">${escapeHtml(card.caption)}</p>` : ""}
      </div>`
      )
      .join("");
    return `<div class="section">${heading}<div class="cards">${cards}</div></div>`;
  }

  if (section.type === "tiles") {
    const tiles = section.tiles
      .map(
        (tile) => `
      <div class="tile">
        <p class="tile-label">${escapeHtml(tile.label)}</p>
        <p class="tile-value">${escapeHtml(tile.value)}</p>
      </div>`
      )
      .join("");
    return `<div class="section">${heading}<div class="tiles">${tiles}</div></div>`;
  }

  if (section.type === "bars") {
    if (section.items.length === 0) {
      return `<div class="section">${heading}<p class="section-desc">No data for this period.</p></div>`;
    }
    const bars = section.items
      .map(
        (item) => `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(item.label)}${item.sublabel ? ` <span class="bar-sublabel">${escapeHtml(item.sublabel)}</span>` : ""}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, item.percent)}%;background:${item.color ?? SEQUENTIAL_BAR_HUE};"></div></div>
        <div class="bar-value">${escapeHtml(item.value)}</div>
      </div>`
      )
      .join("");
    return `<div class="section">${heading}<div class="bars">${bars}</div></div>`;
  }

  // table
  if (section.rows.length === 0) {
    return `<div class="section">${heading}<p class="section-desc">No data for this period.</p></div>`;
  }
  const headerCells = section.columns
    .map((column) => `<th class="${column.align ?? "left"}">${escapeHtml(column.header)}</th>`)
    .join("");
  const bodyRows = section.rows
    .map(
      (dataRow) => `
      <tr${dataRow._tone ? ` class="tone-${dataRow._tone}"` : ""}>
        ${section.columns
          .map((column) => `<td class="${column.align ?? "left"}">${escapeHtml(dataRow[column.key] ?? "")}</td>`)
          .join("")}
      </tr>`
    )
    .join("");
  return `<div class="section">${heading}<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
}

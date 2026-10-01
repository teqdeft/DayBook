// Builds .xlsx downloads with exceljs. Every Daybook export (hours, My log, Attendance, Screen time,
// Project report) goes through xlsxResponse.
import ExcelJS from 'exceljs';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * @typedef {{ header: string, key: string, width?: number, numFmt?: string }} ExcelColumn
 * @typedef {{ name: string, columns: ExcelColumn[], rows: Record<string, unknown>[] }} ExcelSheet
 */

/**
 * Text a person typed can start with = + - @ (or a tab/CR); spreadsheet apps may run such a cell
 * as a formula after a CSV re-save. A leading apostrophe keeps it plain text.
 * @param {unknown} value
 */
export function safeText(value) {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function safeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'string' ? safeText(value) : value;
  }
  return out;
}

/**
 * Returns a download Response for a workbook.
 * @param {{ filename: string, sheets: ExcelSheet[] }} workbookSpec
 * @returns {Promise<Response>}
 */
export async function xlsxResponse({ filename, sheets }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Daybook';
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
    worksheet.columns = sheet.columns.map((column) => ({
      header: column.header,
      key: column.key,
      width: column.width ?? 16,
      style: column.numFmt ? { numFmt: column.numFmt } : undefined,
    }));
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of sheet.rows) worksheet.addRow(safeRow(row));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const safeName = filename.replace(/[^\w.-]+/g, '-');
  return new Response(buffer, {
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'no-store',
    },
  });
}

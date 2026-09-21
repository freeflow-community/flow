import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { columnLabel, isSpreadsheetFile, parseWorkbook, truncationNote, workbookSummary } from './spreadsheet';

function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

describe('isSpreadsheetFile', () => {
  it('keys off mime first, extension second, and leaves other text alone', () => {
    expect(isSpreadsheetFile({ name: 'costs.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe(true);
    expect(isSpreadsheetFile({ name: 'costs (1).xlsx', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isSpreadsheetFile({ name: 'export', mimeType: 'text/csv; charset=utf-8' })).toBe(true);
    expect(isSpreadsheetFile({ name: 'data.tsv', mimeType: 'text/plain' })).toBe(true);
    expect(isSpreadsheetFile({ name: 'notes.txt', mimeType: 'text/plain' })).toBe(false);
    expect(isSpreadsheetFile({ name: 'report.pdf', mimeType: 'application/pdf' })).toBe(false);
  });
});

describe('parseWorkbook', () => {
  it('reads every sheet as formatted text with the true extent', async () => {
    const bytes = workbook({
      Costs: [['City', 'Rent', 'Share'], ['Boston', 2400, 0.5], ['Lisbon', 1100, 0.25]],
      Notes: [['Source', 'numbeo']],
    });
    const wb = await parseWorkbook(bytes);
    expect(wb.sheets.map((s) => s.name)).toEqual(['Costs', 'Notes']);
    const costs = wb.sheets[0]!;
    expect(costs.rows[0]).toEqual(['City', 'Rent', 'Share']);
    expect(costs.rows[1]).toEqual(['Boston', '2400', '0.5']);
    expect(costs.rowCount).toBe(3);
    expect(costs.colCount).toBe(3);
    expect(workbookSummary(wb, 0)).toBe('2 sheets · 3 rows × 3 columns');
    expect(truncationNote(costs, { rows: 500, cols: 50 })).toBeNull();
  });

  it('caps rows and columns but still reports how big the sheet really is', async () => {
    const rows = Array.from({ length: 40 }, (_, r) => Array.from({ length: 8 }, (_, c) => `r${r}c${c}`));
    const wb = await parseWorkbook(workbook({ Big: rows }), { rows: 10, cols: 3 });
    const big = wb.sheets[0]!;
    expect(big.rows).toHaveLength(10);
    expect(big.rows[0]).toEqual(['r0c0', 'r0c1', 'r0c2']);
    expect(big.rowCount).toBe(40);
    expect(big.colCount).toBe(8);
    expect(truncationNote(big, { rows: 10, cols: 3 })).toBe('Showing the first 10 of 40 rows and the first 3 of 8 columns — download for the full sheet.');
  });

  it('parses CSV text the same way', async () => {
    const csv = new TextEncoder().encode('name,qty\nwidget,3\ngadget,"1,000"\n');
    const wb = await parseWorkbook(csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength) as ArrayBuffer);
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0]!.rows).toEqual([['name', 'qty'], ['widget', '3'], ['gadget', '1,000']]);
  });

  it('gives an empty sheet no rows rather than blank lines', async () => {
    const wb = await parseWorkbook(workbook({ Empty: [[]] }));
    expect(wb.sheets[0]!.rows).toEqual([]);
    expect(workbookSummary(wb, 0)).toBe('0 rows × 0 columns');
    expect(workbookSummary(await parseWorkbook(workbook({ One: [['x']] })), 0)).toBe('1 row × 1 column');
  });
});

describe('columnLabel', () => {
  it('counts like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});

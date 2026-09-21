// Spreadsheet previews (xlsx, xls, ods, csv, tsv) for chat attachments and
// the channel Files panel. Parsing happens in the browser with SheetJS CE,
// loaded on first use so the main bundle does not carry it. Cells are read
// as their *formatted* text — what the sheet shows, not raw numbers — and
// every sheet is capped so a large workbook renders a bounded table rather
// than freezing the tab; the footer says what was left out.
//
// SheetJS comes from its own CDN tarball (see package.json) rather than the
// npm registry: the registry's last release (0.18.5) predates two fixes that
// matter when parsing files other people uploaded — prototype pollution in
// workbook metadata and a ReDoS in the format parser.
import type { FileKindInput } from './fileKind';

export const SPREADSHEET_EXTS = new Set(['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv']);
export const SPREADSHEET_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'text/tab-separated-values',
]);

/** Files bigger than this get the plain chip: parsing is synchronous on the
 * main thread and the preview is meant for a glance, not an audit. */
export const SPREADSHEET_MAX_BYTES = 10_000_000;

function ext(file: FileKindInput): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

export function isSpreadsheetFile(file: FileKindInput): boolean {
  const mime = file.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (SPREADSHEET_MIMES.has(mime)) return true;
  return SPREADSHEET_EXTS.has(ext(file));
}

export interface ParsedSheet {
  name: string;
  /** Formatted cell text, row-major, trailing empty columns trimmed. */
  rows: string[][];
  /** The sheet's true extent, which may exceed what `rows` holds. */
  rowCount: number;
  colCount: number;
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
}

export interface ParseLimits {
  rows: number;
  cols: number;
}

/** What the full reader shows per sheet. */
export const READER_LIMITS: ParseLimits = { rows: 500, cols: 50 };

/** Excel-style column label: 0 → A, 25 → Z, 26 → AA. */
export function columnLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

type SheetJs = typeof import('xlsx');
let lib: Promise<SheetJs> | null = null;
function sheetJs(): Promise<SheetJs> {
  lib ??= import('xlsx');
  lib.catch(() => { lib = null; });
  return lib;
}

/** Parse a workbook's bytes into bounded text grids. Sheets beyond the row
 * cap are read up to the cap only (`sheetRows`), which is what keeps a
 * 200,000-row export cheap; the true size still comes back in `rowCount`. */
export async function parseWorkbook(bytes: ArrayBuffer, limits: ParseLimits = READER_LIMITS): Promise<ParsedWorkbook> {
  const XLSX = await sheetJs();
  const wb = XLSX.read(bytes, { type: 'array', sheetRows: limits.rows, cellHTML: false, cellFormula: false });
  const sheets: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    // `!fullref` is the untruncated range when `sheetRows` cut the read short.
    const ref = (ws['!fullref'] as string | undefined) ?? ws['!ref'];
    const range = ref ? XLSX.utils.decode_range(ref) : null;
    const rowCount = range ? range.e.r - range.s.r + 1 : 0;
    const colCount = range ? range.e.c - range.s.c + 1 : 0;
    const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: true }) as unknown[][];
    const rows = grid.slice(0, limits.rows).map((row) =>
      row.slice(0, limits.cols).map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
    );
    // Trim trailing empty rows so an empty sheet is empty, not 500 blank lines.
    while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
    sheets.push({ name, rows, rowCount, colCount });
  }
  return { sheets };
}

/** Human summary for a card footer: "3 sheets · 1,204 rows × 12 columns". */
export function workbookSummary(wb: ParsedWorkbook, active: number): string {
  const sheet = wb.sheets[active];
  if (!sheet) return 'Empty workbook';
  const n = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
  const dims = `${n(sheet.rowCount, 'row')} × ${n(sheet.colCount, 'column')}`;
  return wb.sheets.length > 1 ? `${wb.sheets.length} sheets · ${dims}` : dims;
}

/** What a capped view left out, or null when it shows everything. */
export function truncationNote(sheet: ParsedSheet, limits: ParseLimits): string | null {
  const rowsCut = sheet.rowCount > limits.rows;
  const colsCut = sheet.colCount > limits.cols;
  if (!rowsCut && !colsCut) return null;
  const parts: string[] = [];
  if (rowsCut) parts.push(`the first ${limits.rows.toLocaleString()} of ${sheet.rowCount.toLocaleString()} rows`);
  if (colsCut) parts.push(`the first ${limits.cols} of ${sheet.colCount} columns`);
  return `Showing ${parts.join(' and ')} — download for the full sheet.`;
}

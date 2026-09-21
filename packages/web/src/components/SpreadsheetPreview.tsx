// Spreadsheet rendering shared by the chat attachment (MessageList) and the
// channel Files panel: a bounded grid with column letters and row numbers,
// sheet tabs when the workbook has several, and a note about anything the
// caps left out. Parsing is in lib/spreadsheet.ts.
import { useEffect, useState } from 'react';
import { useBoundApi } from '../lib/useBoundApi';
import {
  columnLabel,
  parseWorkbook,
  READER_LIMITS,
  truncationNote,
  workbookSummary,
  type ParsedSheet,
  type ParsedWorkbook,
  type ParseLimits,
} from '../lib/spreadsheet';

/** What the in-chat card shows before the reader is opened. */
export const CARD_LIMITS: ParseLimits = { rows: 8, cols: 6 };

export type WorkbookState =
  | { status: 'loading'; workbook: null }
  | { status: 'ready'; workbook: ParsedWorkbook }
  | { status: 'failed'; workbook: null };

/** Fetch and parse a file's workbook once per file id. */
export function useWorkbook(fileId: string, enabled = true): WorkbookState {
  const { blobUrl } = useBoundApi();
  const [state, setState] = useState<WorkbookState>({ status: 'loading', workbook: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState({ status: 'loading', workbook: null });
    void blobUrl(`/v1/files/${fileId}`)
      .then((url) => fetch(url))
      .then((res) => res.arrayBuffer())
      .then((bytes) => parseWorkbook(bytes))
      .then((workbook) => { if (alive) setState({ status: 'ready', workbook }); })
      .catch(() => { if (alive) setState({ status: 'failed', workbook: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, enabled]);
  return state;
}

/** The grid itself. `limits` bounds what is drawn; the sheet may hold more. */
export function SheetTable({ sheet, limits, compact = false, testId }: {
  sheet: ParsedSheet;
  limits: ParseLimits;
  compact?: boolean;
  testId?: string;
}) {
  const rows = sheet.rows.slice(0, limits.rows);
  const cols = Math.min(limits.cols, Math.max(1, ...rows.map((r) => r.length), Math.min(sheet.colCount, limits.cols)));
  const cell = compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs';
  const head = `${cell} bg-base font-semibold text-faint text-center select-none`;
  return (
    <table data-testid={testId} className="border-collapse text-ink">
      <thead>
        <tr>
          <th className={`${head} sticky left-0 z-10 w-8 border-r border-b border-hairline`} />
          {Array.from({ length: cols }, (_, c) => (
            <th key={c} className={`${head} border-r border-b border-hairline`}>{columnLabel(c)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={cols + 1} className={`${cell} text-faint`}>Empty sheet</td></tr>
        )}
        {rows.map((row, r) => (
          <tr key={r}>
            <th className={`${head} sticky left-0 z-10 border-r border-b border-hairline`}>{r + 1}</th>
            {Array.from({ length: cols }, (_, c) => (
              <td key={c} className={`${cell} max-w-[240px] truncate border-r border-b border-hairline whitespace-nowrap`} title={row[c] || undefined}>
                {row[c] ?? ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tabs + grid + footer, the same in the reader and the Files panel. */
export function SpreadsheetView({ workbook, limits = READER_LIMITS, testId = 'sheet-view' }: {
  workbook: ParsedWorkbook;
  limits?: ParseLimits;
  testId?: string;
}) {
  const [active, setActive] = useState(0);
  const sheet = workbook.sheets[active] ?? workbook.sheets[0];
  if (!sheet) return <p className="p-4 text-sm text-faint">This workbook has no sheets.</p>;
  const note = truncationNote(sheet, limits);
  return (
    <div data-testid={testId} className="flex h-full min-h-0 flex-col bg-white">
      {workbook.sheets.length > 1 && (
        <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b border-hairline px-2 pt-2">
          {workbook.sheets.map((s, i) => (
            <button
              key={s.name}
              role="tab"
              aria-selected={i === active}
              data-testid={`${testId}-tab-${i}`}
              className={`rounded-t px-3 py-1 text-xs font-semibold ${i === active ? 'bg-accent/10 text-accent' : 'text-muted hover:text-ink'}`}
              onClick={() => setActive(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="mc-scroll min-h-0 flex-1 overflow-auto">
        <SheetTable sheet={sheet} limits={limits} testId={`${testId}-table`} />
      </div>
      <div className="shrink-0 border-t border-hairline px-3 py-1.5 text-[11px] text-faint">
        {note ?? workbookSummary(workbook, active)}
      </div>
    </div>
  );
}

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ParsedWorkbook } from '../lib/spreadsheet';
import { CARD_LIMITS, SheetTable, SpreadsheetView } from './SpreadsheetPreview';

const workbook: ParsedWorkbook = {
  sheets: [
    { name: 'Costs', rows: [['City', 'Rent'], ['Boston', '2,400'], ['Lisbon', '1,100']], rowCount: 3, colCount: 2 },
    { name: 'Notes', rows: [['Source', 'numbeo']], rowCount: 1, colCount: 2 },
  ],
};

describe('SheetTable', () => {
  it('draws column letters, row numbers and the cells', () => {
    const html = renderToStaticMarkup(<SheetTable sheet={workbook.sheets[0]!} limits={CARD_LIMITS} compact testId="t" />);
    expect(html).toContain('>A<');
    expect(html).toContain('>B<');
    expect(html).toContain('>1<');
    expect(html).toContain('>3<');
    expect(html).toContain('>Boston<');
    expect(html).toContain('>2,400<');
    // Nothing beyond the sheet's own width is drawn.
    expect(html).not.toContain('>C<');
  });

  it('bounds what it draws to the limits and says so in the view footer', () => {
    const big = { name: 'Big', rows: Array.from({ length: 20 }, (_, r) => Array.from({ length: 10 }, (_, c) => `r${r}c${c}`)), rowCount: 20, colCount: 10 };
    const html = renderToStaticMarkup(<SpreadsheetView workbook={{ sheets: [big] }} limits={{ rows: 5, cols: 3 }} />);
    expect(html).toContain('>r4c2<');
    expect(html).not.toContain('r5c0');
    expect(html).not.toContain('r0c3');
    expect(html).toContain('Showing the first 5 of 20 rows and the first 3 of 10 columns');
  });

  it('shows an empty sheet as empty', () => {
    const html = renderToStaticMarkup(<SheetTable sheet={{ name: 'E', rows: [], rowCount: 0, colCount: 0 }} limits={CARD_LIMITS} />);
    expect(html).toContain('Empty sheet');
  });
});

describe('SpreadsheetView', () => {
  it('offers a tab per sheet only when there are several, and summarises the active one', () => {
    const multi = renderToStaticMarkup(<SpreadsheetView workbook={workbook} testId="v" />);
    expect(multi).toContain('role="tablist"');
    expect(multi).toContain('data-testid="v-tab-1"');
    expect(multi).toContain('2 sheets · 3 rows × 2 columns');
    const single = renderToStaticMarkup(<SpreadsheetView workbook={{ sheets: [workbook.sheets[1]!] }} />);
    expect(single).not.toContain('role="tablist"');
    expect(single).toContain('1 row × 2 columns');
  });
});

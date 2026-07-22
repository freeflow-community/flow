// Inline markdown rendering (agent replies): assertions on static HTML output.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderBlocks, renderBody } from './format';

const html = (body: string) => renderToStaticMarkup(<>{renderBlocks(body, {}, undefined)}</>);

describe('inline markdown', () => {
  it('renders bold, italic, strike, and inline code', () => {
    expect(html('**Projects / code**')).toBe('<strong>Projects / code</strong>');
    expect(html('a *b* c')).toBe('a <em>b</em> c');
    expect(html('a _b_ c')).toBe('a <em>b</em> c');
    expect(html('~~gone~~')).toBe('<s>gone</s>');
    const code = html('run `pnpm test` now');
    expect(code).toContain('<code');
    expect(code).toContain('pnpm test</code>');
  });

  it('nests emphasis but keeps code spans literal inside', () => {
    expect(html('**bold with *inner* text**')).toContain('<strong>bold with <em>inner</em> text</strong>');
    expect(html('`**not bold**`')).toContain('**not bold**</code>');
  });

  it('leaves ambiguous emphasis alone', () => {
    expect(html('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(html('snake_case_name and file_name')).toBe('snake_case_name and file_name');
  });

  it('renders markdown links and bare URLs', () => {
    expect(html('[docs](https://example.com/a)')).toContain('href="https://example.com/a"');
    expect(html('[docs](https://example.com/a)')).toContain('>docs</a>');
    expect(html('see https://example.com/path.')).toContain('href="https://example.com/path"');
  });

  it('never formats inside fenced code blocks', () => {
    const out = html('```\n**raw** `x`\n```');
    expect(out).toContain('**raw** `x`');
    expect(out).not.toContain('<strong>');
  });

  it('applies inline markdown inside quotes and around mention pills', () => {
    expect(html('> **quoted**')).toContain('<strong>quoted</strong>');
    const withPill = renderToStaticMarkup(
      <>{renderBody('**hi** <@01234567-89ab-cdef-0123-456789abcdef> `ok`', { '01234567-89ab-cdef-0123-456789abcdef': 'Ann' }, undefined)}</>,
    );
    expect(withPill).toContain('<strong>hi</strong>');
    expect(withPill).toContain('@Ann');
    expect(withPill).toContain('ok</code>');
  });
});

describe('block markdown', () => {
  it('renders ATX headings at the right level with inline content', () => {
    expect(html('# Big **title**')).toContain('<h1');
    expect(html('# Big **title**')).toContain('<strong>title</strong>');
    expect(html('### small')).toContain('<h3');
    expect(html('####### too many')).toBe('####### too many'); // 7 hashes is not a heading
  });

  it('renders unordered lists from -, *, and +', () => {
    const out = html('- one\n* two\n+ three');
    expect(out).toContain('<ul');
    expect(out.match(/<li>/g)?.length).toBe(3);
    expect(out).toContain('<li>one</li>');
  });

  it('renders ordered lists preserving the start index', () => {
    const out = html('3. third\n4. fourth');
    expect(out).toContain('<ol');
    expect(out).toContain('start="3"');
    expect(out).toContain('<li>third</li>');
  });

  it('renders a GFM pipe table with header, rows, and alignment', () => {
    const out = html('| Name | Score |\n|:-----|------:|\n| Ann | 10 |\n| Bo | 7 |');
    expect(out).toContain('<table');
    expect(out).toContain('<th');
    expect(out).toContain('Score');
    expect(out).toContain('text-right'); // second column right-aligned
    expect(out.match(/<tr>/g)?.length).toBe(3); // header + 2 body rows
    expect(out).toContain('<td');
  });

  it('normalizes ragged table rows to the header column count', () => {
    const out = html('| A | B |\n|---|---|\n| only-one |');
    // two <td> in the body row even though only one cell was given
    const bodyTds = out.split('<tbody>')[1] ?? '';
    expect(bodyTds.match(/<td/g)?.length).toBe(2);
  });

  it('renders horizontal rules but not tables from a plain line + dashes', () => {
    expect(html('---')).toContain('<hr');
    expect(html('***')).toContain('<hr');
    // "a | b" then "---" is NOT a table (separator lacks a pipe) — stays plain + rule
    const out = html('a | b\n---');
    expect(out).not.toContain('<table');
    expect(out).toContain('<hr');
  });

  it('keeps table/list/heading markup out of fenced code', () => {
    const out = html('```\n# not a heading\n- not a list\n| not | a table |\n```');
    expect(out).not.toContain('<h1');
    expect(out).not.toContain('<ul');
    expect(out).not.toContain('<table');
    expect(out).toContain('# not a heading');
  });
});

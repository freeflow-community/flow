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

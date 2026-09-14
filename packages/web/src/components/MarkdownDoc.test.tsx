import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownDocBody, MARKDOWN_MAX, truncateMarkdown } from './MarkdownDoc';

// #569: a .md file is a document, not a wall of monospace. These cover the two
// states of the viewer body — rendered and View source — and the cap that keeps
// a huge file from hanging the tab. The block grammar itself is `renderBlocks`,
// already covered by format.test.tsx; what matters here is that the document
// body actually goes through it.

const DOC = [
  '# Title',
  '',
  'Some **bold** prose.',
  '',
  '- one',
  '- two',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1;',
  '```',
].join('\n');

function markup(text: string, source: boolean, dense = false) {
  return renderToStaticMarkup(
    <MarkdownDocBody text={text} names={{}} currentUserId={undefined} source={source} dense={dense} testId="doc" />,
  );
}

describe('MarkdownDocBody — rendered', () => {
  const html = markup(DOC, false);

  it('renders headings, lists and tables rather than raw markdown', () => {
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('data-testid="ulist"');
    expect(html).toContain('data-testid="table"');
    // The source markers are gone — this is the whole point of the issue.
    expect(html).not.toContain('# Title');
    expect(html).not.toContain('| --- |');
  });

  it('renders inline markdown inside blocks', () => {
    expect(html).toContain('<strong>bold</strong>');
  });

  it('keeps fenced code as a code block', () => {
    expect(html).toContain('data-testid="code-block"');
    expect(html).toContain('const x = 1;');
  });

  it('carries the document testid so the surfaces can be asserted on', () => {
    expect(html).toContain('data-testid="doc"');
  });
});

describe('MarkdownDocBody — View source', () => {
  it('shows the raw markdown verbatim in a monospace block', () => {
    const html = markup(DOC, true);
    expect(html).toContain('data-testid="doc-source"');
    expect(html).toContain('font-mono');
    expect(html).toContain('# Title');
    expect(html).toContain('| --- |');
    // ...and nothing has been rendered.
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('data-testid="table"');
  });
});

describe('MarkdownDocBody — mermaid', () => {
  it('draws a ```mermaid fence as a diagram, not as code', () => {
    const html = markup('```mermaid\ngraph TD;\nA-->B;\n```', false);
    expect(html).not.toContain('data-testid="code-block"');
    expect(html).toContain('mermaid');
  });
});

describe('MarkdownDocBody — density', () => {
  it('uses tighter padding in a chat card than in the side panel', () => {
    expect(markup('hi', false, true)).toContain('px-3 py-2');
    expect(markup('hi', false, false)).toContain('px-[22px] py-4');
  });
});

describe('truncateMarkdown', () => {
  it('passes an ordinary document through untouched', () => {
    expect(truncateMarkdown(DOC)).toEqual({ shown: DOC, truncated: false });
  });

  it('caps an oversized document and says so', () => {
    const huge = 'x'.repeat(MARKDOWN_MAX + 10);
    const { shown, truncated } = truncateMarkdown(huge);
    expect(shown).toHaveLength(MARKDOWN_MAX);
    expect(truncated).toBe(true);
  });

  it('surfaces the cap to the reader rather than silently shortening', () => {
    const html = markup('x'.repeat(MARKDOWN_MAX + 10), false);
    expect(html).toContain('Showing the first 1 MB');
  });
});

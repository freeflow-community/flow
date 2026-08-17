import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderBlocks } from '../lib/format';
import { CodeBlock } from './CodeBlock';

// #260: every rendered code block carries a way to copy its contents. These
// tests pin the two things that make that true — the button is there, and the
// text it would copy is the block's raw body rather than the marked-up one.
// (There is no DOM in this suite, so the click itself and the checkmark flash
// are verified in the running app, not here.)
describe('CodeBlock', () => {
  const render = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

  it('renders the source with a copy button', () => {
    const html = render(<CodeBlock source={'npm install\nnpm test'} />);
    expect(html).toContain('data-testid="code-block"');
    expect(html).toContain('data-testid="code-copy"');
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('npm install');
  });

  it('leaves room for the button so it never sits on the first line', () => {
    const html = render(<CodeBlock source="x" />);
    expect(html).toContain('pr-10');
  });

  it('gives fenced blocks in a message body the button', () => {
    const html = render(<>{renderBlocks('before\n```\nsecret-token\n```\nafter', {}, undefined)}</>);
    expect(html).toContain('data-testid="code-copy"');
    // Fence markers are stripped by the segmenter, so what the button holds is
    // the code alone — pasting it back must not paste ``` with it.
    expect(html).toContain('secret-token');
    expect(html).not.toContain('```');
  });

  it('does not put one on ordinary prose', () => {
    const html = render(<>{renderBlocks('just a sentence', {}, undefined)}</>);
    expect(html).not.toContain('data-testid="code-copy"');
  });
});

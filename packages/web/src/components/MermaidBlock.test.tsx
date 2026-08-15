import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { interpretReply, MermaidBlock, MermaidLightbox } from './MermaidBlock';

// The zoom overlay (#232) is driven entirely by the sandbox's replies, because
// a frame swallows its own clicks. `interpretReply` is that protocol, so these
// cover the routing; the markup tests cover what the two states render.
describe('interpretReply', () => {
  const id = 'abc123';

  it('answers "ready" with a send, whatever the id would have been', () => {
    expect(interpretReply({ flowMermaid: 'ready' }, id)).toEqual({ kind: 'send' });
  });

  it('turns a successful result into a height, floored at 24', () => {
    expect(interpretReply({ flowMermaid: 'result', id, ok: true, height: 310 }, id)).toEqual({
      kind: 'status',
      status: { state: 'ok', height: 310 },
    });
    expect(interpretReply({ flowMermaid: 'result', id, ok: true, height: 0 }, id)).toEqual({
      kind: 'status',
      status: { state: 'ok', height: 24 },
    });
  });

  it('carries the sandbox’s own error text, and falls back when there is none', () => {
    expect(interpretReply({ flowMermaid: 'result', id, ok: false, error: 'bad graph' }, id)).toEqual({
      kind: 'status',
      status: { state: 'error', message: 'bad graph' },
    });
    expect(interpretReply({ flowMermaid: 'result', id, ok: false }, id)).toEqual({
      kind: 'status',
      status: { state: 'error', message: 'The diagram could not be rendered.' },
    });
  });

  it('routes a click to activate and a backdrop click to dismiss', () => {
    expect(interpretReply({ flowMermaid: 'activate', id }, id)).toEqual({ kind: 'activate' });
    expect(interpretReply({ flowMermaid: 'dismiss', id }, id)).toEqual({ kind: 'dismiss' });
  });

  // Every frame on the page hears every other frame's messages, so a second
  // diagram in the same conversation must not open the first one's overlay.
  it('ignores anything addressed to another frame', () => {
    for (const kind of ['result', 'resize', 'activate', 'dismiss']) {
      expect(interpretReply({ flowMermaid: kind, id: 'someone-else', ok: true, height: 40 }, id)).toBeNull();
    }
  });

  it('ignores messages that are not the sandbox’s', () => {
    expect(interpretReply(undefined, id)).toBeNull();
    expect(interpretReply('hello', id)).toBeNull();
    expect(interpretReply({ type: 'webpackOk' }, id)).toBeNull();
    expect(interpretReply({ flowMermaid: 'something-new', id }, id)).toBeNull();
  });
});

describe('MermaidBlock markup', () => {
  const source = 'flowchart LR\n  A --> B';

  it('renders the sandboxed frame and keeps the copy control', () => {
    const html = renderToStaticMarkup(<MermaidBlock source={source} />);
    expect(html).toContain('data-testid="mermaid-frame"');
    expect(html).toContain('data-testid="mermaid-copy"');
    // The isolation from #229 is the reason this works at all — a zoom that
    // needed the SVG in this document would have had to give it up.
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('src="/mermaid/sandbox.html"');
  });

  it('renders the overlay with copy and close, and no file-only chrome', () => {
    const html = renderToStaticMarkup(<MermaidLightbox source={source} dark={false} onClose={() => {}} />);
    expect(html).toContain('data-testid="mermaid-lightbox"');
    expect(html).toContain('data-testid="mermaid-lightbox-frame"');
    expect(html).toContain('data-testid="mermaid-lightbox-copy"');
    expect(html).toContain('data-testid="mermaid-lightbox-close"');
    // A diagram has no file behind it, so Download and Open external — which
    // act on a file URL — must not appear.
    expect(html).not.toContain('lightbox-download');
    expect(html).not.toContain('lightbox-open-external');
  });

  it('asks the overlay frame to fill the window, not to cap at message height', () => {
    const html = renderToStaticMarkup(<MermaidLightbox source={source} dark={false} onClose={() => {}} />);
    expect(html).toContain('h-[85vh]');
    expect(html).toContain('w-[88vw]');
  });
});

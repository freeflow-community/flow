// A ```mermaid block in a message body, drawn as a diagram (#229).
//
// The rendering happens in /mermaid/sandbox.html, inside a `sandbox`ed iframe
// with no `allow-same-origin` — so the frame has an opaque origin, no access
// to this document, and no cookies. Diagram source goes in by postMessage and
// only a height comes back; the SVG never enters this document. The macOS and
// iOS clients host the same page in a WKWebView, which is what makes "the same
// renderer on all three clients" literally true.
import { useCallback, useEffect, useRef, useState } from 'react';

/** The host's own bound on a frame that never answers — the script failing to
 *  load, or a parse that hangs before the sandbox's own timer can fire. */
const REPLY_TIMEOUT_MS = 8000;

type Status = { state: 'pending' } | { state: 'ok'; height: number } | { state: 'error'; message: string };

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/**
 * Copies the diagram source, with a moment of "Copied" feedback.
 *
 * Always visible, unlike the hover-reveal pin on a link: a diagram hides its
 * source completely, so this is the only way to reach something the reader
 * cannot otherwise see. It stays muted until hover so it does not compete with
 * the diagram.
 */
function CopySourceButton({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [source]);
  return (
    <button
      type="button"
      data-testid="mermaid-copy"
      title="Copy diagram source"
      aria-label="Copy diagram source"
      onClick={onCopy}
      className="rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-daypill hover:text-ink-soft"
    >
      {copied ? 'Copied' : 'Copy source'}
    </button>
  );
}

export function MermaidBlock({ source }: { source: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'pending' });
  const [dark, setDark] = useState(prefersDark);

  // Follow the host's colour scheme, so the diagram matches the app rather
  // than staying on whichever theme it first rendered with.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = () => setDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setStatus({ state: 'pending' });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;

    const send = () =>
      frame.current?.contentWindow?.postMessage(
        { flowMermaid: 'render', id, source, theme: dark ? 'dark' : 'light' },
        '*',
      );

    const onMessage = (event: MessageEvent) => {
      // The frame is opaque-origin, so `event.origin` is "null" and carries no
      // information — identity comes from the window reference and the id.
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as
        | { flowMermaid: 'ready' }
        | { flowMermaid: 'result'; id: string; ok: boolean; height?: number; error?: string }
        | { flowMermaid: 'resize'; id: string; height: number }
        | undefined;
      if (!data || typeof data !== 'object') return;
      if (data.flowMermaid === 'ready') {
        send();
      } else if (data.flowMermaid === 'result' && data.id === id) {
        settled = true;
        clearTimeout(timer);
        setStatus(
          data.ok
            ? { state: 'ok', height: Math.max(data.height ?? 0, 24) }
            : { state: 'error', message: data.error || 'The diagram could not be rendered.' },
        );
      } else if (data.flowMermaid === 'resize' && data.id === id) {
        setStatus((s) => (s.state === 'ok' ? { state: 'ok', height: Math.max(data.height, 24) } : s));
      }
    };

    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => {
      if (!settled) setStatus({ state: 'error', message: 'The diagram renderer did not answer.' });
    }, REPLY_TIMEOUT_MS);
    // The frame may already be loaded (a re-render on theme change), in which
    // case no "ready" is coming and this send is the one that lands.
    send();

    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, [source, dark]);

  if (status.state === 'error') {
    // Invalid syntax falls back to what the author wrote, plus the reason —
    // the diagram is unreadable, but the message must not be.
    return (
      <div className="my-1" data-testid="mermaid-block">
        <div className="flex items-center justify-between gap-2">
          <span data-testid="mermaid-error" className="text-[11px] text-[#c4342e]">
            Mermaid: {status.message}
          </span>
          <CopySourceButton source={source} />
        </div>
        <pre
          data-testid="code-block"
          className="my-1 max-w-full overflow-x-auto rounded-lg bg-[#f4f2ee] px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre"
        >
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="my-1 max-w-full" data-testid="mermaid-block">
      <div className="flex justify-end">
        <CopySourceButton source={source} />
      </div>
      <iframe
        ref={frame}
        title="Mermaid diagram"
        data-testid="mermaid-frame"
        src="/mermaid/sandbox.html"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="lazy"
        className="w-full border-0"
        style={{ height: status.state === 'ok' ? status.height : 24 }}
      />
    </div>
  );
}

// A ```mermaid block in a message body, drawn as a diagram (#229).
//
// The rendering happens in /mermaid/sandbox.html, inside a `sandbox`ed iframe
// with no `allow-same-origin` — so the frame has an opaque origin, no access
// to this document, and no cookies. Diagram source goes in by postMessage and
// only a height comes back; the SVG never enters this document. The macOS and
// iOS clients host the same page in a WKWebView, which is what makes "the same
// renderer on all three clients" literally true.
//
// Clicking the diagram zooms it (#232). The overlay holds a *second* frame of
// the same page rendering the same source at window size — not the SVG lifted
// out of the first one, which is what keeps the boundary above intact.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CodeBlock } from './CodeBlock';
import { LightboxShell } from './Lightbox';

/** The host's own bound on a frame that never answers — the script failing to
 *  load, or a parse that hangs before the sandbox's own timer can fire. */
const REPLY_TIMEOUT_MS = 8000;

type Status = { state: 'pending' } | { state: 'ok'; height: number } | { state: 'error'; message: string };

type Reply =
  | { flowMermaid: 'ready' }
  | { flowMermaid: 'result'; id: string; ok: boolean; height?: number; error?: string }
  | { flowMermaid: 'resize'; id: string; height: number }
  | { flowMermaid: 'activate'; id: string }
  | { flowMermaid: 'dismiss'; id: string };

/** What one reply from the sandbox asks the host to do. */
export type Action =
  | { kind: 'send' }
  | { kind: 'status'; status: Status }
  | { kind: 'activate' }
  | { kind: 'dismiss' };

/**
 * Reads one reply from the sandbox. Split out as a pure function so the
 * protocol — including a reply meant for a different frame, which is ordinary
 * here because every frame hears every other frame's messages — is testable
 * without a browser.
 */
export function interpretReply(data: unknown, id: string): Action | null {
  const reply = data as Reply | undefined;
  if (!reply || typeof reply !== 'object') return null;
  switch (reply.flowMermaid) {
    case 'ready':
      return { kind: 'send' };
    case 'result':
      if (reply.id !== id) return null;
      return {
        kind: 'status',
        status: reply.ok
          ? { state: 'ok', height: Math.max(reply.height ?? 0, 24) }
          : { state: 'error', message: reply.error || 'The diagram could not be rendered.' },
      };
    case 'resize':
      if (reply.id !== id) return null;
      return { kind: 'status', status: { state: 'ok', height: Math.max(reply.height, 24) } };
    case 'activate':
      return reply.id === id ? { kind: 'activate' } : null;
    case 'dismiss':
      return reply.id === id ? { kind: 'dismiss' } : null;
    default:
      return null;
  }
}

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** Follows the host's colour scheme, so a diagram matches the app rather than
 *  staying on whichever theme it first rendered with. */
function useDark(): boolean {
  const [dark, setDark] = useState(prefersDark);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return;
    const onChange = () => setDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/**
 * Copies the diagram source, with a moment of "Copied" feedback.
 *
 * Always visible, unlike the hover-reveal pin on a link: a diagram hides its
 * source completely, so this is the only way to reach something the reader
 * cannot otherwise see. It stays muted until hover so it does not compete with
 * the diagram.
 */
function CopySourceButton({
  source,
  testId = 'mermaid-copy',
  className,
}: {
  source: string;
  testId?: string;
  className?: string;
}) {
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
      data-testid={testId}
      title="Copy diagram source"
      aria-label="Copy diagram source"
      onClick={onCopy}
      className={
        className ??
        'rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-daypill hover:text-ink-soft'
      }
    >
      {copied ? 'Copied' : 'Copy source'}
    </button>
  );
}

/**
 * One sandboxed frame drawing one diagram — inline in a message, or filling
 * the zoom overlay when `fit` is "window".
 *
 * The callbacks live in a ref rather than in the effect's dependencies: a
 * parent re-render must not tear down the frame and re-run the render
 * handshake, which would flash the diagram away and back.
 */
function MermaidFrame({
  source,
  dark,
  fit,
  testId,
  className,
  style,
  onStatus,
  onActivate,
  onDismiss,
}: {
  source: string;
  dark: boolean;
  fit?: 'window';
  testId: string;
  className?: string;
  style?: CSSProperties;
  onStatus: (status: Status) => void;
  onActivate?: () => void;
  onDismiss?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const handlers = useRef({ onStatus, onActivate, onDismiss });
  handlers.current = { onStatus, onActivate, onDismiss };

  useEffect(() => {
    handlers.current.onStatus({ state: 'pending' });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;

    const send = () =>
      frame.current?.contentWindow?.postMessage(
        { flowMermaid: 'render', id, source, theme: dark ? 'dark' : 'light', fit },
        '*',
      );

    const onMessage = (event: MessageEvent) => {
      // The frame is opaque-origin, so `event.origin` is "null" and carries no
      // information — identity comes from the window reference and the id.
      if (event.source !== frame.current?.contentWindow) return;
      const action = interpretReply(event.data, id);
      if (!action) return;
      switch (action.kind) {
        case 'send':
          send();
          break;
        case 'status':
          settled = true;
          clearTimeout(timer);
          handlers.current.onStatus(action.status);
          break;
        case 'activate':
          handlers.current.onActivate?.();
          break;
        case 'dismiss':
          handlers.current.onDismiss?.();
          break;
      }
    };

    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => {
      if (!settled) handlers.current.onStatus({ state: 'error', message: 'The diagram renderer did not answer.' });
    }, REPLY_TIMEOUT_MS);
    // The frame may already be loaded (a re-render on theme change), in which
    // case no "ready" is coming and this send is the one that lands.
    send();

    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, [source, dark, fit]);

  return (
    <iframe
      ref={frame}
      title="Mermaid diagram"
      data-testid={testId}
      src="/mermaid/sandbox.html"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      className={className}
      style={style}
    />
  );
}

/** The zoomed diagram (#232), in the overlay images and video already use.
 *  There is no file behind a diagram, so the chrome carries Copy source where
 *  an image carries Open external and Download. */
export function MermaidLightbox({ source, dark, onClose }: { source: string; dark: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<Status>({ state: 'pending' });
  return (
    <LightboxShell
      testId="mermaid-lightbox"
      onClose={onClose}
      actions={
        <CopySourceButton
          source={source}
          testId="mermaid-lightbox-copy"
          className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-white/15 px-2 text-xs text-white hover:bg-white/30"
        />
      }
    >
      {status.state === 'error' && (
        <span data-testid="mermaid-lightbox-error" className="absolute text-sm text-white/70">
          Mermaid: {status.message}
        </span>
      )}
      <MermaidFrame
        source={source}
        dark={dark}
        fit="window"
        testId="mermaid-lightbox-frame"
        onStatus={setStatus}
        onDismiss={onClose}
        className="h-[85vh] w-[88vw] rounded-lg border-0"
      />
    </LightboxShell>
  );
}

export function MermaidBlock({ source }: { source: string }) {
  const [status, setStatus] = useState<Status>({ state: 'pending' });
  const [zoomed, setZoomed] = useState(false);
  const dark = useDark();

  // A source or theme change re-renders the frame from scratch; an overlay
  // still open would be showing the old diagram, so it closes with it.
  useEffect(() => setZoomed(false), [source]);

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
        {/* The fallback is an ordinary code block, so it gets the ordinary code
            block's copy button too (#260) — the one above copies the same text,
            but a reader looking at a <pre> should not have to notice that. */}
        <CodeBlock source={source} />
      </div>
    );
  }

  return (
    <div className="my-1 max-w-full" data-testid="mermaid-block">
      <div className="flex justify-end gap-1">
        {/* Clicking the diagram is the main way in, but that click is reported
            by the frame and so is unreachable from the keyboard. This is the
            keyboard's way in — and it names the affordance for anyone who does
            not think to try clicking a picture. */}
        {status.state === 'ok' && (
          <button
            type="button"
            data-testid="mermaid-expand"
            title="Zoom diagram"
            aria-label="Zoom diagram"
            onClick={() => setZoomed(true)}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-daypill hover:text-ink-soft"
          >
            Zoom
          </button>
        )}
        <CopySourceButton source={source} />
      </div>
      <MermaidFrame
        source={source}
        dark={dark}
        testId="mermaid-frame"
        onStatus={setStatus}
        onActivate={() => setZoomed(true)}
        className="w-full border-0"
        style={{ height: status.state === 'ok' ? status.height : 24 }}
      />
      {zoomed && <MermaidLightbox source={source} dark={dark} onClose={() => setZoomed(false)} />}
    </div>
  );
}

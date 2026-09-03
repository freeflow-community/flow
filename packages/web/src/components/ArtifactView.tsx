// Artifact body (phase 13): the artifact tab's content inside the tabbed side
// panel (see SidePanel). A compact toolbar (rename + size + download) sits above
// the viewer, which renders images, video, text, PDF, and HTML (sandboxed
// iframe); anything else gets a download card. The panel chrome (width, resizer,
// tab strip, close) lives in SidePanel. The underlying file stays
// access-checked server-side.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ArtifactDTO, FileDTO } from '@flow/shared';
import { ApiError, api, blobUrl, fileStreamUrl, fileText, mintAppToken } from '../lib/api';
import { bytesLabel } from '../lib/format';
import { isHtmlFile, isImageFile, isTextFile, isVideoFile } from '../lib/fileKind';
import { useSelection } from '../state';
import { useArtifacts } from '../hooks';
import { useFileImageSource } from './FileImage';

export default function ArtifactBody({ artifactId }: { artifactId: string }) {
  const sel = useSelection();
  const qc = useQueryClient();
  const artifacts = useArtifacts(sel.workspaceId);
  const artifact = (artifacts.data ?? []).find((a) => a.id === artifactId);

  // The artifact vanished (deleted here or on another device / event raced the
  // list): clear the active-artifact tab.
  useEffect(() => {
    if (artifacts.data && !artifact) sel.selectArtifact(null);
  }, [artifacts.data, artifact, sel]);

  if (!artifact) {
    return <div className="flex min-h-0 flex-1 items-center justify-center text-faint">Loading…</div>;
  }
  // Link artifacts open in the co-browsing mini-browser (its own URL-bar chrome
  // replaces the file toolbar); everything else is a pinned file.
  if (artifact.kind === 'link') {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid={`artifact-body-${artifact.name}`}>
        <LinkPane artifact={artifact} />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid={`artifact-body-${artifact.name}`}>
      <ArtifactToolbar
        artifact={artifact}
        onRenamed={() => void qc.invalidateQueries({ queryKey: ['artifacts', artifact.workspaceId] })}
      />
      {artifact.file && <ArtifactContent key={artifact.fileId} file={artifact.file} />}
    </div>
  );
}

/**
 * The co-browsing mini-browser (link artifacts). An editable URL bar sits above an
 * iframe of the pinned page. Editing the URL PATCHes the artifact, so the
 * server re-points it and publishes artifact.updated — every channel member's
 * pane follows (see Main.tsx's updated-event cache seed). The committed shared
 * url is `artifact.url`; `draft` is the local text field, resynced whenever the
 * shared url changes (yours follows the group when someone else navigates).
 *
 * Mini apps (docs/design/MINI_APPS.md): when the artifact is an app, opening it
 * mints a 5-minute identity token first and appends it to the url the *frame*
 * loads. The shared url — the thing the URL bar shows and the PATCH broadcasts —
 * never carries a token; each viewer appends their own at load time, and a
 * reload mints a fresh one.
 *
 * Web limits (documented divergence from the native macOS viewer): (1) many
 * sites refuse framing via X-Frame-Options / CSP frame-ancestors — we can't read
 * cross-origin frame state, so a load that never paints is surfaced as a
 * best-effort "can't embed" hint with Open-in-new-tab; (2) in-page clicks to
 * another origin can't be observed, so only URL-bar edits broadcast.
 */
function LinkPane({ artifact }: { artifact: ArtifactDTO }) {
  const url = artifact.url ?? '';
  const [draft, setDraft] = useState(url);
  const [loaded, setLoaded] = useState(false);
  const [maybeBlocked, setMaybeBlocked] = useState(false);
  // Bumped by Go/Enter on the url we're already showing: nothing changes
  // server-side, but the iframe key does, so the page reloads (and any in-page
  // navigation the iframe did on its own is reset back to the shared url). For
  // an app that also re-mints — a reload is a fresh token.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [frame, setFrame] = useState<FrameState>({ kind: 'idle' });

  // Follow the shared url: when it changes (remote navigation or our own echo)
  // — or when we force a reload — resync the field and reset the load state so
  // the block hint re-evaluates.
  useEffect(() => {
    setDraft(url);
    setLoaded(false);
    setMaybeBlocked(false);
    if (!url) return;
    const t = setTimeout(() => setMaybeBlocked(true), 4000);
    return () => clearTimeout(t);
  }, [url, reloadNonce]);

  // Resolve what the iframe should load — the decision itself is `planFrame`.
  useEffect(() => {
    const plan = planFrame(url, artifact.isApp, framedAppsBlocked());
    if (plan.kind !== 'mint') { setFrame(plan); return; }
    let alive = true;
    setFrame({ kind: 'minting' });
    void mintAppToken(artifact.id)
      .then(({ token }) => { if (alive) setFrame({ kind: 'ready', src: withAppToken(url, token) }); })
      // The mint failed, so nothing is loaded: the tunnel is never asked for a
      // page we already know the guard would refuse.
      .catch((e: unknown) => { if (alive) setFrame({ kind: 'error', message: mintErrorMessage(e) }); });
    return () => { alive = false; };
  }, [url, reloadNonce, artifact.id, artifact.isApp]);

  const go = async (raw: string) => {
    const next = normalizeUrl(raw);
    if (!next) return;
    if (next === url) {
      setReloadNonce((n) => n + 1); // same page: reload rather than no-op
      return;
    }
    // Optimistic: the PATCH echoes back an artifact.updated that reconciles the
    // cache; we don't need to setDraft here (the url-effect will on echo).
    try {
      await api('PATCH', `/v1/artifacts/${artifact.id}`, { url: next });
    } catch {
      setDraft(url); // revert the field if the server rejected it
    }
  };

  /** Open in a real tab. For an app that means a fresh token, minted on the
   * click: the window is opened synchronously so the gesture still counts, then
   * pointed at the tokened url once the mint returns. */
  const openExternally = () => {
    if (!url) return;
    if (!artifact.isApp) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    const w = window.open('about:blank', '_blank');
    if (w) { try { w.opener = null; } catch { /* cross-origin about:blank; harmless */ } }
    void mintAppToken(artifact.id)
      .then(({ token }) => {
        const href = withAppToken(url, token);
        if (w) w.location.replace(href);
        else window.open(href, '_blank', 'noopener,noreferrer'); // popup blocked: try once more
      })
      .catch((e: unknown) => {
        w?.close();
        setFrame({ kind: 'error', message: mintErrorMessage(e) });
      });
  };

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-hairline px-2">
        {artifact.isApp && (
          <span
            data-testid="link-artifact-app-badge"
            className="shrink-0 rounded bg-daypill px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase"
            title="A Flow app — only channel members can open it"
          >
            app
          </span>
        )}
        <input
          data-testid="link-artifact-url"
          className="min-w-0 flex-1 rounded border border-hairline2 bg-white px-2 py-0.5 font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go(draft);
            if (e.key === 'Escape') setDraft(url);
          }}
          spellCheck={false}
          aria-label="Address"
        />
        <button
          data-testid="link-artifact-go"
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-accent-soft hover:bg-daypill"
          title="Go"
          onClick={() => void go(draft)}
        >
          Go
        </button>
        {/* A plain link stays a real anchor, so cmd-click and copy-link-address
            keep working. An app can't: its url is only useful with a token
            minted on the click, so that one has to be a button. */}
        {url && (artifact.isApp ? (
          <button
            data-testid="link-artifact-open"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm text-faint hover:bg-daypill hover:text-ink"
            title="Open in new tab"
            onClick={openExternally}
          >
            ↗
          </button>
        ) : (
          <a
            data-testid="link-artifact-open"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm text-faint hover:bg-daypill hover:text-ink"
            title="Open in new tab"
          >
            ↗
          </a>
        ))}
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {frame.kind === 'ready' ? (
          <iframe
            key={`${frame.src}#${reloadNonce}`}
            data-testid={`artifact-link-${artifact.name}`}
            title={artifact.name}
            src={frame.src}
            onLoad={() => { setLoaded(true); setMaybeBlocked(false); }}
            // Permissive: this is cross-origin content in its own origin, so it
            // can't reach our DOM/token — let it behave like a normal browser tab.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            className="h-full w-full"
          />
        ) : frame.kind === 'minting' ? (
          <Centered>Opening app…</Centered>
        ) : frame.kind === 'needs-new-tab' ? (
          <AppNeedsNewTab onOpen={openExternally} />
        ) : frame.kind === 'error' ? (
          <AppError message={frame.message} onRetry={() => setReloadNonce((n) => n + 1)} />
        ) : (
          <Centered>No URL</Centered>
        )}
        {frame.kind === 'ready' && maybeBlocked && !loaded && (
          <div
            data-testid="link-artifact-blocked"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/95 p-6 text-center"
          >
            <p className="text-sm text-muted">
              This page is taking a while — some sites don’t allow being embedded.
            </p>
            <div className="flex items-center gap-2">
              <button
                className="rounded-[10px] border border-hairline bg-white px-4 py-2 text-sm font-medium hover:border-hairline2"
                onClick={openExternally}
              >
                Open in new tab ↗
              </button>
              <button
                className="rounded-[10px] px-3 py-2 text-sm text-muted hover:text-ink"
                onClick={() => setMaybeBlocked(false)}
              >
                Keep waiting
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** What the mini-browser's viewport is showing. Only `ready` puts a request on
 * the wire, so a failed mint never reaches the app's tunnel. */
type FrameState =
  | { kind: 'idle' }
  | { kind: 'minting' }
  | { kind: 'ready'; src: string }
  | { kind: 'needs-new-tab' }
  | { kind: 'error'; message: string };

/**
 * What to do when the pane opens a link — the whole mint-before-open decision,
 * kept pure so it is checkable without a DOM.
 *
 * A plain link artifact frames its url exactly as before: no mint, no token,
 * nothing new on the wire. An app has to mint first (`mint`, which the caller
 * turns into `ready` or `error`), except on a browser that won't hold the
 * guard's cookie in a frame, where framing it at all would only render the
 * guard's 401 — see `framedAppsBlocked`.
 */
export function planFrame(
  url: string,
  isApp: boolean,
  blocked: boolean,
): { kind: 'idle' } | { kind: 'ready'; src: string } | { kind: 'mint' } | { kind: 'needs-new-tab' } {
  if (!url) return { kind: 'idle' };
  if (!isApp) return { kind: 'ready', src: url };
  if (blocked) return { kind: 'needs-new-tab' };
  return { kind: 'mint' };
}

/**
 * Append a minted identity token to an app's url. `searchParams` rather than
 * string concatenation so an app url that already carries a query or a hash
 * survives intact — the guard reads `flow_token` out of the query and 302s to
 * the url without it.
 */
export function withAppToken(url: string, token: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('flow_token', token);
    return u.toString();
  } catch {
    // Not parseable (shouldn't happen — the server normalizes link urls), but a
    // token that can't be attached means an app that can't open.
    return `${url}${url.includes('?') ? '&' : '?'}flow_token=${encodeURIComponent(token)}`;
  }
}

/**
 * True when this browser will refuse the guard's session cookie in a frame, so
 * an app can only be opened in a real tab.
 *
 * Measured (issue #371, Safari 26.4, real tunnel): WebKit blocks third-party
 * cookies unconditionally — it neither stores the guard's `SameSite=None`
 * cookie set in a frame *nor sends* one already established first-party. The
 * guard's 302 to the clean url drops the token, so the very next request is
 * unauthenticated and the frame lands on the guard's 401. Re-minting per load
 * doesn't help: it is that same request, with a fresh token, every time.
 * Top-level the identical url works, which is what this routes people to.
 *
 * `navigator.vendor` is the narrow WebKit signal (Safari, and every browser on
 * iOS). It only picks which affordance to show — the new-tab path exists in
 * every browser — so being wrong costs a click, not access.
 */
export function framedAppsBlocked(vendor: string = navigator.vendor): boolean {
  return vendor === 'Apple Computer, Inc.';
}

/** ApiError carries the server's message; anything else is a network failure. */
export function mintErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403 || e.status === 404) return 'You no longer have access to this app.';
    return e.message;
  }
  return 'Couldn’t reach Flow to open this app.';
}

function AppNeedsNewTab({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      data-testid="link-artifact-app-new-tab"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="max-w-sm text-sm text-muted">
        Safari blocks the cookies this app needs when it’s embedded. Open it in a tab and you’ll be
        signed in automatically.
      </p>
      <button
        className="rounded-[10px] border border-hairline bg-white px-4 py-2 text-sm font-medium hover:border-hairline2"
        onClick={onOpen}
      >
        Open app in new tab ↗
      </button>
    </div>
  );
}

function AppError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      data-testid="link-artifact-app-error"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p className="max-w-sm text-sm text-muted">{message}</p>
      <button
        className="rounded-[10px] border border-hairline bg-white px-4 py-2 text-sm font-medium hover:border-hairline2"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

/** Add a scheme if the user typed a bare host; reject anything non-http(s). */
function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function ArtifactToolbar({ artifact, onRenamed }: { artifact: ArtifactDTO; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(artifact.name);
  // keep the field in sync when the artifact is renamed elsewhere
  useEffect(() => setName(artifact.name), [artifact.name]);
  const save = async () => {
    const next = name.trim();
    setEditing(false);
    if (next && next !== artifact.name) {
      await api('PATCH', `/v1/artifacts/${artifact.id}`, { name: next });
      onRenamed();
    } else {
      setName(artifact.name);
    }
  };
  const download = async () => {
    if (!artifact.file) return;
    const url = await blobUrl(`/v1/files/${artifact.file.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.file.name;
    a.click();
  };
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hairline px-4">
      {editing ? (
        <input
          className="min-w-0 flex-1 rounded border border-hairline2 bg-white px-2 py-0.5 text-[13px] font-semibold"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') { setEditing(false); setName(artifact.name); }
          }}
          onBlur={() => void save()}
          autoFocus
        />
      ) : (
        <button
          data-testid="artifact-title"
          className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-muted hover:text-ink hover:underline"
          title="Rename"
          onClick={() => setEditing(true)}
        >
          {artifact.name}
        </button>
      )}
      {artifact.file && <span className="shrink-0 text-xs text-faint">{bytesLabel(artifact.file.sizeBytes)}</span>}
      <button
        data-testid="artifact-download"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-faint hover:bg-daypill hover:text-ink"
        title="Download"
        onClick={() => void download()}
      >
        ⤓
      </button>
    </div>
  );
}

function ArtifactContent({ file }: { file: FileDTO }) {
  if (isImageFile(file)) return <ImagePane file={file} />;
  if (isVideoFile(file)) return <VideoPane file={file} />;
  if (file.mimeType === 'application/pdf') return <PdfPane file={file} />;
  if (isHtmlFile(file)) return <HtmlPane file={file} />;
  if (isTextFile(file)) return <TextPane file={file} />;
  return <DownloadPane file={file} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-faint">{children}</div>;
}

function ImagePane({ file }: { file: FileDTO }) {
  const image = useFileImageSource(file.id, 'original');
  if (image.status === 'failed') return <DownloadPane file={file} />;
  if (!image.src) return <Centered>Loading…</Centered>;
  return (
    <div className="mc-scroll flex min-h-0 flex-1 items-center justify-center overflow-auto bg-daypill/40 p-4">
      <img
        src={image.src}
        alt={file.name}
        className="max-h-full max-w-full rounded-lg"
        data-testid={`artifact-image-${file.name}`}
        onLoad={image.onLoad}
        onError={image.onError}
      />
    </div>
  );
}

/** Streamed when the server can presign (R2 serves Range); whole-blob fallback
 * otherwise — mirrors the chat card's strategy. */
function VideoPane({ file }: { file: FileDTO }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void fileStreamUrl(file.id)
      .then((r) => {
        if (!alive) return null;
        if (r.url) { setUrl(r.url); return null; }
        return blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (!url) return <Centered>Loading…</Centered>;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-4">
      <video
        data-testid={`artifact-video-${file.name}`}
        src={url}
        controls
        className="max-h-full max-w-full rounded-lg"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function PdfPane({ file }: { file: FileDTO }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (!url) return <Centered>Loading…</Centered>;
  return (
    <embed
      data-testid={`artifact-pdf-${file.name}`}
      src={url}
      type="application/pdf"
      className="min-h-0 flex-1"
    />
  );
}

/** Sandboxed HTML render: scripts may run, but no same-origin access — the
 * document can never reach our token/localStorage or call the API as the user. */
function HtmlPane({ file }: { file: FileDTO }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void fileText(`/v1/files/${file.id}`).then((t) => { if (alive) setHtml(t); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (html === null) return <Centered>Loading…</Centered>;
  return (
    <iframe
      data-testid={`artifact-html-${file.name}`}
      title={file.name}
      srcDoc={html}
      sandbox="allow-scripts"
      className="min-h-0 flex-1 bg-white"
    />
  );
}

const TEXT_MAX = 1_000_000; // chars — full-pane viewer, roomier than the chat preview

function TextPane({ file }: { file: FileDTO }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void fileText(`/v1/files/${file.id}`).then((t) => { if (alive) setText(t); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (text === null) return <Centered>Loading…</Centered>;
  return (
    <div className="mc-scroll min-h-0 flex-1 overflow-auto">
      <pre
        data-testid={`artifact-text-${file.name}`}
        className="px-[22px] py-4 font-mono text-xs leading-5 whitespace-pre text-ink"
      >
        {text.slice(0, TEXT_MAX)}
      </pre>
      {text.length > TEXT_MAX && (
        <p className="px-[22px] pb-4 text-xs text-faint">Showing the first 1 MB — download for the full file.</p>
      )}
    </div>
  );
}

function DownloadPane({ file }: { file: FileDTO }) {
  const download = async () => {
    const url = await blobUrl(`/v1/files/${file.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  };
  return (
    <Centered>
      <button
        data-testid={`artifact-chip-${file.name}`}
        className="flex items-center gap-2 rounded-[10px] border border-hairline bg-white px-4 py-3 text-left text-sm hover:border-hairline2"
        onClick={() => void download()}
      >
        <span>📄</span>
        <span>
          <span className="block font-medium">{file.name}</span>
          <span className="block text-xs text-muted">{bytesLabel(file.sizeBytes)} — click to download</span>
        </span>
      </button>
    </Centered>
  );
}

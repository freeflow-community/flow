// Community email (#481): the admin's broadcast composer, launched from the
// Directory header.
//
// Everything the composer *claims* comes from the server rather than from this
// file: the recipient count is the number the send would use, and the Preview
// tab renders HTML the server produced by the same function that mails it. The
// alternative — counting the roster here and rendering markdown here — would be
// a second implementation of both rules, free to drift from the one that
// actually goes out to people.
import { useEffect, useRef, useState } from 'react';
import { EMAIL_IMAGE_MAX_BYTES } from '@flow/shared';
import type {
  WorkspaceEmailImageDTO,
  WorkspaceEmailPreviewDTO,
  WorkspaceEmailResultDTO,
} from '@flow/shared';
import { ApiError, api, uploadFile } from '../lib/api';
import {
  applyImagePaste,
  imagesFromClipboard,
  pastedImageMarkdown,
  pastedImageUrls,
  removeUploadPlaceholder,
  replaceUploadPlaceholder,
  uploadPlaceholder,
} from '../lib/emailImagePaste';
import { Modal } from './modals';

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;

/**
 * What a rejected paste says (#492). The server owns the cap and the type
 * list — it is the only place they bind — so this only translates its codes
 * into something a person composing an announcement can act on.
 */
export function imagePasteErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'image_too_large') {
      const mb = Math.round(EMAIL_IMAGE_MAX_BYTES / (1024 * 1024));
      return `That image is too large to email — the limit is ${mb} MB.`;
    }
    if (err.code === 'unsupported_image') return 'That image type can’t be shown in an email. Try a PNG or JPEG.';
  }
  return 'Couldn’t upload that image. Try again.';
}

/** `N people`, or `1 person` — used in the To chip, the confirm and the toast. */
export function peopleLabel(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/** What the result toast says. Kept pure so the wording is testable without a
 * render: a clean run never mentions failures, a partial one always does. */
export function resultToastText(res: WorkspaceEmailResultDTO): string {
  return res.failed === 0
    ? `Sent to ${peopleLabel(res.sent)}`
    : `Sent to ${res.sent}, failed for ${res.failed}`;
}

/** Banner wording for "Send test to me" (#484). The address is named rather
 * than implied: an admin with a work and a personal account should not have to
 * guess which inbox to go and look in. */
export function testResultText(res: WorkspaceEmailResultDTO, email: string | undefined): string {
  if (res.sent > 0) return email ? `Test sent to ${email}` : 'Test sent to you';
  return 'Test send failed — the address bounced.';
}

export function EmailEveryoneModal({
  workspaceId,
  workspaceName,
  selfEmail,
  onClose,
  onSent,
}: {
  workspaceId: string;
  /** Named in the confirm step: "every human member of <name>" reads as a
   * real consequence in a way "this workspace" does not. */
  workspaceName?: string;
  /** The signed-in user's address — named back in the test-send banner (#484). */
  selfEmail?: string;
  onClose: () => void;
  onSent: (res: WorkspaceEmailResultDTO) => void;
}) {
  const [subject, setSubject] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<WorkspaceEmailResultDTO | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  // Monotonic, so two screenshots pasted a second apart can't race to replace
  // each other's placeholder.
  const pasteSeq = useRef(0);

  // An upload in flight means the body still holds an "Uploading image…"
  // placeholder, which would go out as literal text — so it blocks the send.
  const ready = subject.trim().length > 0 && markdown.trim().length > 0 && uploading === 0;

  // The recipient count, from the server that owns the definition of one.
  useEffect(() => {
    let live = true;
    api<{ recipientCount: number }>('GET', `/v1/workspaces/${workspaceId}/email/recipients`)
      .then((r) => { if (live) setCount(r.recipientCount); })
      .catch(() => { if (live) setCount(null); });
    return () => { live = false; };
  }, [workspaceId]);

  // Auto-grow the body the way the mockup shows it — a broadcast is usually
  // longer than the box's resting height, and scrolling a small textarea while
  // composing something that goes to everyone is the wrong feel.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 420)}px`;
  }, [markdown, tab]);

  // Preview is fetched on entering the tab (or the confirm step), not on every
  // keystroke: it is a round trip, and it only has to be right at the moment
  // someone looks. You cannot type on the Preview tab, so this refetches at
  // most once per visit there; the confirm step leaves the body editable, so a
  // late edit re-renders.
  useEffect(() => {
    if ((tab !== 'preview' && !confirming) || !markdown.trim()) return;
    let live = true;
    setPreviewError(null);
    // Never show a previous render next to "Send this email?" — a stale
    // preview under a confirm button is worse than no preview.
    setPreview(null);
    api<WorkspaceEmailPreviewDTO>('POST', `/v1/workspaces/${workspaceId}/email/preview`, { markdown })
      .then((r) => { if (live) setPreview(r.html); })
      .catch((err) => {
        if (live) setPreviewError(err instanceof Error ? err.message : 'preview failed');
      });
    return () => { live = false; };
  }, [tab, confirming, markdown, workspaceId]);

  // The confirm step now carries the whole rendered email (#492), which pushes
  // its own buttons below the fold in a short window. Following its height
  // rather than scrolling once is the point: the images in the render arrive
  // after the HTML does, so a single scroll lands short by exactly however
  // tall they turn out to be.
  useEffect(() => {
    const el = confirmRef.current;
    if (!confirming || !el) return;
    const show = () => el.scrollIntoView({ block: 'end' });
    show();
    const ro = new ResizeObserver(show);
    ro.observe(el);
    return () => ro.disconnect();
  }, [confirming, preview]);

  /**
   * Upload one pasted image and swap its placeholder for the real thing.
   *
   * Two hops: the bytes go up through the ordinary presign flow (so they get
   * the same client-side downscaling every attachment gets), then the file is
   * adopted as an email image, which is what mints a URL a mail client with no
   * Flow session can fetch.
   */
  const uploadPastedImage = async (n: number, file: File) => {
    setUploading((c) => c + 1);
    try {
      const uploaded = await uploadFile(workspaceId, file);
      const { url } = await api<WorkspaceEmailImageDTO>(
        'POST',
        `/v1/workspaces/${workspaceId}/email/images`,
        { fileId: uploaded.id },
      );
      setMarkdown((md) => replaceUploadPlaceholder(md, n, pastedImageMarkdown(url)));
    } catch (err) {
      // Never leave the placeholder behind: a body that still says "Uploading
      // image…" when it isn't is worse than the image being gone, and it would
      // go out in the mail as literal text.
      setMarkdown((md) => removeUploadPlaceholder(md, n));
      setPasteError(imagePasteErrorText(err));
    } finally {
      setUploading((c) => c - 1);
    }
  };

  /** No image on the clipboard → no `preventDefault`, so plain-text paste is
   * exactly the browser's own behaviour, undo stack included. */
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = imagesFromClipboard(e.clipboardData);
    if (images.length === 0) return;
    e.preventDefault();
    setPasteError(null);

    const el = e.currentTarget;
    const ns = images.map(() => (pasteSeq.current += 1));
    const { value, caret } = applyImagePaste({
      value: markdown,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd,
      // Mixed clipboard content: the text lands where the default paste would
      // have put it, and the images follow.
      text: e.clipboardData.getData('text/plain'),
      placeholders: ns.map(uploadPlaceholder),
    });
    setMarkdown(value);
    // After React has written the new value, or the caret jumps to the end.
    requestAnimationFrame(() => {
      el.selectionStart = caret;
      el.selectionEnd = caret;
    });

    images.forEach((file, i) => void uploadPastedImage(ns[i]!, file));
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await api<WorkspaceEmailResultDTO>('POST', `/v1/workspaces/${workspaceId}/email`, {
        subject: subject.trim(),
        markdown: markdown.trim(),
      });
      onSent(res);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  /** The whole draft, to the author alone. No confirm: it is one email to the
   * person clicking, and the modal stays open so they can go and look. */
  const sendTest = async () => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await api<WorkspaceEmailResultDTO>('POST', `/v1/workspaces/${workspaceId}/email/test`, {
        subject: subject.trim(),
        markdown: markdown.trim(),
      });
      setTestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'test send failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal onClose={onClose} testid="email-everyone-modal" wide>
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="font-bold">Email everyone</h3>
        <button
          aria-label="Close"
          className="-mt-1 shrink-0 text-lg text-faint hover:text-ink"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-muted">To</span>
        <span
          data-testid="email-everyone-recipients"
          className="rounded-full bg-daypill px-2.5 py-1 text-xs font-semibold text-ink-soft"
        >
          {count === null ? 'All members' : `All members — ${peopleLabel(count)}`}
        </span>
      </div>

      <label className="mb-1 block text-[11px] font-bold tracking-wide text-muted uppercase" htmlFor="email-subject">
        Subject
      </label>
      <input
        id="email-subject"
        data-testid="email-everyone-subject"
        className="mb-3 w-full rounded border border-hairline2 px-3 py-2 text-sm"
        maxLength={SUBJECT_MAX}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        autoFocus
      />

      <div className="mb-2 flex gap-4 border-b border-hairline2 text-sm">
        {(['write', 'preview'] as const).map((t) => (
          <button
            key={t}
            data-testid={`email-everyone-tab-${t}`}
            className={`-mb-px border-b-2 px-1 pb-2 capitalize ${
              tab === t ? 'border-accent font-semibold text-accent' : 'border-transparent text-muted'
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'write' ? (
        <textarea
          ref={bodyRef}
          data-testid="email-everyone-body"
          className="mb-2 min-h-[220px] w-full resize-none rounded border border-hairline2 px-3 py-2 font-mono text-[13px] leading-relaxed"
          maxLength={BODY_MAX}
          placeholder={'# Community meetup 🎉\n\nWe’re getting together **in person** on *Friday*.'}
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          onPaste={onPaste}
        />
      ) : (
        <div
          data-testid="email-everyone-preview"
          className="mc-scroll mb-2 max-h-[380px] min-h-[220px] overflow-y-auto rounded border border-hairline2 bg-white p-3"
        >
          {previewError ? (
            <p className="text-sm text-red-600">{previewError}</p>
          ) : !markdown.trim() ? (
            <p className="text-sm text-faint">Nothing to preview yet.</p>
          ) : preview === null ? (
            <p className="text-sm text-faint">Rendering…</p>
          ) : (
            // The server has already sanitized this — it is the literal
            // document the recipients receive, and rendering anything else
            // here would defeat the point of the tab.
            <div dangerouslySetInnerHTML={{ __html: preview }} />
          )}
        </div>
      )}

      {/* A textarea cannot render a picture, so the Write tab shows a URL where
          the author expected their screenshot. This is where they see it. */}
      {tab === 'write' && pastedImageUrls(markdown).length > 0 && (
        <div className="mb-2" data-testid="email-everyone-images">
          <p className="mb-1 text-[11px] font-bold tracking-wide text-muted uppercase">Images in this email</p>
          <div className="flex flex-wrap gap-2">
            {pastedImageUrls(markdown).map((url) => (
              // `contain`, not `cover`: a wide screenshot cropped square shows
              // its middle and nothing identifying.
              <img
                key={url}
                src={url}
                alt=""
                className="h-14 w-auto max-w-[140px] rounded border border-hairline2 bg-daypill/40 object-contain"
              />
            ))}
          </div>
        </div>
      )}

      <p className="mb-3 text-[11px] text-faint">
        {tab === 'write'
          ? 'Markdown: # headings · **bold** · *italic* · [links](url) · paste an image to add it'
          : 'Preview = the exact sanitized HTML recipients get.'}
      </p>

      {uploading > 0 && (
        <p className="mb-2 flex items-center gap-2 text-sm text-muted" data-testid="email-everyone-uploading">
          <span
            aria-hidden
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-hairline2 border-t-accent"
          />
          {uploading === 1 ? 'Uploading image…' : `Uploading ${uploading} images…`}
        </p>
      )}
      {pasteError && (
        <p className="mb-2 text-sm text-red-600" data-testid="email-everyone-paste-error">
          {pasteError}
        </p>
      )}

      {error && <p className="mb-2 text-sm text-red-600" data-testid="email-everyone-error">{error}</p>}
      {testResult && (
        <p
          data-testid="email-everyone-test-result"
          className={`mb-2 text-sm ${testResult.sent > 0 ? 'text-emerald-700' : 'text-red-600'}`}
        >
          {testResultText(testResult, selfEmail)}
        </p>
      )}

      {confirming ? (
        <div ref={confirmRef}>
          <ConfirmStep
            count={count}
            workspaceName={workspaceName}
            previewHtml={preview}
            sending={sending}
            testing={testing}
            onBack={() => setConfirming(false)}
            onSend={() => void send()}
            onSendTest={() => void sendTest()}
          />
        </div>
      ) : (
        <ComposeActions ready={ready} onCancel={onClose} onReview={() => setConfirming(true)} />
      )}
    </Modal>
  );
}

/**
 * The compose step's actions. The primary button only opens the confirm step,
 * so it is worded as one (#486): it used to read "Send to 48 people", which
 * describes what the *next* button does and made admins afraid to click it.
 */
export function ComposeActions({
  ready,
  onCancel,
  onReview,
}: {
  ready: boolean;
  onCancel: () => void;
  onReview: () => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onCancel}>Cancel</button>
      <button
        data-testid="email-everyone-send"
        className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        disabled={!ready}
        onClick={onReview}
      >
        Review &amp; send
      </button>
    </div>
  );
}

/**
 * The confirm step (#481) and its test-send escape hatch (#484). Split out so
 * it can be rendered directly in a test: the step is only reachable through
 * internal state, and the guarantee worth pinning — that the safe button is
 * there and the destructive one is still the primary — is presentational.
 *
 * It now shows the mail itself (#492). "Review & send" promised a review and
 * gave you a sentence about the recipient count; with images in the body, the
 * last look before an unsendable send has to be at the actual document — the
 * same server-rendered HTML the Preview tab shows, and the same one that ships.
 */
export function ConfirmStep({
  count,
  workspaceName,
  previewHtml,
  sending,
  testing,
  onBack,
  onSend,
  onSendTest,
}: {
  count: number | null;
  workspaceName?: string;
  /** Null while it is still being rendered by the server. */
  previewHtml?: string | null;
  sending: boolean;
  testing: boolean;
  onBack: () => void;
  onSend: () => void;
  onSendTest: () => void;
}) {
  const busy = sending || testing;
  return (
    <div className="rounded-lg border border-hairline2 bg-daypill/40 p-3" data-testid="email-everyone-confirm">
      <p className="mb-1 text-sm font-bold">Send this email?</p>
      <div
        data-testid="email-everyone-confirm-preview"
        className="mc-scroll mb-3 max-h-[220px] overflow-y-auto rounded border border-hairline2 bg-white p-3"
      >
        {previewHtml === null || previewHtml === undefined ? (
          <p className="text-sm text-faint">Rendering…</p>
        ) : (
          // Server-sanitized, and the literal document the recipients get.
          <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
        )}
      </div>
      <p className="mb-3 text-sm text-ink-soft">
        This will email {count === null ? 'everyone' : <strong>{peopleLabel(count)}</strong>} — every human member
        of {workspaceName ? <strong>{workspaceName}</strong> : 'this workspace'}. It can’t be unsent.
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Secondary, and pushed to the far left: the last thing under the
            cursor before "Send now" should be the safe one. */}
        <button
          data-testid="email-everyone-send-test"
          className="mr-auto rounded border border-hairline2 px-3 py-1.5 text-sm text-ink-soft disabled:opacity-50"
          disabled={busy}
          onClick={onSendTest}
        >
          {testing ? 'Sending test…' : 'Send test to me'}
        </button>
        <button
          className="rounded border border-hairline2 px-3 py-1.5 text-sm"
          disabled={busy}
          onClick={onBack}
        >
          Back
        </button>
        <button
          data-testid="email-everyone-confirm-send"
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy}
          onClick={onSend}
        >
          {sending ? 'Sending…' : 'Send now'}
        </button>
      </div>
    </div>
  );
}

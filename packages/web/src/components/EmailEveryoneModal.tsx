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
import type { WorkspaceEmailPreviewDTO, WorkspaceEmailResultDTO } from '@flow/shared';
import { api } from '../lib/api';
import { Modal } from './modals';

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;

/** `N people`, or `1 person` — used in the To chip, the button and the confirm. */
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
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const ready = subject.trim().length > 0 && markdown.trim().length > 0;

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

  // Preview is fetched on entering the tab, not on every keystroke: it is a
  // round trip, and it only has to be right at the moment someone looks.
  useEffect(() => {
    if (tab !== 'preview' || !markdown.trim()) return;
    let live = true;
    setPreviewError(null);
    api<WorkspaceEmailPreviewDTO>('POST', `/v1/workspaces/${workspaceId}/email/preview`, { markdown })
      .then((r) => { if (live) setPreview(r.html); })
      .catch((err) => {
        if (live) setPreviewError(err instanceof Error ? err.message : 'preview failed');
      });
    return () => { live = false; };
  }, [tab, markdown, workspaceId]);

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

  const sendLabel = count === null ? 'Send' : `Send to ${peopleLabel(count)}`;

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

      <p className="mb-3 text-[11px] text-faint">
        {tab === 'write'
          ? 'Markdown: # headings · **bold** · *italic* · [links](url) · ![images](url)'
          : 'Preview = the exact sanitized HTML recipients get.'}
      </p>

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
        <ConfirmStep
          count={count}
          workspaceName={workspaceName}
          sending={sending}
          testing={testing}
          onBack={() => setConfirming(false)}
          onSend={() => void send()}
          onSendTest={() => void sendTest()}
        />
      ) : (
        <div className="flex justify-end gap-2">
          <button className="px-3 py-1.5 text-sm text-ink-soft" onClick={onClose}>Cancel</button>
          <button
            data-testid="email-everyone-send"
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!ready}
            onClick={() => setConfirming(true)}
          >
            {sendLabel}
          </button>
        </div>
      )}
    </Modal>
  );
}

/**
 * The confirm step (#481) and its test-send escape hatch (#484). Split out so
 * it can be rendered directly in a test: the step is only reachable through
 * internal state, and the guarantee worth pinning — that the safe button is
 * there and the destructive one is still the primary — is presentational.
 */
export function ConfirmStep({
  count,
  workspaceName,
  sending,
  testing,
  onBack,
  onSend,
  onSendTest,
}: {
  count: number | null;
  workspaceName?: string;
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

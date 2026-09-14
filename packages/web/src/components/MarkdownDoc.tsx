// Rendered markdown documents (#569) — the body shared by the artifact side
// panel and the chat attachment card, so a `.md` file reads the same wherever
// you open it.
//
// The renderer is the message pipeline (`renderBlocks`): headings, lists,
// tables, fenced code, mermaid and inline markdown all behave exactly as they
// do in a message, because it IS the message code. Only the container differs
// — a document gets a `<pre>`-free prose column with real padding instead of a
// chat row's inline flow.
import type { ReactNode } from 'react';
import { renderBlocks } from '../lib/format';

/** Chars rendered before we stop. A document viewer is roomier than the chat
 * preview, but the block parser is O(n) over every line and mermaid fences can
 * each spawn a frame — an unbounded file would hang the tab. */
export const MARKDOWN_MAX = 1_000_000;

export function truncateMarkdown(text: string): { shown: string; truncated: boolean } {
  return text.length > MARKDOWN_MAX
    ? { shown: text.slice(0, MARKDOWN_MAX), truncated: true }
    : { shown: text, truncated: false };
}

/**
 * The document body in one of its two states.
 *
 * `source` shows the raw markdown in the same monospace block a `.txt` file
 * gets — that is the "View source" half of the toggle, and it is what makes
 * the rendered view safe to prefer: nothing is hidden, it is one click away.
 */
export function MarkdownDocBody({
  text,
  names,
  currentUserId,
  source,
  dense = false,
  testId,
}: {
  text: string;
  names: Record<string, string>;
  currentUserId: string | undefined;
  source: boolean;
  /** Chat-card spacing instead of the side panel's document margins. */
  dense?: boolean;
  testId: string;
}): ReactNode {
  const { shown, truncated } = truncateMarkdown(text);
  const pad = dense ? 'px-3 py-2' : 'px-[22px] py-4';
  return (
    <>
      {source ? (
        <pre
          data-testid={`${testId}-source`}
          className={`${pad} font-mono ${dense ? 'text-[11px] leading-4' : 'text-xs leading-5'} whitespace-pre text-ink`}
        >
          {shown}
        </pre>
      ) : (
        <div
          data-testid={testId}
          className={`markdown-doc ${pad} ${dense ? 'text-[13px]' : 'text-sm'} leading-normal break-words whitespace-pre-wrap text-ink`}
        >
          {renderBlocks(shown, names, currentUserId)}
        </div>
      )}
      {truncated && (
        <p className={`${dense ? 'px-3 pb-2' : 'px-[22px] pb-4'} text-xs text-faint`}>
          Showing the first 1 MB — download for the full file.
        </p>
      )}
    </>
  );
}

/** The View source ⇄ Rendered switch. Same control in both call sites so the
 * affordance is in the same place whichever surface you opened the file from. */
export function SourceToggle({
  source,
  onToggle,
  testId,
}: {
  source: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-accent-soft hover:bg-daypill"
      title={source ? 'Show the rendered document' : 'Show the raw markdown'}
      onClick={onToggle}
    >
      {source ? 'Rendered' : 'View source'}
    </button>
  );
}

// A fenced code block in a message body, with a copy button (#260).
//
// The block's raw text is the only thing a reader cannot get at by other
// means: selecting it by hand is fiddly on a trackpad and near impossible on
// a phone, and the strings that end up in code blocks — a signup URL, a token
// — are exactly the ones a typo ruins. So the button is always visible rather
// than hover-revealed: touch clients have no hover, and the report behind this
// was about discoverability.
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the checkmark stays up after a successful copy. */
const COPIED_MS = 1500;

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

/**
 * Copies `text`, then shows a checkmark for a moment. Shared by the code block
 * and anywhere else a raw body wants the same affordance.
 *
 * `navigator.clipboard` is absent over plain http on a non-localhost origin and
 * the write can be rejected outright, so a failure leaves the icon alone rather
 * than claiming a copy that did not happen.
 */
export function CopyButton({ text, testId = 'code-copy' }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A block that unmounts mid-flash (message edited, channel switched) must not
  // leave a timer holding a setState on a gone component.
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => {});
  }, [text]);

  return (
    <button
      type="button"
      data-testid={testId}
      title={copied ? 'Copied' : 'Copy code'}
      aria-label={copied ? 'Copied' : 'Copy code'}
      onClick={onCopy}
      className={`rounded p-1 transition-colors ${
        copied ? 'text-accent' : 'text-muted hover:bg-daypill hover:text-ink-soft'
      }`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/**
 * `<pre><code>` plus the copy button, pinned bottom-right.
 *
 * Bottom rather than top, which is where a copy button normally goes: the
 * message row's hover menu is `absolute top-0`, so it lands on the *top*-right
 * of the first block in a message — and its rightmost control is Delete. A
 * button you reach for by hovering cannot sit under the toolbar that hovering
 * summons. The bottom corner is the only one nothing else claims.
 *
 * The button sits in a wrapper rather than inside the `<pre>`: the block scrolls
 * horizontally, and a child of the scroller would slide away from the corner
 * with the code. The `<pre>`'s wider right padding keeps the code out from
 * under it.
 */
export function CodeBlock({ source }: { source: string }) {
  return (
    <div className="relative my-1 max-w-full" data-testid="code-block-wrap">
      <pre
        data-testid="code-block"
        className="max-w-full overflow-x-auto rounded-lg bg-[#f4f2ee] py-2 pr-10 pl-3 font-mono text-[13px] leading-relaxed whitespace-pre"
      >
        <code>{source}</code>
      </pre>
      <div className="absolute right-1 bottom-1 rounded bg-[#f4f2ee]">
        <CopyButton text={source} />
      </div>
    </div>
  );
}

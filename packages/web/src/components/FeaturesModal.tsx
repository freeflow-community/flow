import { useEffect, useState } from 'react';
import { renderBlocks } from '../lib/format';

/** Fold soft-wrapped source lines back together: an indented continuation line
 * (FEATURES.md wraps long bullets at ~80 cols) joins the previous line, so the
 * block renderer sees one `- …` per bullet instead of a stray paragraph. */
export function unwrap(md: string): string {
  const out: string[] = [];
  for (const line of md.split('\n')) {
    if (/^\s+\S/.test(line) && out.length > 0 && out[out.length - 1]!.trim() !== '') {
      out[out.length - 1] += ' ' + line.trim();
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/** "What's new" lightbox — fetches the static FEATURES.md (copied into
 * web/public at build time) and renders it with the shared block-markdown
 * renderer. Opened from the "Build …" label at the foot of the workspace menu. */
export function FeaturesModal({ onClose }: { onClose: () => void }) {
  const [md, setMd] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    fetch('/FEATURES.md')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setMd(t))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        data-testid="features-modal"
        className="flex max-h-[calc(100dvh-2rem)] w-[min(720px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-white text-ink shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <h2 className="text-base font-bold">What&apos;s new</h2>
          <button
            className="rounded-md px-2 py-1 text-lg leading-none text-ink/50 hover:bg-daypill"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap">
          {failed ? (
            <p className="text-ink/40">Release notes aren&apos;t available.</p>
          ) : md === null ? (
            <p className="text-ink/40">Loading…</p>
          ) : (
            renderBlocks(unwrap(md), {}, undefined)
          )}
        </div>
      </div>
    </div>
  );
}

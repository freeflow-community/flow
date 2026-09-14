// Pasting images into the community email composer (#492).
//
// The composer's body is a markdown textarea, so a pasted image has to become
// markdown — which means the interesting logic is a string edit, and all of it
// lives here as pure functions. The component keeps the async parts (upload,
// adopt, setState); everything a test would want to pin down about *where the
// text lands* is decidable without a render.
//
// The placeholder is itself valid-looking markdown with a scheme no browser or
// mail client will follow, so a half-finished upload that somehow got sent
// would degrade to a dropped image rather than a broken one — the renderer
// discards any <img> whose src isn't absolute http(s).

/** The `src` of a not-yet-uploaded image. `n` makes concurrent pastes
 * addressable: two screenshots pasted a second apart must not race to replace
 * each other's placeholder. */
export function uploadPlaceholder(n: number): string {
  return `![Uploading image…](flow-upload:${n})`;
}

/** Image files on the clipboard, in clipboard order. Empty for a plain-text
 * paste, which is what keeps that path completely untouched. */
export function imagesFromClipboard(data: DataTransfer): File[] {
  return Array.from(data.items)
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => f !== null);
}

/** Markdown needs a blank line before a block-level image, and a screenshot
 * glued onto the end of the word you were typing is never what a paste meant. */
function gapBefore(head: string): string {
  if (head.length === 0 || head.endsWith('\n\n')) return '';
  return head.endsWith('\n') ? '\n' : '\n\n';
}

function gapAfter(tail: string): string {
  if (tail.length === 0 || tail.startsWith('\n\n')) return '';
  return tail.startsWith('\n') ? '\n' : '\n\n';
}

/**
 * Where a paste carrying images lands in the body.
 *
 * `text` is whatever the clipboard also held, spliced in exactly where the
 * default paste would have put it — that is the whole of "mixed content keeps
 * the text behaviour unchanged". The placeholders then follow, each on its own
 * line. Returns the new value and where to leave the caret.
 */
export function applyImagePaste(args: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  text: string;
  placeholders: string[];
}): { value: string; caret: number } {
  const { value, selectionStart, selectionEnd, text, placeholders } = args;
  const head = value.slice(0, selectionStart);
  const tail = value.slice(selectionEnd);

  let insert = text;
  for (const p of placeholders) {
    insert += `${gapBefore(head + insert)}${p}`;
  }
  if (placeholders.length > 0) insert += gapAfter(tail);

  return { value: head + insert + tail, caret: head.length + insert.length };
}

/** Swap a finished upload's placeholder for the real image. */
export function replaceUploadPlaceholder(value: string, n: number, markdown: string): string {
  return value.replace(uploadPlaceholder(n), markdown);
}

/**
 * Take a failed upload's placeholder back out, along with the blank line it
 * was sitting on — leaving a hole where an image never arrived would make the
 * body look like it lost a paragraph.
 */
export function removeUploadPlaceholder(value: string, n: number): string {
  return value.replace(uploadPlaceholder(n), '').replace(/\n{3,}/g, '\n\n');
}

/** The markdown a finished upload becomes. */
export function pastedImageMarkdown(url: string): string {
  return `![Pasted image](${url})`;
}

/**
 * The pasted images currently in the body, in order, deduplicated.
 *
 * A textarea cannot render a picture, so the Write tab shows the markdown —
 * which means a 60-character URL where the author expected a screenshot. This
 * feeds a thumbnail strip under the editor so they can see *which* image
 * landed without leaving the tab.
 *
 * Deliberately matched against our own email-image route rather than any image
 * markdown: an arbitrary remote URL in the strip would have the composer fetch
 * a stranger's server (a tracking pixel, at worst) just for typing a link.
 */
export function pastedImageUrls(markdown: string): string[] {
  const re = /!\[[^\]]*\]\((https?:\/\/[^\s)]+\/v1\/email-images\/[^\s)]+)\)/g;
  const seen = new Set<string>();
  for (const m of markdown.matchAll(re)) seen.add(m[1]!);
  return [...seen];
}

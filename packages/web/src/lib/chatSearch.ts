// Inline chat find (#518): the pure half of the find bar — substring matching
// and match-cursor arithmetic, with no DOM in sight so it can be tested in
// node. `lib/findHighlight.ts` is the DOM adapter that paints what this finds.
//
// Swift twin: apps/macos/Sources/Flow/Support/ChatSearch.swift — same rules,
// so "n of m" means the same thing on both clients.

/** A match as offsets into the haystack: `[start, end)`. */
export type MatchRange = { start: number; end: number };

/**
 * Case-folded copy of `s`, or `null` when folding would change its length.
 *
 * Offsets only survive folding while it is one-character-in, one-out — and a
 * few codepoints (Turkish `İ`, `ẞ` in some engines) lowercase to two. Rather
 * than return match offsets that point at the wrong characters, we say so and
 * let the caller fall back to a case-sensitive scan for that string.
 */
function fold(s: string): string | null {
  const lower = s.toLowerCase();
  return lower.length === s.length ? lower : null;
}

/**
 * Every non-overlapping, case-insensitive occurrence of `query` in `haystack`,
 * in order. An empty query matches nothing (a find bar you have not typed into
 * yet should highlight nothing, not everything).
 */
export function matchRanges(haystack: string, query: string): MatchRange[] {
  if (!query || !haystack) return [];
  const foldedHay = fold(haystack);
  const foldedQuery = fold(query);
  // Either side unfoldable → compare the originals, case-sensitively. Rare
  // enough to be invisible, and it never mislocates a highlight.
  const hay = foldedHay !== null && foldedQuery !== null ? foldedHay : haystack;
  const needle = foldedHay !== null && foldedQuery !== null ? foldedQuery : query;

  const out: MatchRange[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return out;
    out.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
}

/**
 * Where the match cursor lands after `dir` steps from `current`, wrapping at
 * both ends (AC 3). With nothing to step through it stays at -1, which is what
 * "0 of 0" renders from and what makes Enter a no-op (AC 6).
 */
export function stepIndex(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : total - 1;
  return (current + dir + total) % total;
}

/**
 * The bar's counter: 1-based position, or "0 of 0" with nothing found.
 * Clamped, because the transcript can grow (or an older page can land)
 * between a cursor move and the next render.
 */
export function matchLabel(current: number, total: number): string {
  if (total === 0) return '0/0';
  return `${Math.min(Math.max(current, 0), total - 1) + 1}/${total}`;
}

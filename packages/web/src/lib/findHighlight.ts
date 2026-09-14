// Inline chat find (#518): the DOM half — turning a query into live Ranges
// over the transcript, and painting them without touching the DOM.
//
// Highlighting goes through the CSS Custom Highlight API (`CSS.highlights` +
// `::highlight()` in index.css) rather than wrapping matches in <mark>. React
// owns every node in the message list; splicing wrappers into text it manages
// survives exactly until the next render of that row (an edit, a reaction, a
// streaming agent reply) and then either vanishes or strands the update on a
// detached text node. A Highlight is painted by the engine over Ranges we hold
// on the side, so the row keeps rendering normally underneath.
//
// Scope: only text inside `[data-search-body]` (the message body) counts, and
// `[data-search-skip]` subtrees inside it are excluded — so a search never
// matches the "(edited)" marker or a code block's copy button.
import { matchRanges } from './chatSearch';

/** A found match: the range to paint, and the element to scroll to. */
export type FoundMatch = { range: Range; element: Element };

const ALL = 'flow-find';
const CURRENT = 'flow-find-current';

/** Minimal shape of the CSS Custom Highlight API — TS's lib.dom predates it. */
type HighlightRegistry = {
  set(name: string, highlight: object): void;
  delete(name: string): void;
};
type HighlightCtor = new (...ranges: Range[]) => object;

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const ctor = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  return css?.highlights && ctor ? css.highlights : null;
}

/** The text nodes under `root`, in document order, minus skipped subtrees. */
function bodyTextNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return (node as Element).hasAttribute?.('data-search-skip')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/**
 * Every match of `query` in the loaded transcript under `root`, in reading
 * order. Nothing is fetched and nothing is read outside the DOM, which is what
 * makes the search "loaded messages only" (AC 2) by construction.
 *
 * A message body is searched as one string, so a match may span the element
 * boundaries the inline renderer leaves behind (a mention pill, a `code` chip),
 * exactly as the eye reads it.
 */
export function collectMatches(root: ParentNode, query: string): FoundMatch[] {
  if (!query) return [];
  const out: FoundMatch[] = [];
  for (const body of root.querySelectorAll('[data-search-body]')) {
    const nodes = bodyTextNodes(body);
    if (nodes.length === 0) continue;
    const text = nodes.map((n) => n.data).join('');
    const ranges = matchRanges(text, query);
    if (ranges.length === 0) continue;

    // Offset → (text node, offset within it). One walk per body, shared by all
    // of its matches, so a long message with many hits stays linear.
    let nodeIndex = 0;
    let consumed = 0; // characters before nodes[nodeIndex]
    const locate = (offset: number): [Text, number] => {
      while (nodeIndex < nodes.length - 1 && offset >= consumed + nodes[nodeIndex]!.data.length) {
        consumed += nodes[nodeIndex]!.data.length;
        nodeIndex++;
      }
      return [nodes[nodeIndex]!, offset - consumed];
    };

    for (const m of ranges) {
      const range = document.createRange();
      const [startNode, startOffset] = locate(m.start);
      range.setStart(startNode, startOffset);
      const [endNode, endOffset] = locate(m.end);
      range.setEnd(endNode, endOffset);
      out.push({ range, element: startNode.parentElement ?? body });
    }
  }
  return out;
}

/**
 * Paint `matches`, with the one at `current` in the stronger colour (AC 4).
 * A no-op where the browser has no Highlight API — the counter and the
 * scroll-to-match still work, so the bar degrades rather than breaks.
 */
export function paintHighlights(matches: FoundMatch[], current: number): void {
  const highlights = registry();
  if (!highlights) return;
  const Ctor = (globalThis as unknown as { Highlight: HighlightCtor }).Highlight;
  const others = matches.filter((_, i) => i !== current).map((m) => m.range);
  const cursor = matches[current];
  if (others.length > 0) highlights.set(ALL, new Ctor(...others));
  else highlights.delete(ALL);
  if (cursor) highlights.set(CURRENT, new Ctor(cursor.range));
  else highlights.delete(CURRENT);
}

/** Remove every highlight this module painted (AC 5). */
export function clearHighlights(): void {
  const highlights = registry();
  if (!highlights) return;
  highlights.delete(ALL);
  highlights.delete(CURRENT);
}

// DOM plumbing for the contenteditable composer (phase 3.5 item 2).
//
// Text model: the draft is a plain string with "\n" newlines. Canonical DOM:
// one <div> per line directly under the editor (a lone <br> stands in for an
// empty line), classed by block kind so ">" quote lines and ``` code regions
// style live as you type.
//
// Caret strategy: decorate() first checks whether the DOM still matches the
// canonical shape (it does after ordinary typing, since Chrome edits the
// line's text node in place). In that case only line classNames are updated —
// the selection is never touched. Only when native editing broke the shape
// (line merge on backspace, cross-line deletion, stray <br>) do we rebuild,
// bracketed by an absolute-character-offset save/restore of the caret.
import { classifyLines } from './format';
import type { LineKind } from './format';

/** Serialize the editor DOM to the "\n"-joined draft string. */
export function domToText(root: Node): string {
  let out = '';
  let started = false;
  const walk = (parent: Node): void => {
    parent.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += (node as Text).data;
        started = true;
      } else if (node.nodeName === 'BR') {
        if (!isPlaceholderBr(node)) out += '\n';
        started = true;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (isBlock(node)) {
          if (started) out += '\n';
          started = true;
        }
        walk(node);
      }
    });
  };
  walk(root);
  return out;
}

function isBlock(node: Node): boolean {
  return node.nodeName === 'DIV' || node.nodeName === 'P';
}

/** A <br> that is the last child of a block is Chrome's empty-line placeholder, not a break. */
function isPlaceholderBr(node: Node): boolean {
  return node.nextSibling === null && node.parentNode !== null && isBlock(node.parentNode);
}

/** [start, end] character offsets of the current selection within the editor, or null. */
export function getSelectionOffsets(el: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  return [
    textOffsetOf(el, range.startContainer, range.startOffset),
    textOffsetOf(el, range.endContainer, range.endOffset),
  ];
}

/** Character offset of a (container, offset) DOM position, mirroring domToText's emission rules. */
function textOffsetOf(el: HTMLElement, container: Node, offset: number): number {
  let len = 0;
  let started = false;
  let done = false;
  const walk = (parent: Node): void => {
    const kids = parent.childNodes;
    for (let i = 0; i < kids.length && !done; i++) {
      if (parent === container && container.nodeType !== Node.TEXT_NODE && i === offset) {
        done = true;
        return;
      }
      const node = kids[i]!;
      if (node.nodeType === Node.TEXT_NODE) {
        const data = (node as Text).data;
        if (node === container) {
          len += Math.min(offset, data.length);
          done = true;
          return;
        }
        len += data.length;
        started = true;
      } else if (node.nodeName === 'BR') {
        if (!isPlaceholderBr(node)) len += 1;
        started = true;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (isBlock(node)) {
          if (started) len += 1;
          started = true;
        }
        walk(node);
      }
    }
    if (!done && parent === container) done = true;
  };
  walk(el);
  return len;
}

/** Place a collapsed caret at a character offset. Assumes the canonical line-div structure. */
export function setCaretAt(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(el, 0);
  let remaining = offset;
  let placed = false;
  for (let i = 0; i < el.children.length && !placed; i++) {
    if (i > 0) remaining -= 1; // the "\n" between line divs
    const line = el.children[i]!;
    const first = line.firstChild;
    const textNode = first && first.nodeType === Node.TEXT_NODE ? (first as Text) : null;
    const lineLen = textNode ? textNode.data.length : 0;
    if (remaining <= lineLen) {
      if (textNode) range.setStart(textNode, Math.max(0, remaining));
      else range.setStart(line, 0);
      placed = true;
    } else {
      remaining -= lineLen;
    }
  }
  if (!placed && el.lastElementChild) {
    range.selectNodeContents(el.lastElementChild);
    range.collapse(false);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Per-line class strings for the live block styling. */
function lineClasses(kinds: LineKind[]): string[] {
  const out = kinds.map((k) => {
    if (k === 'quote') return 'cmp-quote';
    if (k === 'fence') return 'cmp-code cmp-fence';
    if (k === 'code') return 'cmp-code';
    return '';
  });
  for (let i = 0; i < out.length; i++) {
    if (!out[i]!.includes('cmp-code')) continue;
    if (i === 0 || !out[i - 1]!.includes('cmp-code')) out[i] += ' cmp-code-start';
    if (i === out.length - 1 || !out[i + 1]!.includes('cmp-code')) out[i] += ' cmp-code-end';
  }
  return out;
}

/** True when the DOM is exactly the canonical structure for `lines`. */
function isCanonical(el: HTMLElement, lines: string[]): boolean {
  if (el.childNodes.length !== lines.length || el.children.length !== lines.length) return false;
  for (let i = 0; i < lines.length; i++) {
    const line = el.children[i]!;
    if (line.tagName !== 'DIV') return false;
    const kids = line.childNodes;
    if (kids.length !== 1) return false;
    const only = kids[0]!;
    if (lines[i] === '') {
      if (only.nodeName !== 'BR') return false;
    } else {
      if (only.nodeType !== Node.TEXT_NODE || (only as Text).data !== lines[i]) return false;
    }
  }
  return true;
}

function rebuildLines(el: HTMLElement, lines: string[], classes: string[]): void {
  el.textContent = '';
  lines.forEach((line, i) => {
    const div = document.createElement('div');
    const cls = classes[i]!;
    if (cls) div.className = cls;
    if (line === '') div.appendChild(document.createElement('br'));
    else div.textContent = line;
    el.appendChild(div);
  });
}

/** Force the canonical structure for `value` (used for programmatic draft changes). */
export function rebuild(el: HTMLElement, value: string): void {
  if (value === '') {
    el.textContent = '';
    return;
  }
  const lines = value.split('\n');
  rebuildLines(el, lines, lineClasses(classifyLines(lines)));
}

/**
 * Bring styling in line with `value` after an input event. Class-only updates
 * when the structure is canonical (no caret impact); otherwise rebuild with
 * offset-based caret restore.
 */
export function decorate(el: HTMLElement, value: string): void {
  if (value === '') {
    if (el.firstChild) el.textContent = '';
    return;
  }
  const lines = value.split('\n');
  const classes = lineClasses(classifyLines(lines));
  if (isCanonical(el, lines)) {
    for (let i = 0; i < el.children.length; i++) {
      const line = el.children[i]!;
      const want = classes[i]!;
      if (line.className !== want) line.className = want;
    }
    return;
  }
  const focused = document.activeElement === el;
  const caret = focused ? getSelectionOffsets(el) : null;
  rebuildLines(el, lines, classes);
  if (focused) setCaretAt(el, caret ? caret[1] : value.length);
}

// Body rendering (mention pills + block-level markdown) and outgoing
// transforms — the web twin of the macOS MentionRendering/prepareOutgoing pair.
//
// Phase 3.5 item 2: bodies stay literal markdown on the wire; ``` fenced code
// and ">" quote lines gain block styling at render time, and outgoing sugar
// (shortcodes, mentions) is not expanded inside fenced code regions.
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { WorkspaceMemberDTO } from '@flow/shared';
import { expandShortcodes } from '@flow/shared';

const TOKEN_RE = /<@([0-9a-fA-F-]{36})>|<!(channel|here|everyone)>/g;

// Inline markdown (agent replies lean on it heavily): `code`, **bold**,
// *italic* / _italic_, ~~strike~~, [label](url), bare URLs. Code spans win
// over everything inside them; emphasis requires non-space at both edges so
// "2 * 3 * 4" and snake_case stay literal. Applied to plain/quote segments
// only — fenced code blocks never get here.
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*(?=\S)(?:[^*\n]|\*(?!\*))+?(?<=\S)\*\*)|(\*(?!\*)(?=\S)[^*\n]+?(?<=\S)\*)|((?<![\w`])_(?=\S)[^_\n]+?(?<=\S)_(?![\w`]))|(~~(?=\S)[^~\n]+?(?<=\S)~~)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}i${key++}`;
    if (m[1] !== undefined) {
      out.push(
        <code key={k} className="rounded bg-[#f4f2ee] px-1 py-px font-mono text-[0.92em] text-[#c2544a]">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2] !== undefined) {
      out.push(<strong key={k}>{renderInline(m[2].slice(2, -2), k)}</strong>);
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const inner = (m[3] ?? m[4])!.slice(1, -1);
      out.push(<em key={k}>{renderInline(inner, k)}</em>);
    } else if (m[5] !== undefined) {
      out.push(<s key={k}>{renderInline(m[5].slice(2, -2), k)}</s>);
    } else if (m[6] !== undefined && m[7] !== undefined) {
      out.push(
        <a key={k} href={m[7]} target="_blank" rel="noreferrer noopener" className="text-accent-deep underline">
          {m[6]}
        </a>,
      );
    } else if (m[8] !== undefined) {
      out.push(
        <a key={k} href={m[8]} target="_blank" rel="noreferrer noopener" className="text-accent-deep underline">
          {m[8]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Stored tokens → React nodes with pills; inline markdown on the text runs between them. */
export function renderBody(
  body: string,
  names: Record<string, string>,
  currentUserId: string | undefined,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    if (m.index > last) out.push(...renderInline(body.slice(last, m.index), `t${key}`));
    const strong = m[2] !== undefined || m[1] === currentUserId;
    const label = m[2] !== undefined ? `@${m[2]}` : `@${names[m[1]!] ?? 'someone'}`;
    out.push(
      <span
        key={`m${key++}`}
        data-mention={m[2] ?? m[1]}
        className={
          strong
            ? 'rounded bg-accent px-1 font-semibold text-white'
            : 'rounded bg-accent/15 px-1 font-semibold text-accent-deep'
        }
      >
        {label}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(...renderInline(body.slice(last), `t${key}`));
  return out;
}

/** Line-level block kinds. A ``` line toggles a code region; ">" only counts outside code. */
export type LineKind = 'plain' | 'quote' | 'fence' | 'code';

export function classifyLines(lines: string[]): LineKind[] {
  let inCode = false;
  return lines.map((line) => {
    if (line.startsWith('```')) {
      inCode = !inCode;
      return 'fence';
    }
    if (inCode) return 'code';
    return line.startsWith('>') ? 'quote' : 'plain';
  });
}

export type BodySegment =
  | { kind: 'code'; content: string } // fence marker lines stripped
  | { kind: 'quote'; content: string } // leading "> " stripped per line
  | { kind: 'plain'; content: string };

/** Split a body into fenced code blocks, runs of quote lines, and plain paragraphs. */
export function segmentBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.startsWith('```')) {
      const content: string[] = [];
      i++; // opening fence
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        content.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // closing fence
      segments.push({ kind: 'code', content: content.join('\n') });
    } else if (lines[i]!.startsWith('>')) {
      const content: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        content.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      segments.push({ kind: 'quote', content: content.join('\n') });
    } else {
      const content: string[] = [];
      while (i < lines.length && !lines[i]!.startsWith('```') && !lines[i]!.startsWith('>')) {
        content.push(lines[i]!);
        i++;
      }
      segments.push({ kind: 'plain', content: content.join('\n') });
    }
  }
  return segments;
}

/**
 * Block-level body renderer: code → <pre><code> (no mention pills, fences
 * hidden), quote runs → styled <blockquote> with inline content through
 * renderBody, plain text unchanged through renderBody. Render inside a
 * whitespace-pre-wrap container.
 */
export function renderBlocks(
  body: string,
  names: Record<string, string>,
  currentUserId: string | undefined,
): ReactNode[] {
  return segmentBody(body).map((seg, i): ReactNode => {
    if (seg.kind === 'code') {
      return (
        <pre
          key={`b${i}`}
          data-testid="code-block"
          className="my-1 max-w-full overflow-x-auto rounded-lg bg-[#f4f2ee] px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre"
        >
          <code>{seg.content}</code>
        </pre>
      );
    }
    if (seg.kind === 'quote') {
      return (
        <blockquote
          key={`b${i}`}
          data-testid="quote-block"
          className="my-1 border-l-[3px] border-accent bg-accent/5 py-0.5 pr-2 pl-2.5 text-ink-soft"
        >
          {renderBody(seg.content, names, currentUserId)}
        </blockquote>
      );
    }
    return <Fragment key={`b${i}`}>{renderBody(seg.content, names, currentUserId)}</Fragment>;
  });
}

/** Token-free plain text (notification previews, browser banners). Fence marker lines are dropped. */
export function plainBody(body: string, names: Record<string, string>): string {
  const visible = body
    .split('\n')
    .filter((line) => !line.startsWith('```'))
    .join('\n');
  return visible.replace(TOKEN_RE, (_all, id?: string, group?: string) =>
    group !== undefined ? `@${group}` : `@${names[id!] ?? 'someone'}`,
  );
}

/**
 * Composer sugar → wire format: :shortcode: → unicode, @channel|here|everyone
 * → <!token>, @Display Name → <@id> (longest name first). Fenced code regions
 * (fence markers included) pass through untouched; quote lines still expand.
 * Returns resolved mention ids for the server to validate.
 */
export function transformOutgoing(
  text: string,
  members: WorkspaceMemberDTO[],
): { body: string; mentions: string[] } {
  const lines = text.split('\n');
  const kinds = classifyLines(lines);
  const mentions = new Set<string>();
  const out: string[] = [];
  let run: string[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    out.push(transformSegment(run.join('\n'), members, mentions));
    run = [];
  };
  lines.forEach((line, i) => {
    if (kinds[i] === 'fence' || kinds[i] === 'code') {
      flushRun();
      out.push(line);
    } else {
      run.push(line);
    }
  });
  flushRun();
  return { body: out.join('\n'), mentions: [...mentions] };
}

function transformSegment(text: string, members: WorkspaceMemberDTO[], mentions: Set<string>): string {
  let body = expandShortcodes(text);
  for (const token of ['channel', 'here', 'everyone']) {
    body = body.split(`@${token}`).join(`<!${token}>`);
  }
  const sorted = [...members].sort((a, b) => b.displayName.length - a.displayName.length);
  for (const m of sorted) {
    if (!m.displayName) continue;
    const needle = `@${m.displayName}`;
    if (body.includes(needle)) {
      body = body.split(needle).join(`<@${m.userId}>`);
      mentions.add(m.userId);
    }
  }
  return body;
}

export function displayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

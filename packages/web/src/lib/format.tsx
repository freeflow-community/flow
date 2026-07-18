// Body rendering (mention pills) and outgoing transforms — the web twin of the
// macOS MentionRendering/prepareOutgoing pair.
import type { ReactNode } from 'react';
import type { WorkspaceMemberDTO } from '@mychat/shared';
import { expandShortcodes } from '@mychat/shared';

const TOKEN_RE = /<@([0-9a-fA-F-]{36})>|<!(channel|here|everyone)>/g;

/** Stored tokens → React nodes with pills. Plain text otherwise (no markdown on web v1 beyond line breaks). */
export function renderBody(
  body: string,
  names: Record<string, string>,
  currentUserId: string | undefined,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    if (m.index > last) out.push(body.slice(last, m.index));
    const strong = m[2] !== undefined || m[1] === currentUserId;
    const label = m[2] !== undefined ? `@${m[2]}` : `@${names[m[1]!] ?? 'someone'}`;
    out.push(
      <span
        key={`m${key++}`}
        data-mention={m[2] ?? m[1]}
        className={
          strong
            ? 'rounded bg-blue-600 px-1 font-semibold text-white'
            : 'rounded bg-blue-100 px-1 font-semibold text-blue-700'
        }
      >
        {label}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

/** Token-free plain text (notification previews, browser banners). */
export function plainBody(body: string, names: Record<string, string>): string {
  return body.replace(TOKEN_RE, (_all, id?: string, group?: string) =>
    group !== undefined ? `@${group}` : `@${names[id!] ?? 'someone'}`,
  );
}

/**
 * Composer sugar → wire format: :shortcode: → unicode, @channel|here|everyone
 * → <!token>, @Display Name → <@id> (longest name first). Returns resolved
 * mention ids for the server to validate.
 */
export function transformOutgoing(
  text: string,
  members: WorkspaceMemberDTO[],
): { body: string; mentions: string[] } {
  let body = expandShortcodes(text);
  for (const token of ['channel', 'here', 'everyone']) {
    body = body.split(`@${token}`).join(`<!${token}>`);
  }
  const mentions: string[] = [];
  const sorted = [...members].sort((a, b) => b.displayName.length - a.displayName.length);
  for (const m of sorted) {
    if (!m.displayName) continue;
    const needle = `@${m.displayName}`;
    if (body.includes(needle)) {
      body = body.split(needle).join(`<@${m.userId}>`);
      mentions.push(m.userId);
    }
  }
  return { body, mentions };
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

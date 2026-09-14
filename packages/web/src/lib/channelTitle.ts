// How a channel names itself in a title: `#name` for a standard channel, the
// member display names for a DM or group DM. Lives in lib (rather than beside
// the sidebar that first needed it) because the thread panel now titles itself
// off the same rule (#417).
import type { ChannelDTO } from '@flow/shared';

export function dmTitle(c: ChannelDTO, names: Record<string, string>, me: string): string {
  const others = (c.memberIds ?? []).filter((id) => id !== me);
  if (others.length === 0) return `${names[me] ?? 'You'} (you)`; // persistent self-DM
  return others.map((id) => names[id] ?? 'Unknown').sort().join(', ');
}

/** The persistent "notes to self" DM — a `dm` channel whose only member is you.
 * It is the destination behind the Scheduled panel's "🔒 Just me" (#420). */
export function isSelfDm(c: ChannelDTO, me: string): boolean {
  return c.kind === 'dm' && (c.memberIds ?? []).every((id) => id === me);
}

/** The secondary half of a thread title: `in #channel` or `with <names>`. */
export type ThreadParent = { connector: 'in' | 'with'; name: string };

/**
 * What a thread's header says after the word "Thread" (#417): the parent
 * channel, so several open threads are told apart at a glance. Group DMs get
 * the same joined member names the sidebar shows them under.
 */
export function threadParentLabel(
  c: ChannelDTO | undefined,
  names: Record<string, string>,
  me: string,
): ThreadParent | null {
  if (!c) return null;
  if (c.kind === 'standard') return { connector: 'in', name: `#${c.name ?? ''}` };
  return { connector: 'with', name: dmTitle(c, names, me) };
}

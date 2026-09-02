// What a `huddle.invite` event means *for this device* (#436).
//
// One event type carries the whole ring lifecycle to everyone involved —
// caller and callees, every device of each — so the interesting logic is the
// reading, not the sending. Pulled out of the huddle controller as a pure
// function because it is the part with real cases in it: the same event has to
// raise a card on one phone, take it down on that person's laptop *with an
// explanation*, and tell the caller "still ringing" — decided only from the
// invite's status, this user's own target row, and which socket answered.
import type { HuddleInviteDTO } from '@flow/shared';

export type RingEffect =
  /** Not about us at all (a group DM we're in, an event for someone else's row). */
  | { kind: 'ignore' }
  /** Raise (or keep) the incoming-call card. */
  | { kind: 'ring'; invite: HuddleInviteDTO }
  /** Take the card down — this device answered, declined, or the call ended. */
  | { kind: 'dismiss' }
  /** Take the card down and say why: another of this user's devices answered. */
  | { kind: 'answered-elsewhere' }
  /** We are the caller: our own ring is still live, or it has resolved. */
  | { kind: 'outgoing'; invite: HuddleInviteDTO | null; unavailable: string[] };

export function ringEffect(
  invite: HuddleInviteDTO,
  opts: { selfId: string; mySessionId: string | null; answeredBySessionId?: string; unavailable?: string[] },
): RingEffect {
  if (invite.startedBy === opts.selfId) {
    return {
      kind: 'outgoing',
      invite: invite.status === 'ringing' ? invite : null,
      unavailable: opts.unavailable ?? [],
    };
  }
  const mine = invite.targets.find((t) => t.userId === opts.selfId);
  if (!mine) return { kind: 'ignore' };
  // Still ringing *for us*. In a group DM the invite flips to `active` on the
  // first accept while everyone else keeps ringing — late join is allowed —
  // so the card must key off our own row, not the call's.
  if (mine.status === 'ringing' && (invite.status === 'ringing' || invite.status === 'active')) {
    return { kind: 'ring', invite };
  }
  // Accepted, but not by the socket reading this: a sibling device answered.
  // Anything else — declined here, timed out, cancelled — is a plain dismissal.
  if (mine.status === 'accepted' && opts.answeredBySessionId !== opts.mySessionId) {
    return { kind: 'answered-elsewhere' };
  }
  return { kind: 'dismiss' };
}

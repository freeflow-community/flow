// Is the other side of a Huddle actually there (#508)?
//
// "Ringing" and "Missed huddle" cover the two ends of a call that never
// happened. Between them sat a silent screen: an agent that accepted the
// invite but whose audio never came up looks exactly like an agent sitting
// quietly. This is the rule that tells those apart, and — since the connect
// chime (#509) fires on the same edge — the one thing both the badge and the
// sound read.
//
// Mirrored by apps/macos/Sources/Flow/Support/HuddleConnection.swift, the same
// way huddleRing.ts is: three clients, one rule.

/** How the huddle's remote side reads right now. */
export type HuddleConnection =
  /** Nobody else is expected — a channel huddle you are sitting in alone. */
  | 'idle'
  /** Someone is on their way in: accepted the invite, or arrived silent. */
  | 'connecting'
  /** Someone is in the room and their audio path is up. */
  | 'connected';

/** One remote participant, as this rule reads them. */
export interface HuddlePeerState {
  userId: string;
  /** They have an audio track published to the room (muted or not). */
  audioLive: boolean;
  isAgent: boolean;
}

/**
 * A peer we can call connected.
 *
 * The asymmetry is deliberate: everyone joins muted, so a person with no audio
 * track has simply not unmuted — a choice, not a fault, and calling them
 * "connecting" forever would be a lie about a working call. An agent publishes
 * its output track as it joins, so an agent with no audio track is a call
 * whose voice path never came up, which is the whole thing #508 exists to make
 * visible.
 */
export function peerConnected(peer: HuddlePeerState): boolean {
  return peer.isAgent ? peer.audioLive : true;
}

/**
 * @param peers remote participants currently in the LiveKit room (never the
 *   local one — you are not waiting for yourself).
 * @param awaiting userIds that accepted an invite but are not in the room yet.
 */
export function huddleConnection(peers: HuddlePeerState[], awaiting: string[]): HuddleConnection {
  if (peers.some(peerConnected)) return 'connected';
  if (peers.length > 0 || awaiting.length > 0) return 'connecting';
  return 'idle';
}

/**
 * Should the connect chime sound (#509)?
 *
 * Once per call, not once per edge: a network blip that drops the peer's audio
 * and brings it back walks connected → connecting → connected, and a rule
 * written as "on the transition" would chime again each time. So the guard is
 * "have we chimed on this call yet", cleared only when the call ends.
 */
export function shouldChime(connection: HuddleConnection, alreadyChimed: boolean): boolean {
  return connection === 'connected' && !alreadyChimed;
}

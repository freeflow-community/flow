// The agent's live "thinking…" status row, and how a human stops the turn it
// belongs to (issue #67).
//
// The agent bridge posts one status message per in-flight turn and edits it per
// tool call, then hard-deletes it when the turn ends. Interrupting is a
// reaction on that row: the bridge matches the message id back to the run and
// kills it. A reaction rather than a new endpoint because every client can
// already send one — and the row *is* the turn, so there's nothing to address.

/** Prefix the bridge writes on its status rows (packages/agent-bridge). */
export const THINKING_PREFIX = '🤖 *thinking…*';

/** React with this to stop the turn. Must match the bridge's INTERRUPT_EMOJI. */
export const INTERRUPT_EMOJI = '🛑';

/** Is this message an agent's live status row rather than something it said? */
export function isThinkingStatus(body: string): boolean {
  return body.startsWith(THINKING_PREFIX);
}

import Foundation

/// The agent bridge's live "thinking…" status row, and how a human stops the
/// turn it belongs to (issue #67).
///
/// The bridge posts one status message per in-flight turn, edits it per tool
/// call, and hard-deletes it when the turn ends. Interrupting is a reaction on
/// that row: the bridge maps the message id back to the run and kills it. A
/// reaction rather than a new endpoint because every client can already send
/// one — and the row *is* the turn, so there is nothing to address.
///
/// Shared by macOS and iOS (both build `Support/`); the web client keeps the
/// same two constants in `packages/web/src/lib/agentStatus.ts`.
enum AgentStatus {
    /// Prefix the bridge writes on its status rows (packages/agent-bridge).
    static let thinkingPrefix = "🤖 *thinking…*"

    /// React with this to stop the turn. Must match the bridge's INTERRUPT_EMOJI.
    static let interruptEmoji = "🛑"

    /// Is this message an agent's live status row rather than something it said?
    static func isThinkingRow(_ body: String) -> Bool {
        body.hasPrefix(thinkingPrefix)
    }
}

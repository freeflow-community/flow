import XCTest

@testable import Flow

// #67: the Interrupt button only belongs on the bridge's live status row, and
// only the exact 🛑 codepoint reaches the bridge.
final class AgentStatusTests: XCTestCase {
    func testRecognisesTheStatusRowWithOrWithoutAStep() {
        XCTAssertTrue(AgentStatus.isThinkingRow("🤖 *thinking…* — Bash: pnpm test"))
        XCTAssertTrue(AgentStatus.isThinkingRow(AgentStatus.thinkingPrefix))
    }

    func testLeavesTheAgentsRealMessagesAlone() {
        XCTAssertFalse(AgentStatus.isThinkingRow("🤖 sorry — I hit an error (no output for 120s)."))
        XCTAssertFalse(AgentStatus.isThinkingRow("Here is what I found. I was thinking… about it."))
    }

    func testInterruptEmojiIsTheBareStopSign() {
        // The bridge matches this exact string; a variation selector or a
        // different glyph would make the button silently do nothing.
        XCTAssertEqual(AgentStatus.interruptEmoji, "\u{1F6D1}")
    }
}

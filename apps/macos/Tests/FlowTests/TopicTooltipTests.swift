import Foundation
import XCTest

@testable import Flow

/// The channel topic tooltip (#392). The rule worth pinning is the negative
/// case: a channel with no topic must produce no tooltip at all — `.help("")`
/// still arms one, so an empty string here would be an empty bubble on screen.
final class TopicTooltipTests: XCTestCase {
    func testKeepsARealTopic() {
        XCTAssertEqual(TopicTooltip.text("Release planning"), "Release planning")
    }

    func testNoTopicMeansNoTooltip() {
        XCTAssertNil(TopicTooltip.text(nil))
    }

    func testBlankTopicMeansNoTooltip() {
        // An empty topic clears to null server-side, but a whitespace-only one
        // could still reach a client.
        XCTAssertNil(TopicTooltip.text(""))
        XCTAssertNil(TopicTooltip.text("   \n\t "))
    }

    func testTrimsSoTheBubbleIsNotPaddedByWhitespace() {
        XCTAssertEqual(TopicTooltip.text("  standups  "), "standups")
    }

    func testKeepsALongTopicWhole() {
        // No truncation here — NSToolTip wraps it, which is the macOS
        // equivalent of the web client's 300pt wrap.
        let long = String(repeating: "a long topic that keeps going ", count: 10)
        XCTAssertEqual(TopicTooltip.text(long), long.trimmingCharacters(in: .whitespaces))
    }
}

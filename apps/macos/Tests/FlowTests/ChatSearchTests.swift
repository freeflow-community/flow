import Foundation
import XCTest

@testable import Flow

/// Inline chat find (#518). The twin of `packages/web/src/lib/chatSearch.test.ts`
/// plus the part only the native client has: what a row actually draws is what
/// gets searched, so the counter can never promise an invisible hit.
final class ChatSearchTests: XCTestCase {
    // MARK: - Matching

    func testFindsEveryOccurrenceCaseInsensitively() {
        let hay = "Deploy the deployer, then DEPLOY again"
        let found = ChatSearch.ranges(in: hay, query: "deploy").map { String(hay[$0]) }
        XCTAssertEqual(found, ["Deploy", "deploy", "DEPLOY"])
    }

    func testMatchesDoNotOverlap() {
        XCTAssertEqual(ChatSearch.ranges(in: "aaaa", query: "aa").count, 2)
    }

    func testEmptyQueryMatchesNothing() {
        XCTAssertEqual(ChatSearch.ranges(in: "anything at all", query: "").count, 0)
    }

    // MARK: - The match cursor

    func testCursorWrapsBothWays() {
        XCTAssertEqual(ChatSearch.step(current: 2, total: 3, direction: 1), 0)
        XCTAssertEqual(ChatSearch.step(current: 0, total: 3, direction: -1), 2)
    }

    func testCursorStartsAtFirstForwardAndLastBackward() {
        XCTAssertEqual(ChatSearch.step(current: -1, total: 3, direction: 1), 0)
        XCTAssertEqual(ChatSearch.step(current: -1, total: 3, direction: -1), 2)
    }

    func testCursorStaysPutWithNothingToStepThrough() {
        XCTAssertEqual(ChatSearch.step(current: -1, total: 0, direction: 1), -1)
        XCTAssertEqual(ChatSearch.step(current: -1, total: 0, direction: -1), -1)
    }

    func testLabelCountsFromOneAndSaysZeroOfZero() {
        XCTAssertEqual(ChatSearch.label(current: 0, total: 4), "1/4")
        XCTAssertEqual(ChatSearch.label(current: 3, total: 4), "4/4")
        XCTAssertEqual(ChatSearch.label(current: -1, total: 0), "0/0")
    }

    func testLabelClampsACursorLeftBehindByAShrinkingTranscript() {
        XCTAssertEqual(ChatSearch.label(current: 9, total: 3), "3/3")
    }

    // MARK: - Searching what the row draws

    @MainActor
    func testMentionTokensAreSearchedByTheirRenderedName() {
        let names = ["11111111-1111-1111-1111-111111111111": "Ada"]
        let segments = MarkdownBlocks.segments("hey <@11111111-1111-1111-1111-111111111111> ship it")
        XCTAssertEqual(ChatSearch.matchCount(segments: segments, names: names, query: "@Ada"), 1)
        // The raw token is never on screen, so it is never a match.
        XCTAssertEqual(ChatSearch.matchCount(segments: segments, names: names, query: "1111-1111"), 0)
    }

    @MainActor
    func testMarkdownSyntaxIsNotSearchable() {
        let segments = MarkdownBlocks.segments("the **release** is out")
        XCTAssertEqual(ChatSearch.matchCount(segments: segments, names: [:], query: "release"), 1)
        XCTAssertEqual(ChatSearch.matchCount(segments: segments, names: [:], query: "**release**"), 0)
    }

    @MainActor
    func testCodeBlocksAreSearchedVerbatim() {
        let segments = MarkdownBlocks.segments("```\nlet deploy = true\n```")
        XCTAssertEqual(ChatSearch.matchCount(segments: segments, names: [:], query: "deploy"), 1)
    }

    @MainActor
    func testBlocksThatCannotShowAHighlightAreNotCounted() {
        // A table renders through MarkdownTableView, which carries no
        // highlight — counting its text would put a number in the bar with
        // nothing on screen to match it.
        let segments = MarkdownBlocks.segments("| a | deploy |\n| --- | --- |\n| 1 | 2 |")
        XCTAssertEqual(ChatSearch.matchCount(segments: segments, names: [:], query: "deploy"), 0)
    }

    @MainActor
    func testSegmentBasesNumberMatchesInDrawOrder() {
        let segments = MarkdownBlocks.segments("deploy one\n\n- deploy two\n- deploy three\n\ntail deploy")
        let bases = ChatSearch.segmentBases(segments, names: [:], query: "deploy")
        XCTAssertEqual(bases.count, segments.count)
        // Paragraph (1 match) → list (2) → paragraph: the last block's first
        // match is the fourth in the message.
        XCTAssertEqual(bases.last, 3)
        XCTAssertEqual(ChatSearch.matchCount(segments: segments, names: [:], query: "deploy"), 4)
    }

    // MARK: - Painting

    @MainActor
    func testPaintMarksEveryMatchAndSinglesOutTheCurrentOne() {
        var attributed = AttributedString("deploy then deploy again")
        ChatSearch.paint(&attributed, query: "deploy", currentOccurrence: 1)
        let backgrounds = attributed.runs.compactMap { $0.backgroundColor }
        XCTAssertEqual(backgrounds.filter { $0 == ChatSearch.matchBackground }.count, 1)
        XCTAssertEqual(backgrounds.filter { $0 == ChatSearch.currentBackground }.count, 1)
    }

    @MainActor
    func testPaintLeavesTheBodyAloneWithNoQuery() {
        var attributed = AttributedString("nothing to find here")
        ChatSearch.paint(&attributed, query: "", currentOccurrence: nil)
        XCTAssertTrue(attributed.runs.allSatisfy { $0.backgroundColor == nil })
    }

    @MainActor
    func testPaintHighlightsNothingStrongWhenTheCursorIsInAnotherMessage() {
        var attributed = AttributedString("deploy")
        ChatSearch.paint(&attributed, query: "deploy", currentOccurrence: nil)
        XCTAssertEqual(
            attributed.runs.compactMap { $0.backgroundColor },
            [ChatSearch.matchBackground]
        )
    }
}

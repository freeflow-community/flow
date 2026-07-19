import Foundation
import XCTest

@testable import Flow

final class MarkdownBlocksTests: XCTestCase {
    // MARK: - Line classification

    func testKindsClassification() {
        let body = "hello\n> quoted\n```swift\nlet x = 1\n```\ntail"
        let kinds = MarkdownBlocks.kinds(of: MarkdownBlocks.lines(body))
        XCTAssertEqual(kinds, [.plain, .quote, .fence, .code, .fence, .plain])
    }

    func testQuoteMarkerOnlyOutsideCode() {
        let body = "```\n> not a quote\n```"
        let kinds = MarkdownBlocks.kinds(of: MarkdownBlocks.lines(body))
        XCTAssertEqual(kinds, [.fence, .code, .fence])
    }

    func testUnterminatedFenceRunsToEnd() {
        let body = "```\ncode line\nmore"
        let kinds = MarkdownBlocks.kinds(of: MarkdownBlocks.lines(body))
        XCTAssertEqual(kinds, [.fence, .code, .code])
    }

    func testIndentedFenceRecognized() {
        let kinds = MarkdownBlocks.kinds(of: MarkdownBlocks.lines("  ```\nx\n```"))
        XCTAssertEqual(kinds, [.fence, .code, .fence])
    }

    // MARK: - Fence splitting (outgoing-transform guard)

    func testFenceSplitRoundTripsExactly() {
        let bodies = [
            "plain only",
            "",
            "a\n```\ncode\n```\nb",
            "```js\nunterminated",
            "> quote\n```\n:smile: @Bob\n```\ntrailing\n",
            "```\n```\n```\nodd fences",
        ]
        for body in bodies {
            XCTAssertEqual(
                MarkdownBlocks.fenceSplit(body).map(\.text).joined(), body,
                "fenceSplit must reconstruct the input byte-for-byte"
            )
        }
    }

    func testFenceSplitMarksFenceRegionsAsCode() {
        let runs = MarkdownBlocks.fenceSplit("a\n```\ncode\n```\nb")
        XCTAssertEqual(runs.map(\.isCode), [false, true, false])
        XCTAssertEqual(runs[1].text, "```\ncode\n```\n")
    }

    func testMapNonCodeLeavesCodeUntouched() {
        let body = "a :x: b\n```\n:x:\n```\n:x:"
        let out = MarkdownBlocks.mapNonCode(body) {
            $0.replacingOccurrences(of: ":x:", with: "Y")
        }
        XCTAssertEqual(out, "a Y b\n```\n:x:\n```\nY")
    }

    func testShortcodeExpansionSkipsFencedCode() {
        let body = "hi :smile:\n```\n:smile:\n```"
        let out = MarkdownBlocks.mapNonCode(body, EmojiCatalog.expandShortcodes)
        XCTAssertEqual(out, "hi 😄\n```\n:smile:\n```")
    }

    // MARK: - Segments (message rendering)

    func testSegmentsSplitsBlocks() {
        let body = "para1\npara2\n\n> q1\n> q2\n```js\ncode1\ncode2\n```\ntail"
        XCTAssertEqual(MarkdownBlocks.segments(body), [
            .paragraph("para1\npara2"),
            .quote("q1\nq2"),
            .code("code1\ncode2"),
            .paragraph("tail"),
        ])
    }

    func testQuoteMarkersStripped() {
        // ">" with and without the following space, and an empty quote line.
        XCTAssertEqual(
            MarkdownBlocks.segments("> a\n>b\n>"),
            [.quote("a\nb\n")]
        )
    }

    func testFenceMarkersHiddenAndInfoStringDropped() {
        XCTAssertEqual(MarkdownBlocks.segments("```swift\nlet x = 1\n```"), [.code("let x = 1")])
    }

    func testWhitespaceOnlyBodyHasNoSegments() {
        XCTAssertEqual(MarkdownBlocks.segments("   \n\n"), [])
        XCTAssertEqual(MarkdownBlocks.segments(""), [])
    }

    func testUnterminatedFenceSegment() {
        XCTAssertEqual(
            MarkdownBlocks.segments("before\n```\ncode"),
            [.paragraph("before"), .code("code")]
        )
    }

    // MARK: - UTF-16 ranges (composer attribute pass)

    func testClassifiedLineRangesAreContiguousUTF16() {
        let body = "😀 hi\n> q\n```\n🧑‍💻\n```"
        let ranges = MarkdownBlocks.classifiedLineRanges(body)
        var location = 0
        for (range, _) in ranges {
            XCTAssertEqual(range.location, location)
            location = NSMaxRange(range)
        }
        XCTAssertEqual(location, (body as NSString).length)
        XCTAssertEqual(ranges.map(\.kind), [.plain, .quote, .fence, .code, .fence])
    }
}

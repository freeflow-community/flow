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

    // MARK: - ATX headings
    //
    // The web client is the specification here (packages/web/src/lib/format.tsx
    // `HEADING_RE`, pinned by format.test.tsx:67-71 and 114-119). These mirror
    // those cases so the two grammars can't drift apart silently.

    func testHeadingLevelsOneThroughSix() {
        for level in 1...6 {
            let hashes = String(repeating: "#", count: level)
            XCTAssertEqual(
                MarkdownBlocks.segments("\(hashes) Title"),
                [.heading(level: level, text: "Title")],
                "\(level) hashes should be an h\(level)"
            )
        }
    }

    func testSevenHashesIsNotAHeading() {
        // Web: html('####### too many') === '####### too many'.
        XCTAssertEqual(
            MarkdownBlocks.segments("####### too many"),
            [.paragraph("####### too many")]
        )
    }

    func testHashesWithoutFollowingSpaceAreNotAHeading() {
        XCTAssertEqual(MarkdownBlocks.segments("#hashtag"), [.paragraph("#hashtag")])
        XCTAssertEqual(MarkdownBlocks.segments("###C++"), [.paragraph("###C++")])
        XCTAssertEqual(MarkdownBlocks.segments("#"), [.paragraph("#")])
    }

    func testHeadingKeepsInlineMarkupForTheInlinePass() {
        // Web renders heading content through renderBody, so the markers must
        // survive the block parse — `MentionRendering.attributed` handles them.
        XCTAssertEqual(
            MarkdownBlocks.segments("# Big **title** <@01234567-89ab-cdef-0123-456789abcdef>"),
            [.heading(level: 1, text: "Big **title** <@01234567-89ab-cdef-0123-456789abcdef>")]
        )
    }

    func testHeadingDropsAllWhitespaceAfterTheHashes() {
        // `\s+` is greedy on web, so content never keeps leading spaces.
        XCTAssertEqual(MarkdownBlocks.segments("##   spaced"), [.heading(level: 2, text: "spaced")])
        XCTAssertEqual(MarkdownBlocks.segments("##\tTabbed"), [.heading(level: 2, text: "Tabbed")])
        XCTAssertEqual(MarkdownBlocks.segments("# "), [.heading(level: 1, text: "")])
    }

    func testHeadingSplitsSurroundingProseIntoSeparateParagraphs() {
        XCTAssertEqual(
            MarkdownBlocks.segments("intro line\n## Section\nbody line\nmore body"),
            [
                .paragraph("intro line"),
                .heading(level: 2, text: "Section"),
                .paragraph("body line\nmore body"),
            ]
        )
    }

    func testConsecutiveHeadingsAreSeparateSegments() {
        XCTAssertEqual(
            MarkdownBlocks.segments("# One\n## Two"),
            [.heading(level: 1, text: "One"), .heading(level: 2, text: "Two")]
        )
    }

    func testHeadingInsideFencedCodeIsNotParsed() {
        // Web: format.test.tsx:114-119 — '# not a heading' stays literal.
        XCTAssertEqual(
            MarkdownBlocks.segments("```\n# not a heading\n```"),
            [.code("# not a heading")]
        )
    }

    func testHeadingInsideQuoteStaysQuoteContent() {
        // Web checks the quote branch before the heading branch, so a "> #"
        // line is a quote whose text happens to start with a hash.
        XCTAssertEqual(
            MarkdownBlocks.segments("> # quoted"),
            [.quote("# quoted")]
        )
    }

    func testHeadingBeatsTableStartOnTheSameLine() {
        // Web tests HEADING_RE before isTableStart; a heading line carrying a
        // pipe is still a heading, and the separator below it is then prose.
        XCTAssertEqual(
            MarkdownBlocks.segments("# a | b\n| - | - |"),
            [.heading(level: 1, text: "a | b"), .paragraph("| - | - |")]
        )
    }

    func testHeadingRecognisedAfterATable() {
        XCTAssertEqual(
            MarkdownBlocks.segments("| a |\n| - |\n| 1 |\n## After"),
            [
                .table(header: ["a"], align: [nil], rows: [["1"]]),
                .heading(level: 2, text: "After"),
            ]
        )
    }

    // MARK: - GFM pipe tables

    func testTableParsesHeaderAlignAndRows() {
        let body = "| Name | Qty |\n| :--- | ---: |\n| Apple | 3 |\n| Pear | 12 |"
        XCTAssertEqual(MarkdownBlocks.segments(body), [
            .table(
                header: ["Name", "Qty"],
                align: [.left, .right],
                rows: [["Apple", "3"], ["Pear", "12"]]
            ),
        ])
    }

    func testTableWithoutOuterPipesAndCenterAlign() {
        let body = "a | b\n:-: | -\n1 | 2"
        XCTAssertEqual(MarkdownBlocks.segments(body), [
            .table(header: ["a", "b"], align: [.center, nil], rows: [["1", "2"]]),
        ])
    }

    func testTableSeparatedFromSurroundingProse() {
        let body = "before\n| a |\n| - |\n| 1 |\nafter"
        XCTAssertEqual(MarkdownBlocks.segments(body), [
            .paragraph("before"),
            .table(header: ["a"], align: [nil], rows: [["1"]]),
            .paragraph("after"),
        ])
    }

    func testHeaderOnlyTableHasNoRows() {
        XCTAssertEqual(
            MarkdownBlocks.segments("| a | b |\n| - | - |"),
            [.table(header: ["a", "b"], align: [nil, nil], rows: [])]
        )
    }

    func testPipeTextWithoutSeparatorStaysProse() {
        // A lone pipe line is not a table — the separator row is what makes one.
        XCTAssertEqual(
            MarkdownBlocks.segments("a | b\nnot a table"),
            [.paragraph("a | b\nnot a table")]
        )
    }

    func testTableInsideFencedCodeIsNotParsed() {
        XCTAssertEqual(
            MarkdownBlocks.segments("```\n| a |\n| - |\n```"),
            [.code("| a |\n| - |")]
        )
    }

    func testRaggedTableRowsArePreservedVerbatim() {
        // The renderer pads/truncates; the parser must not lose cells.
        XCTAssertEqual(
            MarkdownBlocks.segments("| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |"),
            [.table(header: ["a", "b"], align: [nil, nil], rows: [["1"], ["1", "2", "3"]])]
        )
    }

    // MARK: - Lists and horizontal rules
    //
    // Mirrors packages/web/src/lib/format.test.tsx:73-84 and 108-119.

    func testBulletListFromDashStarAndPlus() {
        // Web: "-", "*" and "+" are one list, not three.
        XCTAssertEqual(
            MarkdownBlocks.segments("- one\n* two\n+ three"),
            [.ulist(items: ["one", "two", "three"])]
        )
    }

    func testNumberedListPreservesItsStartIndex() {
        XCTAssertEqual(
            MarkdownBlocks.segments("3. third\n4. fourth"),
            [.olist(start: 3, items: ["third", "fourth"])]
        )
    }

    func testListMarkersNeedFollowingWhitespace() {
        XCTAssertEqual(
            MarkdownBlocks.segments("-nope\n1.nope"),
            [.paragraph("-nope\n1.nope")]
        )
    }

    func testListsSplitSurroundingProse() {
        XCTAssertEqual(
            MarkdownBlocks.segments("before\n- one\n- two\nafter"),
            [.paragraph("before"), .ulist(items: ["one", "two"]), .paragraph("after")]
        )
    }

    func testIndentedListItemsJoinTheSameList() {
        // Nesting is out of scope (web doesn't do it either): an indented item
        // is just another item, with its marker and indent stripped.
        XCTAssertEqual(
            MarkdownBlocks.segments("- one\n  - two"),
            [.ulist(items: ["one", "two"])]
        )
    }

    func testBulletAndNumberedRunsAreSeparateSegments() {
        XCTAssertEqual(
            MarkdownBlocks.segments("- a\n1. b"),
            [.ulist(items: ["a"]), .olist(start: 1, items: ["b"])]
        )
    }

    func testHorizontalRuleFromDashesStarsAndUnderscores() {
        for body in ["---", "***", "___", "----- "] {
            XCTAssertEqual(MarkdownBlocks.segments(body), [.hr], "body: \(body)")
        }
    }

    func testTwoDashesAreNotARule() {
        XCTAssertEqual(MarkdownBlocks.segments("--"), [.paragraph("--")])
    }

    func testPipeLineFollowedByDashesIsARuleNotATable() {
        // format.test.tsx:108-112 — the separator carries no pipe, so "a | b"
        // stays prose and the dashes are a rule.
        XCTAssertEqual(
            MarkdownBlocks.segments("a | b\n---"),
            [.paragraph("a | b"), .hr]
        )
    }

    func testTableSeparatorIsStillATableNotARule() {
        // The mirror image: with a pipe in it, the dashes are a separator.
        XCTAssertEqual(
            MarkdownBlocks.segments("a | b\n--- | ---"),
            [.table(header: ["a", "b"], align: [nil, nil], rows: [])]
        )
    }

    func testRuleSeparatesTwoParagraphs() {
        XCTAssertEqual(
            MarkdownBlocks.segments("above\n---\nbelow"),
            [.paragraph("above"), .hr, .paragraph("below")]
        )
    }

    func testListsAndRulesInsideFencedCodeAreNotParsed() {
        // format.test.tsx:114-119 — a marker inside a fence stays code.
        XCTAssertEqual(
            MarkdownBlocks.segments("```\n- not a list\n1. not a list\n---\n```"),
            [.code("- not a list\n1. not a list\n---")]
        )
    }

    func testListMarkerInsideQuoteStaysQuoteContent() {
        XCTAssertEqual(
            MarkdownBlocks.segments("> - not a list"),
            [.quote("- not a list")]
        )
    }

    func testMixedBlockRunKeepsWebsOrdering() {
        let body = "intro\n# Title\n- one\n- two\n1. first\n2. second\n---\noutro"
        XCTAssertEqual(MarkdownBlocks.segments(body), [
            .paragraph("intro"),
            .heading(level: 1, text: "Title"),
            .ulist(items: ["one", "two"]),
            .olist(start: 1, items: ["first", "second"]),
            .hr,
            .paragraph("outro"),
        ])
    }

    // MARK: - Mermaid fences (#229)

    func testFenceLanguageReadsTheInfoString() {
        XCTAssertEqual(MarkdownBlocks.fenceLanguage("```mermaid"), "mermaid")
        XCTAssertEqual(MarkdownBlocks.fenceLanguage("```Mermaid  "), "mermaid")
        XCTAssertEqual(MarkdownBlocks.fenceLanguage("```mermaid theme=forest"), "mermaid")
        XCTAssertEqual(MarkdownBlocks.fenceLanguage("  ```mermaid"), "mermaid")
        XCTAssertEqual(MarkdownBlocks.fenceLanguage("```swift"), "swift")
        XCTAssertEqual(MarkdownBlocks.fenceLanguage("```"), "")
        XCTAssertEqual(MarkdownBlocks.fenceLanguage("not a fence"), "")
    }

    func testMermaidFenceBecomesItsOwnSegment() {
        let source = "flowchart LR\n  A[Client] --> B[Bridge]"
        XCTAssertEqual(
            MarkdownBlocks.segments("```mermaid\n" + source + "\n```"),
            [.mermaid(source)]
        )
    }

    func testOnlyMermaidFencesBecomeDiagrams() {
        XCTAssertEqual(MarkdownBlocks.segments("```\nplain\n```"), [.code("plain")])
        XCTAssertEqual(MarkdownBlocks.segments("```swift\nlet x = 1\n```"), [.code("let x = 1")])
        // Nothing to draw — stays a code block, as on web.
        XCTAssertEqual(MarkdownBlocks.segments("```mermaid\n\n```"), [.code("")])
    }

    func testMermaidFenceDoesNotDisturbNeighbouringBlocks() {
        let segs = MarkdownBlocks.segments("# T\n```mermaid\npie\n```\n- a")
        XCTAssertEqual(segs, [.heading(level: 1, text: "T"), .mermaid("pie"), .ulist(items: ["a"])])
    }

    func testMermaidFenceIsStillCodeForOutgoingTransforms() {
        // The composer must not expand :smile: or @Name inside a diagram.
        let body = "```mermaid\nflowchart LR\n  A[:smile:] --> B\n```"
        XCTAssertEqual(MarkdownBlocks.mapNonCode(body) { _ in "REPLACED" }, body)
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

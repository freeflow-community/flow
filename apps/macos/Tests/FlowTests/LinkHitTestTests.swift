import Foundation
import XCTest

@testable import Flow

/// Hit-testing behind the hand cursor over links (#81). The rects come from a
/// TextKit re-layout of the string SwiftUI is drawing, so what's worth pinning
/// down is that links produce rects, non-links produce none, and a wrapped
/// link produces one rect per line rather than one box swallowing the lines
/// between them.
final class LinkHitTestTests: XCTestCase {
    private func attributed(_ markdown: String) -> AttributedString {
        MentionRendering.attributed(markdown, names: [:], currentUserId: nil)
    }

    func testPlainTextHasNoLinkRects() {
        let rects = LinkHitTest.linkRects(in: attributed("just some words"), width: 400)
        XCTAssertTrue(rects.isEmpty)
    }

    func testMarkdownLinkProducesARect() {
        let rects = LinkHitTest.linkRects(in: attributed("see [the docs](https://flow.example) now"), width: 400)
        XCTAssertEqual(rects.count, 1)
        let rect = try? XCTUnwrap(rects.first)
        XCTAssertGreaterThan(rect?.width ?? 0, 0)
        XCTAssertGreaterThan(rect?.height ?? 0, 0)
        // "see " comes first, so the link can't start at the leading edge.
        XCTAssertGreaterThan(rect?.minX ?? 0, 0)
    }

    func testAutolinkProducesARect() {
        let rects = LinkHitTest.linkRects(in: attributed("<https://flow.example/page>"), width: 400)
        XCTAssertEqual(rects.count, 1)
    }

    func testWrappedLinkProducesOneRectPerLine() {
        let long = String(repeating: "wrapping ", count: 12).trimmingCharacters(in: .whitespaces)
        let rects = LinkHitTest.linkRects(in: attributed("[\(long)](https://flow.example)"), width: 120)
        XCTAssertGreaterThan(rects.count, 1)
        // Distinct lines, i.e. no single box covering the whole paragraph.
        XCTAssertEqual(Set(rects.map(\.minY)).count, rects.count)
    }

    func testZeroWidthIsNotHitTested() {
        XCTAssertTrue(LinkHitTest.linkRects(in: attributed("[x](https://flow.example)"), width: 0).isEmpty)
    }

    // MARK: - Drawn size (#276)

    /// The rects have to be measured at the size the text is drawn at. A
    /// heading measured as body text produces a rect narrower than the link,
    /// which is a hand cursor that stops partway across it.
    func testLargerTextProducesAWiderRect() {
        let link = attributed("[the docs](https://flow.example)")
        let body = LinkHitTest.linkRects(in: link, width: 400).first
        let heading = LinkHitTest.linkRects(in: link, width: 400, size: 17).first
        let cell = LinkHitTest.linkRects(in: link, width: 400, size: 13)
        XCTAssertNotNil(body)
        XCTAssertNotNil(heading)
        XCTAssertGreaterThan(heading?.width ?? 0, body?.width ?? 0)
        XCTAssertGreaterThan(heading?.height ?? 0, body?.height ?? 0)
        XCTAssertEqual(cell.count, 1)
    }

    /// Zoom multiplies the drawn size rather than replacing it (#105 + #276).
    func testZoomScalesAnExplicitSize() {
        let link = attributed("[the docs](https://flow.example)")
        let plain = LinkHitTest.linkRects(in: link, width: 600, scale: 1, size: 13).first
        let zoomed = LinkHitTest.linkRects(in: link, width: 600, scale: 1.5, size: 13).first
        XCTAssertGreaterThan(zoomed?.width ?? 0, plain?.width ?? 0)
    }

    /// The two surfaces this issue turned out to miss: a link in a table cell
    /// and a link in the channel topic are both hit-testable, at their own
    /// sizes (`MarkdownTableView` 13pt, the header topic 12pt).
    func testTableCellAndTopicLinksAreHitTestable() {
        let cell = LinkHitTest.linkRects(
            in: attributed("[cell link](https://flow.example)"), width: 200, size: 13
        )
        XCTAssertEqual(cell.count, 1)

        let topic = LinkHitTest.linkRects(
            in: attributed("standup notes: https://flow.example/notes"), width: 300, size: 12
        )
        XCTAssertEqual(topic.count, 1)
        XCTAssertGreaterThan(topic.first?.minX ?? 0, 0) // after "standup notes: "
    }

    // MARK: - Click target (#276)

    /// The overlay is hit-testable over a link, so it owns the click too and
    /// has to know where the link goes, not just where it is.
    func testTargetsCarryTheURL() {
        let targets = LinkHitTest.linkTargets(
            in: attributed("see [the docs](https://flow.example/page) now"), width: 400
        )
        XCTAssertEqual(targets.count, 1)
        XCTAssertEqual(targets.first?.url, URL(string: "https://flow.example/page"))
    }

    /// Two links in one paragraph each keep their own destination — a single
    /// URL for the whole run would open the wrong page.
    func testEachLinkKeepsItsOwnDestination() {
        let targets = LinkHitTest.linkTargets(
            in: attributed("[one](https://flow.example/1) and [two](https://flow.example/2)"),
            width: 400
        )
        XCTAssertEqual(targets.map(\.url), [
            URL(string: "https://flow.example/1"), URL(string: "https://flow.example/2"),
        ])
        // Distinct places on the line, so a click can tell them apart.
        XCTAssertNotEqual(targets.first?.rect, targets.last?.rect)
    }

    /// A wrapped link is several rects, and every one of them must open it.
    func testWrappedLinkKeepsItsURLOnEveryLine() {
        let long = String(repeating: "wrapping ", count: 12).trimmingCharacters(in: .whitespaces)
        let targets = LinkHitTest.linkTargets(
            in: attributed("[\(long)](https://flow.example)"), width: 120
        )
        XCTAssertGreaterThan(targets.count, 1)
        XCTAssertTrue(targets.allSatisfy { $0.url == URL(string: "https://flow.example") })
    }
}

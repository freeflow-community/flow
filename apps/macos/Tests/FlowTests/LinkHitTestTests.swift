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
}

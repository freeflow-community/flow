import SwiftUI
import XCTest

@testable import Flow

/// Text zoom (#105). The parts worth pinning down are the ones a user can
/// walk into: the ladder's ends, the way back to 100%, that the setting
/// survives a relaunch, and that an unzoomed app draws exactly the fonts it
/// drew before the feature existed.
@MainActor
final class TextZoomTests: XCTestCase {
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        // A scratch suite, so the tests never touch the real preference.
        defaults = UserDefaults(suiteName: "TextZoomTests-\(UUID().uuidString)")
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: defaults.dictionaryRepresentation().description)
        defaults = nil
        super.tearDown()
    }

    // MARK: - The ladder

    func testStartsAtActualSize() {
        let zoom = TextZoom(defaults: defaults)
        XCTAssertEqual(zoom.scale, 1.0)
        XCTAssertTrue(zoom.isDefault)
        XCTAssertEqual(zoom.label, "100%")
    }

    func testZoomInAndOutWalkTheLadder() {
        let zoom = TextZoom(defaults: defaults)
        zoom.zoomIn()
        XCTAssertEqual(zoom.scale, 1.1)
        zoom.zoomIn()
        XCTAssertEqual(zoom.scale, 1.25)
        zoom.zoomOut()
        XCTAssertEqual(zoom.scale, 1.1)
        zoom.zoomOut()
        zoom.zoomOut()
        XCTAssertEqual(zoom.scale, 0.9)
    }

    func testClampsAtBothEnds() {
        let zoom = TextZoom(defaults: defaults)
        for _ in 0..<20 { zoom.zoomIn() }
        XCTAssertEqual(zoom.scale, TextZoom.steps.last)
        XCTAssertFalse(zoom.canZoomIn)
        XCTAssertTrue(zoom.canZoomOut)

        for _ in 0..<40 { zoom.zoomOut() }
        XCTAssertEqual(zoom.scale, TextZoom.steps.first)
        XCTAssertFalse(zoom.canZoomOut)
        XCTAssertTrue(zoom.canZoomIn)
    }

    /// ⌘0 is the way back. A zoom you can't undo is worse than no zoom.
    func testResetReturnsToActualSizeFromEitherDirection() {
        let zoom = TextZoom(defaults: defaults)
        zoom.zoomIn()
        zoom.zoomIn()
        zoom.reset()
        XCTAssertEqual(zoom.scale, 1.0)
        zoom.zoomOut()
        zoom.reset()
        XCTAssertEqual(zoom.scale, 1.0)
        XCTAssertTrue(zoom.isDefault)
    }

    func testLabelReportsThePercentage() {
        let zoom = TextZoom(defaults: defaults)
        zoom.zoomIn()
        zoom.zoomIn()
        XCTAssertEqual(zoom.label, "125%")
    }

    // MARK: - Persistence

    func testScaleSurvivesARelaunch() {
        let first = TextZoom(defaults: defaults)
        first.zoomIn()
        first.zoomIn()
        XCTAssertEqual(TextZoom(defaults: defaults).scale, first.scale)
    }

    func testResetPersistsToo() {
        let first = TextZoom(defaults: defaults)
        first.zoomIn()
        first.reset()
        XCTAssertEqual(TextZoom(defaults: defaults).scale, 1.0)
    }

    /// A value from an older ladder (or a hand-edited pref) still has to land
    /// on a rung, or zoom in/out from it goes nowhere.
    func testAnOffLadderValueSnapsToTheNearestStep() {
        defaults.set(1.3, forKey: "textZoomScale" + Profile.suffix)
        XCTAssertEqual(TextZoom(defaults: defaults).scale, 1.25)

        defaults.set(9.0, forKey: "textZoomScale" + Profile.suffix)
        XCTAssertEqual(TextZoom(defaults: defaults).scale, TextZoom.steps.last)
    }

    func testLadderIsAscendingAndContainsActualSize() {
        XCTAssertEqual(TextZoom.steps, TextZoom.steps.sorted())
        XCTAssertTrue(TextZoom.steps.contains(TextZoom.defaultScale))
    }

    // MARK: - Fonts

    /// Unzoomed, every call site must get back the font it asked for — the
    /// point of routing them all through `flowFont` is that 100% is a no-op.
    func testUnzoomedFontsAreTheOriginalFonts() {
        XCTAssertEqual(ZoomedFont.system(.callout, scale: 1), .system(.callout))
        XCTAssertEqual(
            ZoomedFont.system(.caption, weight: .semibold, scale: 1),
            .system(.caption, weight: .semibold)
        )
        XCTAssertEqual(ZoomedFont.system(size: 13, scale: 1), .system(size: 13))
        XCTAssertEqual(
            ZoomedFont.system(size: 12, design: .monospaced, scale: 1),
            .system(size: 12, design: .monospaced)
        )
    }

    func testExplicitSizesAreMultiplied() {
        XCTAssertEqual(ZoomedFont.system(size: 13, scale: 1.5), .system(size: 19.5))
        XCTAssertEqual(
            ZoomedFont.system(size: 11, weight: .semibold, scale: 2),
            .system(size: 22, weight: .semibold)
        )
    }

    /// Semantic styles scale off the platform's own point size, so a zoomed
    /// `.callout` stays a callout — just bigger.
    func testSemanticStylesScaleFromTheirPlatformSize() {
        let callout = ZoomedFont.pointSize(.callout)
        XCTAssertGreaterThan(callout, 0)
        XCTAssertEqual(ZoomedFont.system(.callout, scale: 1.25), .system(size: callout * 1.25))
    }

    /// `.headline` is semibold by definition; scaling must not flatten it to
    /// regular the way a naive size swap would.
    func testHeadlineKeepsItsWeightWhenScaled() {
        XCTAssertEqual(
            ZoomedFont.system(.headline, scale: 1.5),
            .system(size: ZoomedFont.pointSize(.headline) * 1.5, weight: .semibold)
        )
    }

    func testTextStylesAllResolveToARealPointSize() {
        let styles: [Font.TextStyle] = [
            .largeTitle, .title, .title2, .title3, .headline,
            .subheadline, .body, .callout, .footnote, .caption, .caption2,
        ]
        for style in styles {
            XCTAssertGreaterThan(ZoomedFont.pointSize(style), 0, "\(style) has no point size")
        }
        // And they're ordered the way their names imply, so a zoomed UI keeps
        // its typographic hierarchy.
        XCTAssertGreaterThan(ZoomedFont.pointSize(.title), ZoomedFont.pointSize(.callout))
        XCTAssertGreaterThan(ZoomedFont.pointSize(.callout), ZoomedFont.pointSize(.caption2))
    }

    /// Mention pills carry their own font inside the AttributedString, so they
    /// have to be told the scale or they stay small while the prose grows.
    func testMentionPillsScaleWithTheProse() {
        let id = "00000000-0000-0000-0000-0000000000ab"
        let body = "hey <@\(id)> look"
        let names = [id: "Ada"]

        let plain = MentionRendering.attributed(body, names: names, currentUserId: nil)
        let zoomed = MentionRendering.attributed(body, names: names, currentUserId: nil, scale: 1.5)

        let pillFont = { (s: AttributedString) in
            s.runs.compactMap(\.font).first
        }
        XCTAssertEqual(pillFont(plain), .system(.callout, weight: .bold))
        XCTAssertEqual(
            pillFont(zoomed),
            .system(size: ZoomedFont.pointSize(.callout) * 1.5, weight: .bold)
        )
    }

    /// Link hit-testing re-lays the string in TextKit; if it ignores the zoom
    /// the hand cursor drifts off the link the moment you press ⌘+.
    func testLinkRectsGrowWithTheZoom() {
        let attributed = MentionRendering.attributed(
            "see [the docs](https://flow.example) now", names: [:], currentUserId: nil
        )
        let plain = LinkHitTest.linkRects(in: attributed, width: 400)
        let zoomed = LinkHitTest.linkRects(in: attributed, width: 400, scale: 1.5)
        XCTAssertEqual(plain.count, 1)
        XCTAssertEqual(zoomed.count, 1)
        XCTAssertGreaterThan(zoomed[0].width, plain[0].width)
        XCTAssertGreaterThan(zoomed[0].height, plain[0].height)
    }
}

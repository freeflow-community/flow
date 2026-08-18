import CoreGraphics
import XCTest

@testable import Flow

/// The iOS transcript's re-stick rule (`TranscriptFollow`), which has now been
/// wrong in both directions. #159: it re-stuck on any resize, so a short
/// back-pull bounced to the bottom on release. #280: the growth-only rule that
/// fixed it left a *shrink* uncorrected, so a list that opened past the end of
/// its content — `.initialOffset` resolving against the LazyVStack's estimate —
/// stayed there, blank, until a drag clamped it.
///
/// The rule those two settle on: before the reader's first drag the list owns
/// its position and corrects itself either way; after it, only growth may move
/// the list, and only for a reader who was already at the end.
final class TranscriptFollowTests: XCTestCase {
    private let viewport: CGFloat = 800
    private let slack: CGFloat = 120

    /// Content frame in the scroll view's space: `top` is -offset, so maxY is
    /// the content's bottom edge measured from the top of the viewport.
    private func frame(top: CGFloat, height: CGFloat) -> CGRect {
        CGRect(x: 0, y: top, width: 390, height: height)
    }

    private func restick(
        pinned: Bool = true,
        hasDragged: Bool = false,
        isDragging: Bool = false,
        hasFocusTarget: Bool = false,
        old: CGRect,
        new: CGRect
    ) -> Bool {
        TranscriptFollow.shouldRestick(
            pinned: pinned, hasDragged: hasDragged, isDragging: isDragging,
            hasFocusTarget: hasFocusTarget, old: old, new: new,
            viewportHeight: viewport, bottomSlack: slack)
    }

    // MARK: - #280: the blank transcript

    /// The report itself. The list opens parked past the end of the content
    /// (maxY below the viewport's bottom edge, so the screen is empty), then
    /// the content shrinks as real row heights replace the estimates. Nothing
    /// has been dragged, so this must pull the viewport back to the newest
    /// message.
    func testShrinkBeforeFirstDragRestick() {
        let old = frame(top: -3000, height: 3400) // maxY 400 — 400pt of blank below
        let new = frame(top: -3000, height: 3100) // estimates resolve shorter still
        XCTAssertTrue(restick(old: old, new: new))
    }

    /// Same shrink once the reader has dragged: they own the position now, and
    /// yanking them to the bottom on a mid-scroll LazyVStack resize is #159.
    func testShrinkAfterFirstDragDoesNothing() {
        let old = frame(top: -3000, height: 3400)
        let new = frame(top: -3000, height: 3100)
        XCTAssertFalse(restick(hasDragged: true, old: old, new: new))
    }

    /// A viewport parked past the end still counts as "at the bottom" — the
    /// near-bottom gate must not read a negative distance as "scrolled away".
    func testParkedPastTheEndCountsAsAtTheBottom() {
        let old = frame(top: -3600, height: 3400) // maxY -200: content ends off-screen above
        let new = frame(top: -3600, height: 3200)
        XCTAssertTrue(restick(old: old, new: new))
    }

    /// Layout noise below the 1pt threshold isn't a resize.
    func testSubPointResizeIsIgnored() {
        let old = frame(top: -3000, height: 3400)
        let new = frame(top: -3000, height: 3400.5)
        XCTAssertFalse(restick(old: old, new: new))
    }

    /// A pure scroll — the offset moved, the content didn't resize — never
    /// re-sticks, even before the first drag. Otherwise the re-stick feeds
    /// itself off its own scrollTo.
    func testOffsetChangeWithoutResizeDoesNothing() {
        let old = frame(top: -3000, height: 3400)
        let new = frame(top: -2950, height: 3400)
        XCTAssertFalse(restick(old: old, new: new))
    }

    // MARK: - #191: growth while pinned at the end

    /// The case the growth rule was written for: a tall new message lands while
    /// the reader sits at the end. Still re-sticks, dragged or not.
    func testGrowthWhilePinnedAtTheEndGlues() {
        let old = frame(top: -2600, height: 3400) // maxY 800 — exactly at the bottom
        let new = frame(top: -2600, height: 3900) // +500pt message
        XCTAssertTrue(restick(hasDragged: true, old: old, new: new))
        XCTAssertTrue(restick(old: old, new: new))
    }

    // MARK: - #111 / #159: the reader's position wins

    /// Read-back history: the reader is well above the end, so a new message
    /// must not drag them down — the jump pill offers the trip instead.
    func testGrowthWhileBackScrolledDoesNothing() {
        let old = frame(top: -400, height: 3400) // maxY 3000, far past the slack
        let new = frame(top: -400, height: 3900)
        XCTAssertFalse(restick(hasDragged: true, old: old, new: new))
    }

    /// Unpinned means the reader left the end on purpose.
    func testUnpinnedNeverRestick() {
        let old = frame(top: -2600, height: 3400)
        let new = frame(top: -2600, height: 3900)
        XCTAssertFalse(restick(pinned: false, old: old, new: new))
    }

    /// A finger on the glass owns the list outright, first drag or not.
    func testMidDragNeverRestick() {
        let old = frame(top: -3000, height: 3400)
        let new = frame(top: -3000, height: 3100)
        XCTAssertFalse(restick(isDragging: true, old: old, new: new))
        XCTAssertFalse(restick(hasDragged: true, isDragging: true, old: old, new: new))
    }

    /// A pending jump-to-message owns the scroll position until it lands.
    func testFocusTargetNeverRestick() {
        let old = frame(top: -3000, height: 3400)
        let new = frame(top: -3000, height: 3100)
        XCTAssertFalse(restick(hasFocusTarget: true, old: old, new: new))
    }

    /// Just inside the slack still counts as at the end; just outside doesn't.
    func testSlackBoundary() {
        let inside = frame(top: -2600, height: 3520) // maxY 920 == viewport + slack
        let outside = frame(top: -2600, height: 3521)
        XCTAssertTrue(restick(hasDragged: true, old: inside, new: frame(top: -2600, height: 3900)))
        XCTAssertFalse(restick(hasDragged: true, old: outside, new: frame(top: -2600, height: 3900)))
    }
}

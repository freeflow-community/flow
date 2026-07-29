import Foundation
import XCTest

@testable import Flow

/// The pinned-follow model behind auto-scroll (#111 follow-up). The reported
/// bug: a tall message arriving while the reader sat at the bottom flipped the
/// geometric atBottom false before the follow scroll settled, latching the
/// follow off — new output stopped auto-scrolling and only the jump pill
/// showed. The rule (ported from the web client): content growth never unpins,
/// only an actual upward scroll does; growth while pinned re-glues to the
/// newest message; nearing the bottom re-pins.
@MainActor
final class MessageFollowTests: XCTestCase {
    private let viewport: CGFloat = 600

    /// Content frame in the scroll view's space: minY is -offset, height grows
    /// with the transcript.
    private func frame(top: CGFloat, height: CGFloat) -> CGRect {
        CGRect(x: 0, y: top, width: 400, height: height)
    }

    private func decide(
        pinned: Bool = true, old: CGRect, new: CGRect
    ) -> MessageListView.FollowDecision {
        MessageListView.followDecision(
            pinned: pinned, old: old, new: new, viewportHeight: viewport)
    }

    /// The regression itself: a tall message grows the content past the slack
    /// while we're pinned at the bottom → glue back down, don't unpin.
    func testTallMessageWhilePinnedGlues() {
        let old = frame(top: -1400, height: 2000) // at the bottom (maxY 600)
        let new = frame(top: -1400, height: 2400) // +400pt message lands below
        XCTAssertEqual(decide(old: old, new: new), .glue)
    }

    /// Same growth while the reader is up in history → nothing moves (the
    /// jump pill is driven separately off the geometry).
    func testGrowthWhileUnpinnedDoesNothing() {
        let old = frame(top: -200, height: 2000)
        let new = frame(top: -200, height: 2400)
        XCTAssertEqual(decide(pinned: false, old: old, new: new), .none)
    }

    /// Scrolling up (content's top edge moves down) is the one unpin signal.
    func testUpwardScrollUnpins() {
        let old = frame(top: -1400, height: 2000)
        let new = frame(top: -1100, height: 2000) // maxY 900 → above the slack
        XCTAssertEqual(decide(old: old, new: new), .unpin)
    }

    /// Scrolling back to within the re-pin slack re-engages the follow.
    func testScrollingToBottomRepins() {
        let old = frame(top: -1100, height: 2000)
        let new = frame(top: -1380, height: 2000) // maxY 620 → within 40pt
        XCTAssertEqual(decide(pinned: false, old: old, new: new), .pin)
    }

    /// Elastic bounce-back at the bottom moves the top edge down but lands
    /// within the slack — the pin check runs first, so it must not unpin.
    func testBounceBackAtBottomStaysPinned() {
        let old = frame(top: -1420, height: 2000) // overscrolled past the end
        let new = frame(top: -1400, height: 2000) // settled at the bottom
        XCTAssertEqual(decide(old: old, new: new), .pin)
    }

    /// Our own glue scroll animating down (top edge moves up, no growth)
    /// must not re-trigger another glue every frame.
    func testDownwardScrollFramesAreQuiet() {
        let old = frame(top: -1100, height: 2400)
        let new = frame(top: -1300, height: 2400) // maxY 1100, still off-bottom
        XCTAssertEqual(decide(old: old, new: new), .none)
    }
}

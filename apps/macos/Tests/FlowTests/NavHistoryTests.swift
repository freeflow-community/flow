import XCTest

@testable import Flow

/// Channel visit history (issue #386) — the model, and the way `WindowState`
/// drives it. The rule that matters on macOS: the Activity feed is an *overlay*
/// with the channel selection still behind it, so history entries are views
/// (`.channel` / `.activity`), not channel ids.
final class NavHistoryTests: XCTestCase {
    func testFreshHistoryIsDeadInBothDirections() {
        let h = NavHistory()
        XCTAssertFalse(h.canGoBack)
        XCTAssertFalse(h.canGoForward)
        XCTAssertNil(h.current)
    }

    func testSingleVisitIsStillAnEndOfTheLine() {
        var h = NavHistory()
        h.record(.channel("A"))
        XCTAssertFalse(h.canGoBack)
        XCTAssertFalse(h.canGoForward)
    }

    func testWalksBackAndForwardThroughThreeVisits() {
        var h = NavHistory()
        h.record(.channel("A"))
        h.record(.channel("B"))
        h.record(.channel("C"))

        h.step(-1)
        XCTAssertEqual(h.current, .channel("B"))
        h.step(-1)
        XCTAssertEqual(h.current, .channel("A"))
        XCTAssertFalse(h.canGoBack)

        h.step(1)
        XCTAssertEqual(h.current, .channel("B"))
        h.step(1)
        XCTAssertEqual(h.current, .channel("C"))
        XCTAssertFalse(h.canGoForward)
    }

    func testReopeningTheCurrentViewIsNotAVisit() {
        var h = NavHistory()
        h.record(.channel("A"))
        h.record(.channel("B"))
        h.record(.channel("B"))
        XCTAssertEqual(h.entries, [.channel("A"), .channel("B")])
    }

    func testOpeningSomethingNewAfterBackDiscardsTheForwardBranch() {
        var h = NavHistory()
        h.record(.channel("A"))
        h.record(.channel("B"))
        h.record(.channel("C"))
        h.step(-1) // back to B
        h.record(.channel("D"))
        XCTAssertEqual(h.entries, [.channel("A"), .channel("B"), .channel("D")])
        XCTAssertFalse(h.canGoForward)
        XCTAssertEqual(h.target(-1), .channel("B"))
    }

    func testSteppingPastEitherEndDoesNothing() {
        var h = NavHistory()
        h.record(.channel("A"))
        h.step(-1)
        h.step(1)
        XCTAssertEqual(h.current, .channel("A"))
    }

    func testCapsTheStackAndKeepsTheNewestVisits() {
        var h = NavHistory()
        for i in 0..<60 { h.record(.channel("c\(i)")) }
        XCTAssertEqual(h.entries.count, 50)
        XCTAssertEqual(h.entries.first, .channel("c10"))
        XCTAssertEqual(h.current, .channel("c59"))
    }

    func testForgettingAnEntryLeavesTheCursorOnItsView() {
        var h = NavHistory()
        h.record(.channel("A"))
        h.record(.channel("B"))
        h.record(.channel("C"))
        h.forget(.channel("B"))
        XCTAssertEqual(h.entries, [.channel("A"), .channel("C")])
        XCTAssertEqual(h.current, .channel("C"))
        XCTAssertEqual(h.target(-1), .channel("A"))
    }

    func testForgettingEverythingEmptiesTheHistory() {
        var h = NavHistory()
        h.record(.channel("A"))
        h.forget(.channel("A"))
        XCTAssertTrue(h.entries.isEmpty)
        XCTAssertNil(h.current)
        XCTAssertFalse(h.canGoBack)
    }

    // MARK: - WindowState

    @MainActor
    func testBackAndForwardWalkTheChannelsThatWereVisited() {
        let win = WindowState(app: AppState())
        win.selectChannel("A")
        win.selectChannel("B")
        win.selectChannel("C")
        XCTAssertTrue(win.canGoBack)
        XCTAssertFalse(win.canGoForward)

        win.goBack()
        XCTAssertEqual(win.selectedChannelId, "B")
        win.goBack()
        XCTAssertEqual(win.selectedChannelId, "A")
        XCTAssertFalse(win.canGoBack)

        win.goForward()
        XCTAssertEqual(win.selectedChannelId, "B")
        win.goForward()
        XCTAssertEqual(win.selectedChannelId, "C")
        XCTAssertFalse(win.canGoForward)
    }

    @MainActor
    func testOpeningAChannelAfterGoingBackDropsTheForwardBranch() {
        let win = WindowState(app: AppState())
        win.selectChannel("A")
        win.selectChannel("B")
        win.selectChannel("C")
        win.goBack()
        win.selectChannel("D")
        XCTAssertFalse(win.canGoForward)
        win.goBack()
        XCTAssertEqual(win.selectedChannelId, "B")
    }

    /// The overlay case: the feed covers the pane, so going back from it has to
    /// uncover the channel — and going forward has to put it back up.
    @MainActor
    func testTheActivityFeedIsAViewInTheHistory() {
        let win = WindowState(app: AppState())
        win.selectChannel("A")
        win.showActivityFeed()
        XCTAssertTrue(win.showActivity)

        win.goBack()
        XCTAssertFalse(win.showActivity)
        XCTAssertEqual(win.selectedChannelId, "A")

        win.goForward()
        XCTAssertTrue(win.showActivity)
    }

    @MainActor
    func testReselectingTheOpenChannelDoesNotGrowTheHistory() {
        let win = WindowState(app: AppState())
        win.selectChannel("A")
        win.selectChannel("B")
        win.selectChannel("B")
        win.goBack()
        XCTAssertEqual(win.selectedChannelId, "A")
        XCTAssertFalse(win.canGoBack)
    }

    /// Clicking the channel you're already on *while the feed covers it* is a
    /// real move — the pane changes — so it records a visit.
    @MainActor
    func testDismissingTheFeedOntoTheSameChannelIsAVisit() {
        let win = WindowState(app: AppState())
        win.selectChannel("A")
        win.showActivityFeed()
        win.selectChannel("A")
        XCTAssertFalse(win.showActivity)
        win.goBack()
        XCTAssertTrue(win.showActivity)
    }

    @MainActor
    func testALeftChannelStopsBeingABackTarget() {
        let win = WindowState(app: AppState())
        win.selectChannel("A")
        win.selectChannel("B")
        win.channelBecameUnavailable("A")
        XCTAssertFalse(win.canGoBack)
        XCTAssertEqual(win.selectedChannelId, "B")
    }

    @MainActor
    func testSwitchingWorkspaceStartsAFreshHistory() {
        let win = WindowState(app: AppState())
        win.selectWorkspace("ws1")
        win.selectChannel("A")
        win.selectChannel("B")
        win.selectWorkspace("ws2")
        XCTAssertFalse(win.canGoBack)
        XCTAssertFalse(win.canGoForward)
    }

    @MainActor
    func testEachWindowKeepsItsOwnHistory() {
        let app = AppState()
        let w1 = WindowState(app: app)
        let w2 = WindowState(app: app)
        w1.selectChannel("A")
        w1.selectChannel("B")
        w2.selectChannel("C")
        XCTAssertTrue(w1.canGoBack)
        XCTAssertFalse(w2.canGoBack)
    }
}

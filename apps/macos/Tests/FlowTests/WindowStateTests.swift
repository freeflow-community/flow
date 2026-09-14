import Foundation
import XCTest

@testable import Flow

/// Per-window selection (multi-window support): each ⌘N window owns a
/// `WindowState`, and the shared `AppState` answers the aggregate questions —
/// "is anyone viewing this channel?", per-workspace badges, sign-out teardown.
/// The reported bug: changing the workspace in one window changed it in both.
final class WindowStateTests: XCTestCase {
    @MainActor
    private func makeAppWithTwoWindows() -> (AppState, WindowState, WindowState) {
        let app = AppState()
        let w1 = WindowState(app: app)
        let w2 = WindowState(app: app)
        return (app, w1, w2)
    }

    /// The bug itself: windows select independently.
    @MainActor
    func testWindowsSelectWorkspacesIndependently() {
        let (_, w1, w2) = makeAppWithTwoWindows()
        w1.selectWorkspace("ws1")
        w2.selectWorkspace("ws2")
        XCTAssertEqual(w1.selectedWorkspaceId, "ws1")
        XCTAssertEqual(w2.selectedWorkspaceId, "ws2")

        w2.selectChannel("c2")
        XCTAssertNil(w1.selectedChannelId)
        XCTAssertEqual(w2.selectedChannelId, "c2")
    }

    @MainActor
    func testOpenSetsAggregateAcrossWindows() {
        let (app, w1, w2) = makeAppWithTwoWindows()
        w1.selectWorkspace("ws1")
        w1.selectChannel("c1")
        w2.selectWorkspace("ws2")
        w2.selectChannel("c2")
        w2.openThread("t2")
        XCTAssertEqual(app.openWorkspaceIds, ["ws1", "ws2"])
        XCTAssertEqual(app.openChannelIds, ["c1", "c2"])
        XCTAssertEqual(app.openThreadRootIds, ["t2"])
        XCTAssertTrue(app.isWorkspaceOpen("ws2"))
        XCTAssertFalse(app.isWorkspaceOpen("ws3"))
    }

    @MainActor
    func testIsViewingAnyWindowCounts() {
        let (app, w1, w2) = makeAppWithTwoWindows()
        w1.selectChannel("c1")
        w2.selectChannel("c2")
        XCTAssertTrue(app.isViewing(channelId: "c1"))
        XCTAssertTrue(app.isViewing(channelId: "c2"))
        XCTAssertFalse(app.isViewing(channelId: "c3"))

        // Covered by the Activity feed = not being looked at (in that window).
        w1.showActivityFeed()
        XCTAssertFalse(app.isViewing(channelId: "c1"))
        XCTAssertTrue(app.isViewing(channelId: "c2"))

        // Backgrounded app: nothing is being looked at.
        app.setAppActive(false)
        XCTAssertFalse(app.isViewing(channelId: "c2"))
    }

    /// A thread reply is only "seen" in a window that is viewing the channel
    /// AND has that thread open — one window's open thread must not mark a
    /// reply read for a window that has the thread closed (and vice versa).
    @MainActor
    func testIsViewingMessageGatesOnTheThreadPerWindow() {
        let (app, w1, w2) = makeAppWithTwoWindows()
        w1.selectChannel("c1")
        w2.selectChannel("c1")
        w2.openThread("t1")

        // Top-level message: visible via either window.
        XCTAssertTrue(app.isViewingMessage(channelId: "c1", threadRootId: nil))
        // Reply in t1: w2 has it open.
        XCTAssertTrue(app.isViewingMessage(channelId: "c1", threadRootId: "t1"))
        // Reply in some other thread: open nowhere.
        XCTAssertFalse(app.isViewingMessage(channelId: "c1", threadRootId: "t9"))

        // Close it in w2: the reply is now behind a closed thread everywhere.
        w2.closeSidePanel()
        XCTAssertFalse(app.isViewingMessage(channelId: "c1", threadRootId: "t1"))
    }

    @MainActor
    func testNotificationCountsArePerWorkspace() {
        let (app, w1, w2) = makeAppWithTwoWindows()
        w1.selectWorkspace("ws1")
        w2.selectWorkspace("ws2")
        app.setNotificationUnread(3, workspaceId: "ws1", total: 5)
        XCTAssertEqual(app.notificationUnread(workspaceId: "ws1"), 3)
        XCTAssertEqual(app.notificationUnread(workspaceId: "ws2"), 0)
        XCTAssertEqual(app.notificationUnreadTotal, 5)
    }

    @MainActor
    func testChannelBecameUnavailableClearsOnlyAffectedWindows() {
        let (app, w1, w2) = makeAppWithTwoWindows()
        w1.selectChannel("c1")
        w2.selectChannel("c2")
        app.channelBecameUnavailable("c1")
        XCTAssertNil(w1.selectedChannelId)
        XCTAssertEqual(w2.selectedChannelId, "c2")
    }

    @MainActor
    func testPermanentRootDeleteClosesThatThreadInEveryMatchingWindow() {
        let (app, w1, w2) = makeAppWithTwoWindows()
        w1.openThread("t1")
        w2.openThread("t2")
        let root = Message(
            id: "t1", channelId: "c1", userId: "bot", threadRootId: nil,
            clientMsgId: "cm1", body: "bot output", createdAt: "2026-08-27T00:00:00Z",
            editedAt: nil, deletedAt: nil, replyCount: 2, lastReplyAt: nil,
            systemKind: nil, pending: false
        )

        app.messagePermanentlyDeleted(root)

        XCTAssertNil(w1.openThreadRootId)
        XCTAssertEqual(w2.openThreadRootId, "t2")
        XCTAssertEqual(app.notificationRevision, 1)
    }

    @MainActor
    func testSignOutClearsEveryWindow() {
        let (app, w1, w2) = makeAppWithTwoWindows()
        w1.selectWorkspace("ws1")
        w1.selectChannel("c1")
        w2.selectWorkspace("ws2")
        app.didSignOut()
        XCTAssertNil(w1.selectedWorkspaceId)
        XCTAssertNil(w1.selectedChannelId)
        XCTAssertNil(w2.selectedWorkspaceId)
    }

    /// A closed window's state simply falls out of the registry (weak refs) —
    /// its selections must stop counting as "open".
    @MainActor
    func testClosedWindowDropsOutOfTheAggregates() {
        let app = AppState()
        let w1 = WindowState(app: app)
        w1.selectChannel("c1")
        do {
            let w2 = WindowState(app: app)
            w2.selectChannel("c2")
            XCTAssertEqual(app.openChannelIds, ["c1", "c2"])
        }
        XCTAssertEqual(app.openChannelIds, ["c1"])
        XCTAssertEqual(app.windows.count, 1)
    }
}

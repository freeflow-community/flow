import Foundation
import XCTest

@testable import Flow

/// Opening a channel used to leave its Activity indicators up until four
/// sequential round trips had completed (#227). These cover the two halves of
/// the fix: the local clear that no longer waits for the network, and the read
/// call that now happens even when the history page comes back empty.
final class ActivityUnreadTests: XCTestCase {
    /// Nothing is listening here, so every request fails immediately — which is
    /// the point: what still happens is what does not depend on the server.
    private let deadURL = URL(string: "http://127.0.0.1:9")!

    private func makeEngine() throws -> (SyncEngine, AppDatabase) {
        let db = try AppDatabase.inMemory()
        let engine = SyncEngine(
            db: db, api: APIClient(baseURL: deadURL), socket: SocketClient(url: deadURL)
        )
        return (engine, db)
    }

    private func insertChannel(
        _ db: AppDatabase, id: String, unreadCount: Int, unreadNotifications: Int
    ) throws {
        try db.writer.write { dbc in
            try dbc.execute(
                sql: """
                    INSERT INTO channel
                        (id, workspaceId, name, kind, isPrivate, createdBy, createdAt,
                         isMember, unreadCount, notifyLevel, unreadNotifications)
                    VALUES (?, 'ws1', 'general', 'standard', 0, 'u1', '2026-08-17', 1, ?, 1, ?)
                    """,
                arguments: [id, unreadCount, unreadNotifications]
            )
        }
    }

    private func insertMessage(_ db: AppDatabase, id: String, channelId: String) throws {
        try db.writer.write { dbc in
            try dbc.execute(
                sql: """
                    INSERT INTO message
                        (id, channelId, userId, clientMsgId, body, createdAt, replyCount, pending)
                    VALUES (?, ?, 'u2', ?, 'hi', '2026-08-17', 0, 0)
                    """,
                arguments: [id, channelId, id]
            )
        }
    }

    private func channelRow(_ db: AppDatabase, _ id: String) throws -> Channel? {
        try db.reader.read { dbc in try Channel.fetchOne(dbc, key: id) }
    }

    func testSelectingAChannelClearsItsActivityBadgeWithoutTheServer() async throws {
        let (engine, db) = try makeEngine()
        try insertChannel(db, id: "c1", unreadCount: 5, unreadNotifications: 3)

        await engine.selectChannel("c1")

        // The history GET failed, so every server-driven path is out — if the
        // badge is clear it is because the local write no longer waits on it.
        XCTAssertEqual(try channelRow(db, "c1")?.unreadNotifications, 0)
    }

    func testSelectingAChannelLeavesOtherChannelsAlone() async throws {
        let (engine, db) = try makeEngine()
        try insertChannel(db, id: "c1", unreadCount: 5, unreadNotifications: 3)
        try insertChannel(db, id: "c2", unreadCount: 1, unreadNotifications: 2)

        await engine.selectChannel("c1")

        XCTAssertEqual(try channelRow(db, "c2")?.unreadNotifications, 2)
    }

    /// The fallback the empty-page path relies on: with no page from the
    /// server, the newest cached top-level message is the cursor to send.
    /// `catchUpRead` takes the same route, so it is what the test can reach.
    func testCatchUpReadAdvancesTheCursorToTheNewestCachedMessage() async throws {
        let (engine, db) = try makeEngine()
        try insertChannel(db, id: "c1", unreadCount: 4, unreadNotifications: 0)
        try insertMessage(db, id: "m1", channelId: "c1")
        try insertMessage(db, id: "m3", channelId: "c1")
        try insertMessage(db, id: "m2", channelId: "c1")

        await engine.catchUpRead(channelId: "c1")

        let row = try channelRow(db, "c1")
        XCTAssertEqual(row?.lastReadMsgId, "m3")
        XCTAssertEqual(row?.unreadCount, 0)
    }

    @MainActor
    func testClearingNotificationsCountsThemOffBothBadges() {
        let app = AppState()
        app.setNotificationUnread(7, workspaceId: "ws1", total: 9)

        app.notificationsCleared(count: 3, workspaceId: "ws1")

        XCTAssertEqual(app.notificationUnread(workspaceId: "ws1"), 4)
        XCTAssertEqual(app.notificationUnreadTotal, 6)
    }

    /// The local count is a guess from the cache; the `notification.read` event
    /// that follows carries the truth. It must never guess its way negative.
    @MainActor
    func testClearingMoreNotificationsThanAreCountedStopsAtZero() {
        let app = AppState()
        app.setNotificationUnread(2, workspaceId: "ws1", total: 2)

        app.notificationsCleared(count: 5, workspaceId: "ws1")

        XCTAssertEqual(app.notificationUnread(workspaceId: "ws1"), 0)
        XCTAssertEqual(app.notificationUnreadTotal, 0)
    }
}

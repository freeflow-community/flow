import Foundation
import XCTest

@testable import Flow

/// Auto-opening the thread that holds a channel's oldest unread (#441 — the
/// macOS/iOS half of #327). The server decides *whether* there is a jump:
/// `oldestUnreadThreadReply` arrives only when the oldest unread is a reply,
/// so the client's own rule is the one thing web also owns — jump on the way
/// into a different channel, never anywhere else.
final class SidebarThreadJumpTests: XCTestCase {
    private func channel(jump: ThreadReplyRef?) -> Channel {
        Channel(
            id: "c1", workspaceId: "w1", name: "general", topic: nil, isPrivate: false,
            createdBy: "u1", createdAt: "2026-08-31T00:00:00Z", archivedAt: nil,
            isMember: true, lastReadMsgId: nil, unreadCount: 0, unreadNotifications: 1,
            unreadThreadRootIds: jump.map { [$0.rootId] },
            oldestUnreadThreadReply: jump
        )
    }

    func testJumpsIntoTheThreadHoldingTheOldestUnread() {
        let jump = channel(jump: ThreadReplyRef(rootId: "root1", replyId: "reply1"))
            .sidebarThreadJump(currentChannelId: "c2")
        XCTAssertEqual(jump?.rootId, "root1")
        XCTAssertEqual(jump?.replyId, "reply1")
    }

    /// Oldest unread is a top-level message, or there are no unreads: the
    /// server sends no target and the tap is an ordinary channel select.
    func testNoTargetIsAPlainSelect() {
        XCTAssertNil(channel(jump: nil).sidebarThreadJump(currentChannelId: "c2"))
    }

    /// The regression this guard exists for: the field stays set while the
    /// reply is unread, so re-tapping the channel already on screen (or any
    /// re-render that re-reads the row) must not yank the user into a thread.
    func testReTappingTheOpenChannelDoesNotJump() {
        let ch = channel(jump: ThreadReplyRef(rootId: "root1", replyId: "reply1"))
        XCTAssertNil(ch.sidebarThreadJump(currentChannelId: "c1"))
    }

    func testJumpsWithNoChannelSelectedYet() {
        let ch = channel(jump: ThreadReplyRef(rootId: "root1", replyId: "reply1"))
        XCTAssertNotNil(ch.sidebarThreadJump(currentChannelId: nil))
    }

    /// The cached row survives a relaunch, so the target has to decode from the
    /// server's JSON and round-trip through the channel cache unchanged.
    func testDecodesFromTheServerPayload() throws {
        let json = """
        {"id":"c1","workspaceId":"w1","name":"general","kind":"standard","isPrivate":false,
         "createdBy":"u1","createdAt":"2026-08-31T00:00:00Z","isMember":true,"unreadCount":0,
         "unreadNotifications":1,"unreadThreadRootIds":["root1"],
         "oldestUnreadThreadReply":{"rootId":"root1","replyId":"reply1"},"notifyLevel":1}
        """.data(using: .utf8)!
        let ch = try JSONDecoder().decode(Channel.self, from: json)
        XCTAssertEqual(ch.oldestUnreadThreadReply, ThreadReplyRef(rootId: "root1", replyId: "reply1"))
    }

    /// Absent (the common case) stays absent rather than decoding as a jump.
    func testAbsentTargetDecodesAsNoJump() throws {
        let json = """
        {"id":"c1","workspaceId":"w1","name":"general","kind":"standard","isPrivate":false,
         "createdBy":"u1","createdAt":"2026-08-31T00:00:00Z","isMember":true,"unreadCount":0,
         "unreadNotifications":0,"notifyLevel":1}
        """.data(using: .utf8)!
        XCTAssertNil(try JSONDecoder().decode(Channel.self, from: json).oldestUnreadThreadReply)
    }
}

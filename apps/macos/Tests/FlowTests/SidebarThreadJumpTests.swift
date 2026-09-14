import Foundation
import XCTest

@testable import Flow

/// Auto-opening the thread that holds a channel's oldest unread (#441 — the
/// macOS/iOS half of #327). The server decides whether there is a jump:
/// `oldestUnreadThreadReply` arrives only when the oldest unread is a reply,
/// and since #533 a tap acts on it wherever the user already is — including the
/// channel already on screen, which is the gesture people reach for when a
/// badge won't clear.
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
        let jump = channel(jump: ThreadReplyRef(rootId: "root1", replyId: "reply1")).sidebarThreadJump
        XCTAssertEqual(jump?.rootId, "root1")
        XCTAssertEqual(jump?.replyId, "reply1")
    }

    /// Oldest unread is a top-level message, or there are no unreads: the
    /// server sends no target and the tap is an ordinary channel select.
    func testNoTargetIsAPlainSelect() {
        XCTAssertNil(channel(jump: nil).sidebarThreadJump)
    }

    /// #533: re-tapping the channel already on screen jumps too. The server
    /// stops sending the target once the visit has read the channel's thread
    /// rows, so this can't loop — and while it is still set, the user tapping a
    /// badged row is asking to be taken to what the badge counts.
    func testReTappingTheOpenChannelStillJumps() {
        let ch = channel(jump: ThreadReplyRef(rootId: "root1", replyId: "reply1"))
        XCTAssertEqual(ch.sidebarThreadJump?.replyId, "reply1")
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

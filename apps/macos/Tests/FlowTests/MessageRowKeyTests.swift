import XCTest

@testable import Flow

/// Rows are keyed on `clientMsgId` (#312), so every scroll target has to be
/// translated out of a message id first — the translation that was missing
/// when jump-to-message and scroll-after-reply stopped working in threads
/// (#329).
final class MessageRowKeyTests: XCTestCase {
    private func message(
        id: String, clientMsgId: String, threadRootId: String? = nil, body: String = "hi"
    ) -> Message {
        Message(
            id: id, channelId: "c1", userId: "u1", threadRootId: threadRootId, clientMsgId: clientMsgId,
            body: body, createdAt: "2026-08-24T00:00:00.000Z", editedAt: nil, deletedAt: nil,
            replyCount: 0, lastReplyAt: nil, pending: false
        )
    }

    func testAMessageIdResolvesToTheRowKeyNotItself() {
        let messages = [message(id: "m1", clientMsgId: "cm1"), message(id: "m2", clientMsgId: "cm2")]

        XCTAssertEqual(messages.rowKey(forMessageId: "m2"), "cm2")
        XCTAssertEqual(messages.firstRowKey, "cm1")
        XCTAssertEqual(messages.lastRowKey, "cm2")
    }

    /// The reason ids can't be scroll targets: an optimistic row and its server
    /// echo are the same row to SwiftUI, under a name neither `id` carries.
    func testTheOptimisticRowAndItsServerEchoShareOneRowKey() {
        let optimistic = [message(id: "local-1", clientMsgId: "cm1")]
        let reconciled = [message(id: "srv-1", clientMsgId: "cm1")]

        XCTAssertEqual(optimistic.lastRowKey, reconciled.lastRowKey)
        XCTAssertEqual(reconciled.rowKey(forMessageId: "srv-1"), optimistic.lastRowKey)
    }

    /// Nil is the "not in this list" answer the call sites used to get from
    /// `contains(where:)` — a jump target that hasn't paged in yet must not
    /// scroll anywhere.
    func testAMessageThatIsNotInTheListHasNoRowKey() {
        let messages = [message(id: "m1", clientMsgId: "cm1")]

        XCTAssertNil(messages.rowKey(forMessageId: "m404"))
        XCTAssertNil([Message]().lastRowKey)
        XCTAssertNil([Message]().firstRowKey)
    }

    /// #620: a Slack thread whose root is a long, block-based app message
    /// (Slack sends no `client_msg_id` for app/bot/API posts, so the connector
    /// normalizes it to `""`) followed by more key-less replies and a human
    /// one. Every row must still have its own identity — duplicates are what
    /// made the thread panel's `LazyVStack` leave viewport-high blank gaps.
    func testASlackThreadOfKeylessMessagesHasOneDistinctRowKeyPerMessage() {
        let longBlocks = (1...40).map { "## Step \($0)\n\n- detail `code` **bold**\n" }.joined(separator: "\n")
        let thread = [
            message(id: "1789600000.000100", clientMsgId: "", body: longBlocks),
            message(id: "1789600060.000200", clientMsgId: "", threadRootId: "1789600000.000100", body: "ok"),
            message(id: "1789600120.000300", clientMsgId: "a1b2c3d4-typed-in-slack", threadRootId: "1789600000.000100"),
            message(id: "1789600180.000400", clientMsgId: "", threadRootId: "1789600000.000100", body: longBlocks),
        ]

        let keys = thread.map(\.rowKey)
        XCTAssertEqual(Set(keys).count, thread.count, "duplicate row identities: \(keys)")
        XCTAssertEqual(keys, ["1789600000.000100", "1789600060.000200", "a1b2c3d4-typed-in-slack", "1789600180.000400"])
        // Scroll targets resolve through the same fallback, so jump-to and
        // stick-to-bottom still land on a key-less row.
        XCTAssertEqual(thread.rowKey(forMessageId: "1789600060.000200"), "1789600060.000200")
        XCTAssertEqual(thread.lastRowKey, "1789600180.000400")
        XCTAssertEqual(thread.firstRowKey, "1789600000.000100")
    }

    /// The fallback is only for an empty key: a Flow row keeps its
    /// `clientMsgId`, so #312's optimistic/echo continuity is untouched.
    func testARowWithAClientMsgIdIsStillKeyedOnIt() {
        XCTAssertEqual(message(id: "srv-1", clientMsgId: "cm1").rowKey, "cm1")
        XCTAssertEqual(message(id: "srv-1", clientMsgId: "").rowKey, "srv-1")
    }
}

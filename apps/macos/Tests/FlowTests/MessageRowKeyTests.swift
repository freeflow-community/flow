import XCTest

@testable import Flow

/// Rows are keyed on `clientMsgId` (#312), so every scroll target has to be
/// translated out of a message id first — the translation that was missing
/// when jump-to-message and scroll-after-reply stopped working in threads
/// (#329).
final class MessageRowKeyTests: XCTestCase {
    private func message(id: String, clientMsgId: String) -> Message {
        Message(
            id: id, channelId: "c1", userId: "u1", threadRootId: nil, clientMsgId: clientMsgId,
            body: "hi", createdAt: "2026-08-24T00:00:00.000Z", editedAt: nil, deletedAt: nil,
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
}

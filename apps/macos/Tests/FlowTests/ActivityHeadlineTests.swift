import XCTest

@testable import Flow

// Activity rows name the channel they came from (#267). Without it, rows from
// several busy channels are indistinguishable until you click one.
final class ActivityHeadlineTests: XCTestCase {
    private func item(kind: Int, emoji: String? = nil) throws -> NotificationItem {
        let em = emoji.map { "\"\($0)\"" } ?? "null"
        let json = """
            {"id":"n1","userId":"u1","messageId":"m1","channelId":"c1","workspaceId":"w1",
             "kind":\(kind),"actorId":"u2","reactionEmoji":\(em),"createdAt":"2026-08-17T00:00:00Z",
             "readAt":null,
             "message":{"id":"m1","channelId":"c1","userId":"u2","clientMsgId":"cm1",
                        "body":"hi","createdAt":"2026-08-17T00:00:00Z"}}
            """
        return try JSONDecoder().decode(NotificationItem.self, from: Data(json.utf8))
    }

    func testNamesTheChannel() throws {
        XCTAssertEqual(
            try item(kind: 2).headline(sender: "CypressBot", channelName: "bugs"),
            "CypressBot replied in a thread in #bugs"
        )
        XCTAssertEqual(
            try item(kind: 3).headline(sender: "Scott", channelName: "bugs"),
            "Scott posted in #bugs"
        )
        XCTAssertEqual(
            try item(kind: 0).headline(sender: "Scott", channelName: "bugs"),
            "Scott mentioned you in #bugs"
        )
        XCTAssertEqual(
            try item(kind: 4, emoji: "🎉").headline(sender: "Scott", channelName: "bugs"),
            "Scott reacted 🎉 to your message in #bugs"
        )
    }

    func testLeavesDMRowsAlone() throws {
        // A DM row already says where it came from.
        XCTAssertEqual(
            try item(kind: 1).headline(sender: "Scott", channelName: nil),
            "Scott sent you a direct message"
        )
    }

    func testOmitsTheSuffixWhenTheChannelIsUnknown() throws {
        // A row whose channel isn't in the local DB must still render.
        XCTAssertEqual(
            try item(kind: 2).headline(sender: "Scott", channelName: nil),
            "Scott replied in a thread"
        )
    }

    func testKeepsTheMissingEmojiSpacingFix() throws {
        XCTAssertEqual(
            try item(kind: 4).headline(sender: "Scott", channelName: "bugs"),
            "Scott reacted to your message in #bugs"
        )
    }

    // #303: kind 5 is "someone added me to a channel". An unknown kind falls
    // through to "mentioned you", so without a case here the invite row would
    // read as a mention that never happened.
    func testChannelInviteNamesTheChannel() throws {
        XCTAssertEqual(
            try item(kind: 5).headline(sender: "Amara", channelName: "design-review"),
            "Amara added you to #design-review"
        )
    }

    func testChannelInviteWithoutAKnownChannel() throws {
        // "added you in #x" would be the wrong preposition, so the suffix
        // machinery is bypassed for this kind — check the fallback reads right.
        XCTAssertEqual(
            try item(kind: 5).headline(sender: "Amara", channelName: nil),
            "Amara added you to a channel"
        )
    }
}

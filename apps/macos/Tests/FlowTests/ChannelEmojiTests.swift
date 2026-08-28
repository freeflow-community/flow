import XCTest

@testable import Flow

// Channel emoji (#396). The mirror image of ChannelIndicatorTests: this one IS
// part of the cached `Channel` row — it's a server column, so a relaunch that
// draws yesterday's emoji is drawing the truth — and the event decodes into a
// set/clear the sidebar can act on.
final class ChannelEmojiTests: XCTestCase {
    private func channelJSON(id: String, emoji: String?) -> String {
        let e = emoji.map { "\"emoji\":\"\($0)\"," } ?? ""
        return """
            {"id":"\(id)","workspaceId":"w1","name":"\(id)","kind":"standard","topic":null,
             "isPrivate":false,"createdBy":"u1","createdAt":"2026-07-29T00:00:00Z","archivedAt":null,
             \(e)"isMember":true,"lastReadMsgId":null,"unreadCount":0,"unreadNotifications":0,
             "notifyLevel":1,"parentId":null}
            """
    }

    private func decodeChannels(_ json: String) throws -> ChannelsResponse {
        try JSONDecoder().decode(ChannelsResponse.self, from: Data(json.utf8))
    }

    func testReadsTheEmojiOffTheChannelList() throws {
        let resp = try decodeChannels(
            "{\"channels\":[\(channelJSON(id: "a", emoji: "🔥")),\(channelJSON(id: "b", emoji: nil))]}"
        )
        XCTAssertEqual(resp.channels[0].emoji, "🔥")
        XCTAssertNil(resp.channels[1].emoji)
    }

    func testAServerWithoutTheFieldStillDecodes() throws {
        let resp = try decodeChannels("{\"channels\":[\(channelJSON(id: "a", emoji: nil))]}")
        XCTAssertEqual(resp.channels.first?.id, "a")
        XCTAssertNil(resp.channels.first?.emoji)
    }

    func testTheEmojiIsPartOfTheCachedChannelRow() throws {
        // The opposite of the spinner (#137): this one must survive a relaunch,
        // so it has to encode into the local database with the rest of the row.
        let resp = try decodeChannels("{\"channels\":[\(channelJSON(id: "a", emoji: "🚧"))]}")
        let encoded = try JSONEncoder().encode(resp.channels[0])
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(obj["emoji"] as? String, "🚧")
    }

    func testDecodesTheEventAsSetAndClear() throws {
        let set = try JSONDecoder().decode(
            EventDTO.self,
            from: Data(
                """
                {"type":"channel.emoji","workspaceId":"w1","channelId":"c1",
                 "ts":"2026-08-27T00:00:00Z","data":{"channelId":"c1","emoji":"🔥"}}
                """.utf8))
        guard case .channelEmoji(let on) = set.payload else {
            return XCTFail("expected a channelEmoji payload")
        }
        XCTAssertEqual(on.channelId, "c1")
        XCTAssertEqual(on.emoji, "🔥")

        let cleared = try JSONDecoder().decode(
            EventDTO.self,
            from: Data(
                """
                {"type":"channel.emoji","workspaceId":"w1","channelId":"c1",
                 "ts":"2026-08-27T00:00:00Z","data":{"channelId":"c1","emoji":null}}
                """.utf8))
        guard case .channelEmoji(let off) = cleared.payload else {
            return XCTFail("expected a channelEmoji payload")
        }
        XCTAssertNil(off.emoji)
    }

    func testAZWJSequenceSurvivesTheRoundTrip() throws {
        // Skin tones and ZWJ sequences are several code points rendering as one
        // glyph; nothing in the client may split or truncate them.
        let resp = try decodeChannels("{\"channels\":[\(channelJSON(id: "a", emoji: "👩🏽‍🚀"))]}")
        XCTAssertEqual(resp.channels[0].emoji, "👩🏽‍🚀")
    }
}

import XCTest

@testable import Flow

// Channel activity indicators (#137). Two things have to hold: the transient
// state is read off the channel list without becoming part of the cached
// `Channel` row (a spinner must not survive a relaunch), and the event decodes
// into a set/clear the sidebar can act on.
final class ChannelIndicatorTests: XCTestCase {
    private func decodeChannels(_ json: String) throws -> ChannelsResponse {
        try JSONDecoder().decode(ChannelsResponse.self, from: Data(json.utf8))
    }

    private func channelJSON(id: String, indicator: String?) -> String {
        let ind = indicator.map { "\"indicator\":\"\($0)\"," } ?? ""
        return """
            {"id":"\(id)","workspaceId":"w1","name":"\(id)","kind":"standard","topic":null,
             "isPrivate":false,"createdBy":"u1","createdAt":"2026-07-29T00:00:00Z","archivedAt":null,
             \(ind)"isMember":true,"lastReadMsgId":null,"unreadCount":0,"unreadNotifications":0,
             "notifyLevel":1,"parentId":null}
            """
    }

    func testReadsBusyChannelsOffTheList() throws {
        let resp = try decodeChannels(
            "{\"channels\":[\(channelJSON(id: "a", indicator: "busy")),\(channelJSON(id: "b", indicator: nil))]}"
        )
        XCTAssertEqual(resp.channels.count, 2)
        XCTAssertEqual(resp.busyChannelIds, ["a"])
    }

    func testAnOlderServerSendsNoIndicatorAtAll() throws {
        // The field is new; a server without it must not fail the whole fetch.
        let resp = try decodeChannels("{\"channels\":[\(channelJSON(id: "a", indicator: nil))]}")
        XCTAssertTrue(resp.busyChannelIds.isEmpty)
        XCTAssertEqual(resp.channels.first?.id, "a")
    }

    func testTheSpinnerIsNotPartOfTheCachedChannelRow() throws {
        // Channel rows are persisted; encoding one must not carry a spinner
        // into the local database, where it would outlive the run that set it.
        let resp = try decodeChannels("{\"channels\":[\(channelJSON(id: "a", indicator: "busy"))]}")
        let encoded = try JSONEncoder().encode(resp.channels[0])
        let keys = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]).keys
        XCTAssertFalse(keys.contains("indicator"))
    }

    func testDecodesTheEventAsSetAndClear() throws {
        let on = try JSONDecoder().decode(
            EventDTO.self,
            from: Data(
                """
                {"type":"channel.indicator","workspaceId":"w1","channelId":"c1",
                 "ts":"2026-07-29T00:00:00Z","data":{"channelId":"c1","state":"busy"}}
                """.utf8))
        guard case .channelIndicator(let set) = on.payload else {
            return XCTFail("expected a channelIndicator payload")
        }
        XCTAssertEqual(set.channelId, "c1")
        XCTAssertEqual(set.state, "busy")

        let off = try JSONDecoder().decode(
            EventDTO.self,
            from: Data(
                """
                {"type":"channel.indicator","workspaceId":"w1","channelId":"c1",
                 "ts":"2026-07-29T00:00:00Z","data":{"channelId":"c1","state":null}}
                """.utf8))
        guard case .channelIndicator(let cleared) = off.payload else {
            return XCTFail("expected a channelIndicator payload")
        }
        XCTAssertNil(cleared.state)
    }

    @MainActor
    func testStateTracksSetsAndClears() {
        let app = AppState()
        app.channelIndicatorReceived(channelId: "c1", busy: true)
        app.channelIndicatorReceived(channelId: "c2", busy: true)
        XCTAssertEqual(app.busyChannelIds, ["c1", "c2"])

        app.channelIndicatorReceived(channelId: "c1", busy: false)
        XCTAssertEqual(app.busyChannelIds, ["c2"])

        // A refresh is authoritative — it's how a client that slept through the
        // events catches up.
        app.setBusyChannelIds(["c3"])
        XCTAssertEqual(app.busyChannelIds, ["c3"])
    }
}

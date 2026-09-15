import XCTest
@testable import Flow

/// The channel browser's filter and read-only rules (#590) — mirroring web's
/// `ChannelBrowserView.test.tsx` (#588) so all three clients narrow alike.
final class ChannelBrowserTests: XCTestCase {
    private func row(
        _ name: String?, topic: String? = nil, kind: String = "standard", isPrivate: Bool = false,
        archived: Bool = false, isMember: Bool = false, members: Int = 1
    ) -> BrowsableChannel {
        BrowsableChannel(
            channel: Channel(
                id: "c-\(name ?? UUID().uuidString)", workspaceId: "w", name: name, kind: kind, topic: topic,
                isPrivate: isPrivate, createdBy: "u", createdAt: "2026-01-01T00:00:00Z",
                archivedAt: archived ? "2026-02-01T00:00:00Z" : nil,
                isMember: isMember, lastReadMsgId: nil, unreadCount: 0
            ),
            memberCount: members
        )
    }

    func testPublicStandardOnlySortedByName() {
        let rows = [
            row("zeta"), row("Alpha"), row("secret", isPrivate: true),
            row(nil, kind: "dm"), row("beta"),
        ]
        let names = ChannelBrowser.filter(rows, query: "", includeArchived: false).map(\.channel.name)
        XCTAssertEqual(names, ["Alpha", "beta", "zeta"])
    }

    func testArchivedHiddenUntilIncludedAndSortedInPlace() {
        let rows = [row("general"), row("attic", archived: true), row("random")]
        XCTAssertEqual(
            ChannelBrowser.filter(rows, query: "", includeArchived: false).map(\.channel.name),
            ["general", "random"]
        )
        XCTAssertEqual(
            ChannelBrowser.filter(rows, query: "", includeArchived: true).map(\.channel.name),
            ["attic", "general", "random"]
        )
    }

    func testSearchMatchesNameOrTopicCaseInsensitively() {
        let rows = [row("design", topic: "Pixels"), row("eng", topic: "Build things"), row("random")]
        XCTAssertEqual(ChannelBrowser.filter(rows, query: "  DES ", includeArchived: false).map(\.channel.name), ["design"])
        XCTAssertEqual(ChannelBrowser.filter(rows, query: "build", includeArchived: false).map(\.channel.name), ["eng"])
        XCTAssertTrue(ChannelBrowser.filter(rows, query: "nope", includeArchived: false).isEmpty)
    }

    func testDecodesMemberCountAlongsideTheChannel() throws {
        let json = """
        {"channels":[{"id":"c1","workspaceId":"w","name":"general","kind":"standard","isPrivate":false,
          "createdBy":"u","createdAt":"2026-01-01T00:00:00Z","archivedAt":null,"isMember":true,"memberCount":7}]}
        """
        let resp = try JSONDecoder().decode(BrowsableChannelsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(resp.channels.first?.memberCount, 7)
        XCTAssertEqual(resp.channels.first?.channel.name, "general")
    }

    func testLabelsAndEmptyStates() {
        XCTAssertEqual(ChannelBrowser.countLabel(1), "1 channel")
        XCTAssertEqual(ChannelBrowser.memberLabel(3), "3 members")
        XCTAssertEqual(ChannelBrowser.emptyMessage(total: 0, shown: 0, loading: true, query: ""), "Loading…")
        XCTAssertEqual(ChannelBrowser.emptyMessage(total: 2, shown: 0, loading: false, query: "x"), "No channels match “x”.")
        XCTAssertNil(ChannelBrowser.emptyMessage(total: 2, shown: 2, loading: false, query: ""))
    }

    func testArchivedCapabilitiesBlockWritesButKeepReads() {
        let caps = Capabilities.allSupported.archivedReadOnly()
        for name: CapabilityName in [.send, .edit, .delete, .reactions, .pins, .huddles, .channelManagement] {
            XCTAssertFalse(caps.canUse(name), "\(name) should be blocked")
        }
        for name: CapabilityName in [.history, .threads, .files, .search] {
            XCTAssertTrue(caps.canUse(name), "\(name) should stay readable")
        }
    }

    func testChannelRowNotHighlightedUnderTheBrowser() {
        XCTAssertFalse(AppState.channelRowHighlighted(
            rowId: "c", selectedChannelId: "c", selectedArtifactId: nil, showActivity: false,
            showChannelBrowser: true
        ))
    }
}

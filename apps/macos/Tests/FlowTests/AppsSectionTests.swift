import XCTest
@testable import Flow

/// The Apps sidebar section (#394). The rule that matters is that a *public*
/// channel's app is listed whether or not you've joined it — that is what makes
/// apps discoverable — while an app with no local channel is dropped rather than
/// rendered as a row that can't go anywhere.
final class AppsSectionTests: XCTestCase {
    private let me = "me"

    private func channel(_ id: String, name: String?, isMember: Bool = true, kind: String = "standard",
                         isPrivate: Bool = false, memberIds: [String]? = nil) -> Channel {
        Channel(
            id: id, workspaceId: "w", name: name, kind: kind, topic: nil, isPrivate: isPrivate,
            createdBy: me, createdAt: "", archivedAt: nil, isMember: isMember, lastReadMsgId: nil,
            unreadCount: 0, unreadNotifications: 0, unreadThreadRootIds: nil, notifyLevel: 2,
            parentId: nil, memberIds: memberIds
        )
    }

    private func app(_ id: String, _ name: String, channelId: String) -> Artifact {
        Artifact(
            id: id, workspaceId: "w", channelId: channelId, kind: "link", fileId: nil,
            url: "https://app.example.com/", name: name, ownsFile: false, isApp: true,
            createdAt: "", updatedAt: "", file: nil
        )
    }

    func testPairsEachAppWithItsHostChannelInServerOrder() {
        let entries = AppsSection.entries(
            apps: [app("a1", "Task Board", channelId: "factory"), app("a2", "Zoo", channelId: "general")],
            channels: [channel("general", name: "general"), channel("factory", name: "factory")]
        )
        XCTAssertEqual(entries.map(\.artifact.name), ["Task Board", "Zoo"])
        XCTAssertEqual(entries.map(\.channel.id), ["factory", "general"])
    }

    func testListsAnAppFromAPublicChannelTheUserHasNotJoined() {
        let entries = AppsSection.entries(
            apps: [app("a1", "Task Board", channelId: "factory")],
            channels: [channel("factory", name: "factory", isMember: false)]
        )
        XCTAssertEqual(entries.count, 1)
        XCTAssertFalse(entries[0].channel.isMember) // clicking it joins first
    }

    func testRowIdentityDoesNotCollideWithTheNestedArtifactRow() {
        // The same app also renders under its channel; both rows share one
        // LazyVStack, so identical ids make SwiftUI drop one of them.
        let entries = AppsSection.entries(
            apps: [app("a1", "Task Board", channelId: "factory")],
            channels: [channel("factory", name: "factory")]
        )
        XCTAssertNotEqual(entries[0].id, entries[0].artifact.id)
        XCTAssertEqual(entries[0].id, "app-a1")
    }

    func testDropsAnAppWhoseChannelIsNotKnownLocally() {
        let entries = AppsSection.entries(
            apps: [app("a1", "Ghost", channelId: "gone")],
            channels: [channel("general", name: "general")]
        )
        XCTAssertTrue(entries.isEmpty)
    }

    func testChannelLabelNamesAChannelWithAHashAndADmByItsMembers() {
        XCTAssertEqual(
            AppsSection.channelLabel(channel("c", name: "factory"), userNames: [:], currentUserId: me),
            "#factory"
        )
        let dm = channel("d", name: nil, kind: "dm", isPrivate: true, memberIds: [me, "u2"])
        XCTAssertEqual(
            AppsSection.channelLabel(dm, userNames: ["u2": "Prism"], currentUserId: me),
            "Prism"
        )
    }

    func testAppArtifactsGetAPuzzlePieceGlyphRatherThanTheLinkGlyph() {
        XCTAssertEqual(app("a1", "Task Board", channelId: "c").glyph, "🧩")
        let plainLink = Artifact(
            id: "a2", workspaceId: "w", channelId: "c", kind: "link", fileId: nil,
            url: "https://example.com/", name: "Docs", ownsFile: false, isApp: false,
            createdAt: "", updatedAt: "", file: nil
        )
        XCTAssertEqual(plainLink.glyph, "🔗")
    }
}

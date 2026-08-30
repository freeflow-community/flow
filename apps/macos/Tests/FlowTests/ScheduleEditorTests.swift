import Foundation
import XCTest

@testable import Flow

/// The rules behind the create/edit schedule sheet (#424) — what an editor
/// opens with, and which destination stays selected when the channel list is
/// re-read.
///
/// Compiled into the iOS unit-test target as well as macOS: this is the shared
/// layer both apps bind to, and the bug these cover only ever showed up on one
/// of them.
final class ScheduleEditorTests: XCTestCase {
    private func row(id: String = "row1", channelId: String, body: String = "hi") -> ScheduledMessage {
        ScheduledMessage(
            id: id, workspaceId: "w1", channelId: channelId, authorUserId: "u1", body: body,
            recurrence: .daily(hour: 9, minute: 0), timezone: "America/Los_Angeles",
            nextRunAt: nil, enabled: true, lastRunAt: nil, lastRunStatus: nil,
            lastMessageId: nil, lastError: nil, createdAt: "", updatedAt: "", canManage: true
        )
    }

    private func choices(_ ids: [String]) -> [ScheduleDestinations.Choice] {
        ids.map { .init(id: $0, label: "# \($0)", tag: "Shared") }
    }

    // MARK: - What the sheet opens with

    func testCreatingCarriesTheComposersDraftAndConversation() {
        let target = ScheduleEditorTarget.creating(body: "standup?", channelId: "c9")
        XCTAssertEqual(target.initialBody, "standup?")
        XCTAssertEqual(target.preferredChannelId, "c9")
    }

    func testEditingOpensOnTheRowsOwnBodyAndChannel() {
        let target = ScheduleEditorTarget.editing(row(channelId: "c3", body: "digest"))
        XCTAssertEqual(target.initialBody, "digest")
        XCTAssertEqual(target.preferredChannelId, "c3")
    }

    func testCreatingFromThePanelHasNoPreferredChannel() {
        let target = ScheduleEditorTarget.creating(body: "", channelId: nil)
        XCTAssertEqual(target.initialBody, "")
        XCTAssertNil(target.preferredChannelId)
    }

    // MARK: - Which destination survives a refresh

    /// The regression. `load()` re-reads the channel list every time the sheet's
    /// view reappears, and on iOS the "Post to" picker is a `.navigationLink` —
    /// so choosing a channel pushes a screen and pops straight back into that
    /// re-read. Re-applying `preferred` there threw away the very choice the
    /// person had just walked into the picker to make (and, when the sheet also
    /// re-seeded the body, wiped what they had typed).
    func testAChosenDestinationSurvivesTheListBeingReRead() {
        let resolved = ScheduleDestinations.resolve(
            current: "c2", preferred: "c1", choices: choices(["c1", "c2", "c3"])
        )
        XCTAssertEqual(resolved, "c2")
    }

    func testFirstResolveTakesThePreferredChannel() {
        let resolved = ScheduleDestinations.resolve(
            current: "", preferred: "c3", choices: choices(["c1", "c2", "c3"])
        )
        XCTAssertEqual(resolved, "c3")
    }

    func testNoPreferenceFallsBackToTheFirstChoice() {
        let resolved = ScheduleDestinations.resolve(
            current: "", preferred: nil, choices: choices(["c1", "c2"])
        )
        XCTAssertEqual(resolved, "c1")
    }

    /// The composer can sit in a conversation the picker does not offer — a
    /// group DM. That must land on a real choice, not leave the sheet unable
    /// to save.
    func testAPreferenceThatIsNotOfferedFallsBackToTheFirstChoice() {
        let resolved = ScheduleDestinations.resolve(
            current: "", preferred: "group-dm", choices: choices(["c1", "c2"])
        )
        XCTAssertEqual(resolved, "c1")
    }

    /// A selection that has gone away (channel left or archived between reads)
    /// must not be kept — it would save into somewhere the picker no longer
    /// shows.
    func testASelectionThatIsNoLongerOfferedIsReplaced() {
        let resolved = ScheduleDestinations.resolve(
            current: "gone", preferred: "c2", choices: choices(["c1", "c2"])
        )
        XCTAssertEqual(resolved, "c2")
    }

    func testNoChoicesAtAllResolvesToEmptyRatherThanCrashing() {
        XCTAssertEqual(
            ScheduleDestinations.resolve(current: "c1", preferred: "c2", choices: []), ""
        )
    }

    // MARK: - The choice list itself

    func testJustMeLeadsAndChannelsFollowByName() {
        let me = "u1"
        let selfDm = Channel(
            id: "dm", workspaceId: "w1", name: nil, kind: "dm", topic: nil, isPrivate: true,
            createdBy: me, createdAt: "", archivedAt: nil, isMember: true, lastReadMsgId: nil,
            unreadCount: 0, unreadNotifications: 0, notifyLevel: 1, memberIds: [me]
        )
        func channel(_ id: String, _ name: String, archived: String? = nil, member: Bool = true) -> Channel {
            Channel(
                id: id, workspaceId: "w1", name: name, kind: "standard", topic: nil,
                isPrivate: false, createdBy: me, createdAt: "", archivedAt: archived,
                isMember: member, lastReadMsgId: nil, unreadCount: 0, unreadNotifications: 0,
                notifyLevel: 1, memberIds: nil
            )
        }
        let list = ScheduleDestinations.choices(
            channels: [
                channel("c2", "zulu"),
                channel("c1", "alpha"),
                channel("c3", "archived", archived: "2026-01-01T00:00:00Z"),
                channel("c4", "not-joined", member: false),
                selfDm,
            ],
            me: me
        )
        XCTAssertEqual(list.map(\.id), ["dm", "c1", "c2"])
        XCTAssertEqual(list.first?.label, "🔒 Just me")
        XCTAssertEqual(list.first?.tag, "Personal")
    }
}

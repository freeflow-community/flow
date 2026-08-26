import XCTest
@testable import Flow

/// The Agents sidebar section (#361). The rule the section rests on is "listed
/// once, never twice": an agent's 1:1 DM moves out of Direct messages and up
/// onto the agent's row, so a workspace agent has exactly one place in the nav
/// whether or not the conversation exists yet.
final class AgentSectionTests: XCTestCase {
    private struct Row: SidebarAgentMemberInfo {
        var userId: String
        var displayName: String
        var isAgent: Bool?
    }

    private let me = "me"
    private func agent(_ id: String, _ name: String) -> Row {
        Row(userId: id, displayName: name, isAgent: true)
    }
    private func human(_ id: String, _ name: String) -> Row {
        Row(userId: id, displayName: name, isAgent: false)
    }
    private func dm(_ id: String, _ memberIds: [String], kind: String = "dm") -> Channel {
        Channel(
            id: id, workspaceId: "w", name: nil, kind: kind, topic: nil, isPrivate: true,
            createdBy: me, createdAt: "", archivedAt: nil, isMember: true, lastReadMsgId: nil,
            unreadCount: 0, unreadNotifications: 0, unreadThreadRootIds: nil, notifyLevel: 2,
            parentId: nil, memberIds: memberIds
        )
    }

    func testAnAgentWithNoDmStillGetsARow() {
        let split = AgentSection.split(
            dms: [], members: [agent("a1", "Prism"), human("u1", "Scott")], currentUserId: me
        )
        XCTAssertEqual(split.agents.map(\.member.userId), ["a1"])
        XCTAssertNil(split.agents[0].channel)
        XCTAssertTrue(split.rest.isEmpty)
    }

    func testAnAgentDmMovesOutOfTheDmList() {
        let split = AgentSection.split(
            dms: [dm("d1", [me, "a1"]), dm("d2", [me, "u1"])],
            members: [agent("a1", "Prism"), human("u1", "Scott")],
            currentUserId: me
        )
        // The channel rides along, so the unread badge renders on the agent row.
        XCTAssertEqual(split.agents[0].channel?.id, "d1")
        XCTAssertEqual(split.rest.map(\.id), ["d2"])
    }

    func testAgentsSortAlphabeticallyIgnoringCase() {
        let split = AgentSection.split(
            dms: [], members: [agent("a1", "Prism"), agent("a2", "builder")], currentUserId: me
        )
        XCTAssertEqual(split.agents.map(\.member.displayName), ["builder", "Prism"])
    }

    func testAGroupDmStaysUnderDirectMessages() {
        // Several people talking is a conversation, not a way to reach the agent.
        let split = AgentSection.split(
            dms: [dm("g1", [me, "a1", "u1"], kind: "group_dm")],
            members: [agent("a1", "Prism"), human("u1", "Scott")],
            currentUserId: me
        )
        XCTAssertEqual(split.rest.map(\.id), ["g1"])
        XCTAssertNil(split.agents[0].channel)
    }

    func testTheSelfDmStaysUnderDirectMessages() {
        // Even when you are yourself an agent: it's a scratchpad, not a chat.
        let split = AgentSection.split(
            dms: [dm("s1", [me])], members: [agent(me, "Me"), agent("a1", "Prism")], currentUserId: me
        )
        XCTAssertEqual(split.rest.map(\.id), ["s1"])
        XCTAssertEqual(split.agents.map(\.member.userId), ["a1"])
    }

    func testAWorkspaceOfHumansHasNoAgentsSection() {
        let split = AgentSection.split(
            dms: [dm("d2", [me, "u1"])], members: [human("u1", "Scott")], currentUserId: me
        )
        XCTAssertTrue(split.agents.isEmpty)
        XCTAssertEqual(split.rest.count, 1)
    }
}

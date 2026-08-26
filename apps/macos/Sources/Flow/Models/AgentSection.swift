import Foundation

/// What the Agents sidebar section (#361) needs to know about a workspace
/// member. macOS and iOS each fetch their roster differently, so they conform
/// their own row model rather than sharing one.
protocol SidebarAgentMemberInfo {
    var userId: String { get }
    var displayName: String { get }
    var isAgent: Bool? { get }
}

/// The Agents section: every agent in the workspace gets a row between
/// Channels and Direct messages, whether or not a DM with it exists yet — and
/// the agent's 1:1 DM comes up here with it, so an agent is listed once and
/// never twice.
///
/// A *group* DM that happens to include an agent stays under Direct messages:
/// it's a conversation with several people, not a way to reach the agent. So
/// does the self-DM, even if you are yourself an agent.
enum AgentSection {
    struct Entry<Member: SidebarAgentMemberInfo>: Identifiable {
        let member: Member
        /// The existing 1:1 DM with this agent — nil until one is created.
        let channel: Channel?
        var id: String { member.userId }
    }

    static func split<Member: SidebarAgentMemberInfo>(
        dms: [Channel],
        members: [Member],
        currentUserId: String?
    ) -> (agents: [Entry<Member>], rest: [Channel]) {
        let agentIds = Set(
            members.filter { $0.isAgent == true && $0.userId != currentUserId }.map(\.userId)
        )
        var dmWith: [String: Channel] = [:]
        var rest: [Channel] = []
        for channel in dms {
            let others = (channel.memberIds ?? []).filter { $0 != currentUserId }
            let agentId = channel.kind == "dm" && others.count == 1 && agentIds.contains(others[0])
                ? others[0] : nil
            // Duplicate 1:1 rows shouldn't exist (the server dedupes by member
            // set), but if one ever does the extra stays under Direct messages
            // rather than vanishing.
            if let agentId, dmWith[agentId] == nil {
                dmWith[agentId] = channel
            } else {
                rest.append(channel)
            }
        }
        let agents = members
            .filter { agentIds.contains($0.userId) }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
            .map { Entry(member: $0, channel: dmWith[$0.userId]) }
        return (agents, rest)
    }
}

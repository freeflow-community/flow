import Foundation

/// Just enough of a member row to answer "is this workspace down to one
/// person?". macOS's `MemberInfo` and iOS's `WorkspaceRosterEntry` both
/// conform, so the rule below has one implementation for both.
protocol WorkspaceRosterMember {
    var userId: String { get }
    var isAgent: Bool? { get }
    var isBot: Bool? { get }
}

/// Which way out of a workspace the menu offers (#340).
///
/// One named rule rather than a predicate written out in each client, because
/// it has to agree with the server's delete guard — a client that decides
/// differently either hides a legitimate action or offers one the server will
/// refuse.
enum WorkspaceExit: Equatable {
    /// Anyone but the owner: just go.
    case leave
    /// Owner with company — there is somebody to hand the workspace to, so
    /// leaving is refused until they do.
    case transferFirst
    /// Owner alone — nobody to hand it to, so ending it is the only way out.
    case delete

    /// `roster` is the workspace's *cached* member list, and it reads empty
    /// until the members fetch for that workspace lands. Empty therefore means
    /// "don't know yet", never "nobody else here": concluding the latter
    /// offered Delete on workspaces full of people, the server refused with
    /// 409, and on iOS the refusal wasn't even visible. So `.delete` is only
    /// returned for a roster that positively contains `me`; anything less
    /// falls back to a non-destructive answer.
    static func offered(
        role: String?,
        roster: [some WorkspaceRosterMember],
        me: String?
    ) -> WorkspaceExit {
        guard role == "owner" else { return .leave }
        guard let me, roster.contains(where: { $0.userId == me }) else { return .transferFirst }
        let others = roster.contains { $0.userId != me && $0.isAgent != true && $0.isBot != true }
        return others ? .transferFirst : .delete
    }
}

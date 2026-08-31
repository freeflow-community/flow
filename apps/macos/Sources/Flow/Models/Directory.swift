import Foundation
import GRDB

/// What a Directory card knows about one member (#432).
///
/// A protocol rather than the concrete row below so the rules can be tested
/// against a plain struct, the way `AgentSection` and `WorkspaceExit` already
/// are. Everything a card draws is here, so the rules and the card body have
/// one source.
protocol DirectoryMember {
    var userId: String { get }
    var displayName: String { get }
    var email: String { get }
    var role: String { get }
    var statusEmoji: String? { get }
    var statusText: String? { get }
    /// The member's own one-line title (#434). nil or "" = unset.
    var title: String? { get }
    var isAgent: Bool? { get }
    var isBot: Bool? { get }
    /// Agents only: the human member who sponsored them.
    var sponsorId: String? { get }
}

/// One card's worth of the roster (member ⋈ user), read straight from the
/// local cache the sidebar already keeps warm — so the grid draws with no
/// fetch. macOS and iOS run the identical query, so unlike the sidebar's row
/// models this one is shared.
struct DirectoryRow: Decodable, FetchableRecord, Equatable, Sendable, Identifiable, DirectoryMember {
    var userId: String
    var displayName: String
    var email: String
    var role: String
    var avatarUrl: String?
    var statusEmoji: String?
    var statusText: String?
    var title: String?
    var isAgent: Bool?
    var isBot: Bool?
    var sponsorId: String?
    var id: String { userId }

    /// The `member ⋈ user` read behind the grid. One SQL string rather than two
    /// copies that can drift into disagreeing about what a card shows.
    static let rosterSQL = """
        SELECT m.userId AS userId, u.displayName AS displayName, u.email AS email,
               m.role AS role, u.avatarUrl AS avatarUrl,
               u.statusEmoji AS statusEmoji, u.statusText AS statusText,
               u.title AS title,
               u.isAgent AS isAgent, u.isBot AS isBot, u.sponsorId AS sponsorId
        FROM member m JOIN user u ON u.id = m.userId
        WHERE m.workspaceId = ?
        ORDER BY u.displayName COLLATE NOCASE
        """
}

/// The Directory (#432) — the browsable grid of everyone in the workspace, in
/// parity with the web client's `DirectoryView` (#430).
///
/// The search rule lives here rather than in either view because the two
/// clients must narrow identically: a person who finds a colleague by typing
/// "scottp" on the Mac has to find them the same way on the phone.
enum Directory {
    /// Case-insensitive substring over the display name, plus the email's local
    /// part so searching "scottp" finds Scott. The domain is deliberately not
    /// matched — every human in a workspace tends to share one, so it would
    /// turn a search into "everyone".
    ///
    /// Agents and app bots carry a synthetic address
    /// (`agent-<uuid>@agents.flow.local`) nobody can write to, so theirs is left
    /// out entirely: matching one could only ever be an accident.
    ///
    /// Humans and agents sort together alphabetically. The Directory answers
    /// "who is here", and splitting it by kind would bury an agent you were
    /// looking for behind every human.
    static func filter<Member: DirectoryMember>(_ rows: [Member], query: String) -> [Member] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return rows
            .filter { matches($0, q) }
            .sorted {
                $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
            }
    }

    /// `q` is already trimmed + lowercased by `filter`.
    private static func matches(_ m: some DirectoryMember, _ q: String) -> Bool {
        guard !q.isEmpty else { return true }
        if m.displayName.lowercased().contains(q) { return true }
        guard m.isAgent != true, m.isBot != true else { return false }
        return emailLocalPart(m.email).contains(q)
    }

    /// The part before the first `@`, lowercased. An address with no `@` is its
    /// own local part rather than nothing, so a malformed row stays findable.
    static func emailLocalPart(_ email: String) -> String {
        let lower = email.lowercased()
        guard let at = lower.firstIndex(of: "@") else { return lower }
        return String(lower[lower.startIndex..<at])
    }

    /// The line under the name: what this member *is*. Agents and app bots say
    /// so; everyone else shows their workspace role.
    static func kindLabel(_ m: some DirectoryMember) -> String {
        if m.isAgent == true { return "AI agent" }
        if m.isBot == true { return "App" }
        switch m.role {
        case "owner": return "Owner"
        case "admin": return "Admin"
        case "member": return "Member"
        default: return m.role
        }
    }

    /// The card's bottom line. An agent's email is a synthetic address nobody
    /// can write to, so its card names the sponsor instead — the useful fact
    /// about an agent. App bots get neither.
    ///
    /// `sponsorName` is resolved by the caller from the same roster, so a card
    /// costs no extra fetch.
    static func contactLine(_ m: some DirectoryMember, sponsorName: String?) -> String {
        if m.isAgent == true {
            return sponsorName.map { "Sponsored by \($0)" } ?? ""
        }
        if m.isBot == true { return "" }
        return m.email
    }

    /// The member's title, or nil when there is nothing to draw (#434). An
    /// unset title omits the line entirely rather than reserving a blank one,
    /// so a card without one is a shorter card, not a broken-looking one.
    /// Whitespace-only counts as unset: the server trims, but a row cached by
    /// an older client may not have been.
    static func titleLine(_ m: some DirectoryMember) -> String? {
        let t = (m.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// The live count beside the search box, pluralised.
    static func countLabel(_ n: Int) -> String {
        "\(n) \(n == 1 ? "person" : "people")"
    }

    /// What the grid says when it has nothing to draw — three distinct states,
    /// because "still loading", "nobody is here" and "your search matched
    /// nothing" are three different things to tell someone.
    enum EmptyState: Equatable {
        case loading
        case noMembers
        case noMatch(String)

        var message: String {
            switch self {
            case .loading: return "Loading…"
            case .noMembers: return "Nobody is here yet."
            case .noMatch(let q): return "No one matches “\(q)”."
            }
        }
    }

    /// Which of the three (if any) the grid should show.
    static func emptyState(total: Int, shown: Int, loading: Bool, query: String) -> EmptyState? {
        guard shown == 0 else { return nil }
        if loading && total == 0 { return .loading }
        if total == 0 { return .noMembers }
        return .noMatch(query.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

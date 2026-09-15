import Foundation

/// One row of the channel browser (#590, the native twin of web's #588): the
/// channel plus the member count the list shows. Not a cached `Channel` column
/// on purpose — the browser fetches live, and archived channels must never
/// reach the local cache, where the sidebar and unreads read from.
struct BrowsableChannel: Decodable, Equatable, Sendable, Identifiable {
    var channel: Channel
    var memberCount: Int

    var id: String { channel.id }
    var isArchived: Bool { channel.archivedAt != nil }

    init(channel: Channel, memberCount: Int) {
        self.channel = channel
        self.memberCount = memberCount
    }

    private enum CodingKeys: String, CodingKey { case memberCount }

    init(from decoder: Decoder) throws {
        channel = try Channel(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        memberCount = try c.decodeIfPresent(Int.self, forKey: .memberCount) ?? 0
    }
}

struct BrowsableChannelsResponse: Decodable, Sendable {
    let channels: [BrowsableChannel]
}

/// The channel browser's rules, shared by macOS and iOS and mirroring web's
/// `filterChannels` (ChannelBrowserView.tsx) so the three narrow identically.
enum ChannelBrowser {
    /// Public standard channels only — DMs and private channels are not
    /// browsable. Case-insensitive substring over name and topic; archived
    /// channels drop out unless asked for. Sorted by name, archived or not, so
    /// turning the toggle on slots them in place.
    static func filter(_ rows: [BrowsableChannel], query: String, includeArchived: Bool) -> [BrowsableChannel] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return rows
            .filter { $0.channel.kind == "standard" && !$0.channel.isPrivate }
            .filter { includeArchived || !$0.isArchived }
            .filter {
                q.isEmpty
                    || ($0.channel.name ?? "").lowercased().contains(q)
                    || ($0.channel.topic ?? "").lowercased().contains(q)
            }
            .sorted {
                ($0.channel.name ?? "").localizedCaseInsensitiveCompare($1.channel.name ?? "") == .orderedAscending
            }
    }

    static func countLabel(_ n: Int) -> String { "\(n) \(n == 1 ? "channel" : "channels")" }
    static func memberLabel(_ n: Int) -> String { "\(n) \(n == 1 ? "member" : "members")" }

    /// Nil while there are rows to draw.
    static func emptyMessage(total: Int, shown: Int, loading: Bool, query: String) -> String? {
        guard shown == 0 else { return nil }
        if loading && total == 0 { return "Loading…" }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? "No public channels yet." : "No channels match “\(q)”."
    }

    /// The archived-channel banner line (web wording).
    static func archivedBanner(archivedAt: String?) -> String {
        let date = archivedAt.flatMap(ISO8601.parse).map {
            $0.formatted(date: .abbreviated, time: .omitted)
        }
        return "📦 This channel was archived\(date.map { " on \($0)" } ?? ""). "
            + "Its history is read-only — no one can post, join or react here."
    }
}

extension Capabilities {
    /// An archived channel is history only (#588/#590): the server rejects
    /// posting, reacting, pinning and the rest with `channel_archived`, so the
    /// transcript hides those controls the same way it hides a provider's
    /// missing ones. Reading — history, threads, files — stays as it was.
    func archivedReadOnly() -> Capabilities {
        let reason = Capability.unavailable("This channel is archived.")
        let blocked: [CapabilityName] = [
            .send, .edit, .delete, .reactions, .pins, .artifacts, .agents, .huddles,
            .typing, .scheduledMessages, .channelManagement,
        ]
        return blocked.reduce(self) { $0.overriding($1, with: reason) }
    }
}

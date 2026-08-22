import Foundation
import GRDB

// MARK: - Core entities (shared JSON DTO + GRDB record shapes)
//
// All ids are UUIDv7 strings: lexicographic order == chronological order.
// Timestamps are kept as ISO-8601 strings; sorting always uses ids.
// Nested collections (reactions, files, memberIds) are stored as JSON text
// columns by GRDB's Codable record support.

struct User: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "user"

    var id: String
    var email: String
    var displayName: String
    var avatarUrl: String?
    var timezone: String?
    var statusEmoji: String? // "" / nil = no status
    var statusText: String?
    // Expanded profile (#220). Optional so a client pointed at a server
    // predating the fields still decodes. `website` is always an absolute
    // http(s) URL — the server rejects every other scheme — and `bio` is plain
    // text with significant newlines, never markdown.
    var website: String?
    var bio: String?
    var isAgent: Bool? // first-class AI agent (AGENTS_DESIGN.md)
    var sponsorId: String? // agents only: the human member who sponsored them
    var createdAt: String?

    /// Display-only name: agents carry the 🤖 badge (mention resolution uses
    /// the plain displayName from the DB, so this never reaches the wire).
    var displayNameWithBadge: String {
        isAgent == true ? "\(displayName) 🤖" : displayName
    }
}

struct Workspace: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "workspace"

    var id: String
    var slug: String
    var name: String
    var createdBy: String
    var createdAt: String
    var role: String?
    var sidebarColor: String? // preset id (see SidebarPalette); nil = default

    enum CodingKeys: String, CodingKey {
        case id, slug, name, createdBy, createdAt, role, sidebarColor
    }

    init(
        id: String, slug: String, name: String, createdBy: String, createdAt: String,
        role: String? = nil, sidebarColor: String? = nil
    ) {
        self.id = id
        self.slug = slug
        self.name = name
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.role = role
        self.sidebarColor = sidebarColor
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = try c.decode(String.self, forKey: .slug)
        name = try c.decode(String.self, forKey: .name)
        createdBy = try c.decode(String.self, forKey: .createdBy)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        role = try c.decodeIfPresent(String.self, forKey: .role)
        sidebarColor = try c.decodeIfPresent(String.self, forKey: .sidebarColor)
    }
}

/// One emoji aggregate on a message: who reacted, how many.
struct ReactionAgg: Codable, Sendable, Equatable {
    var emoji: String
    var count: Int
    var userIds: [String]
}

/// Server response for POST …/files/presign (R2-era direct upload): PUT the
/// bytes to `upload.url` with the given headers, then POST /files/:id/complete.
struct PresignedUpload: Codable, Sendable {
    struct Target: Codable, Sendable {
        var url: String // absolute (R2) or server-relative (local-dev fallback)
        var method: String
        var headers: [String: String]
    }

    var file: FileAttachment
    var upload: Target
}

/// Phase 11 link preview card (server `UnfurlDTO`). Everything except `url`
/// and `type` is optional — the server sends whatever it could extract, and
/// clients render what's present. Decoding is lenient for the same reason: a
/// card gaining a field later must not break an older client.
struct Unfurl: Codable, Sendable, Equatable, Identifiable {
    struct Image: Codable, Sendable, Equatable {
        var url: String
        var thumbUrl: String?
        var width: Int?
        var height: Int?
        var alt: String?
    }

    struct Media: Codable, Sendable, Equatable {
        var provider: String?
        var durationSec: Int?
    }

    /// Present when the link is a video Flow can play. `playerUrl` is built by
    /// the server from `videoId` — the provider's own oEmbed markup never
    /// reaches a client — and is only loaded once the viewer taps play.
    struct Embed: Codable, Sendable, Equatable {
        var provider: String
        var videoId: String
        var playerUrl: String
        var width: Int?
        var height: Int?
    }

    var url: String
    var urlHash: String
    var canonicalUrl: String?
    var type: String
    /// "thumbnail" | "large_image" | "media"
    var layout: String?
    var siteName: String?
    var faviconUrl: String?
    var title: String?
    var description: String?
    var author: String?
    var publishedAt: String?
    var image: Image?
    var media: Media?
    var embed: Embed?

    var id: String { urlHash }

    /// Runtime as `m:ss` (or `h:mm:ss`), when the server knew it.
    var durationLabel: String? {
        guard let seconds = media?.durationSec, seconds > 0 else { return nil }
        let h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }

    /// The page this card points at — canonical when the server resolved one.
    var target: String { canonicalUrl ?? url }

    var isLargeImage: Bool { layout == "large_image" }

    /// Host without "www.", the fallback when the page gave no og:site_name.
    var hostLabel: String {
        guard let host = URLComponents(string: target)?.host else { return "" }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}

/// A file attached to a message (server FileDTO shape).
struct FileAttachment: Codable, Sendable, Equatable, Identifiable {
    var id: String
    var workspaceId: String?
    var userId: String?
    var name: String
    var mimeType: String
    var sizeBytes: Int
    var width: Int?
    var height: Int?
    var hasThumb: Bool
    var createdAt: String?

    var isImage: Bool { hasThumb }

    var sizeLabel: String {
        ByteCountFormatter.string(fromByteCount: Int64(sizeBytes), countStyle: .file)
    }

    enum CodingKeys: String, CodingKey {
        case id, workspaceId, userId, name, mimeType, sizeBytes, width, height, hasThumb, createdAt
    }

    init(
        id: String, workspaceId: String?, userId: String?, name: String, mimeType: String,
        sizeBytes: Int, width: Int?, height: Int?, hasThumb: Bool, createdAt: String?
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.userId = userId
        self.name = name
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.width = width
        self.height = height
        self.hasThumb = hasThumb
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        workspaceId = try c.decodeIfPresent(String.self, forKey: .workspaceId)
        userId = try c.decodeIfPresent(String.self, forKey: .userId)
        name = try c.decode(String.self, forKey: .name)
        mimeType = try c.decode(String.self, forKey: .mimeType)
        sizeBytes = try c.decodeIfPresent(Int.self, forKey: .sizeBytes) ?? 0
        width = try c.decodeIfPresent(Int.self, forKey: .width)
        height = try c.decodeIfPresent(Int.self, forKey: .height)
        hasThumb = try c.decodeIfPresent(Bool.self, forKey: .hasThumb) ?? false
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

// File-kind classification (glyphs, inline-preview eligibility). Lives in the
// shared model layer because both the macOS previews and the artifact sidebar
// glyph (Artifact.glyph, below) — and the iOS target, which excludes the macOS
// Views — depend on it. Pure Foundation, no AppKit.
extension FileAttachment {
    static let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "webm"]

    var isVideo: Bool {
        mimeType.hasPrefix("video/")
            || Self.videoExtensions.contains((name as NSString).pathExtension.lowercased())
    }

    /// AVFoundation has no VP8/VP9/webm support — those stay a file chip on
    /// macOS (deliberate divergence: web plays webm inline; see CHANGELOG Parity).
    var isPlayableVideo: Bool {
        guard isVideo else { return false }
        let ext = (name as NSString).pathExtension.lowercased()
        return mimeType != "video/webm" && ext != "webm"
    }

    /// ASCII-ish formats that get an inline monospace preview.
    var isTextPreviewable: Bool {
        if isImage { return false }
        if mimeType.hasPrefix("text/") { return true }
        if [
            "application/json", "application/javascript", "application/xml",
            "application/x-sh", "application/x-yaml",
        ].contains(mimeType) { return true }
        let ext = (name as NSString).pathExtension.lowercased()
        return Self.textExtensions.contains(ext)
    }

    static let textExtensions: Set<String> = [
        "txt", "md", "markdown", "log", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx",
        "py", "rb", "go", "rs", "java", "c", "cc", "cpp", "h", "hpp", "m", "swift", "kt",
        "sh", "bash", "zsh", "fish", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml",
        "html", "htm", "css", "scss", "less", "sql", "csv", "tsv", "env", "gitignore",
    ]

    var isPDF: Bool {
        mimeType == "application/pdf" || name.lowercased().hasSuffix(".pdf")
    }

    /// HTML renders sandboxed in the artifact panel (phase 9); in chat it
    /// still previews as text.
    var isHTML: Bool {
        mimeType == "text/html"
            || ["html", "htm"].contains((name as NSString).pathExtension.lowercased())
    }

    /// Sidebar glyph for an artifact row (phase 9) — mirrors web fileKind.ts.
    var artifactGlyph: String {
        if mimeType.hasPrefix("image/") { return "🖼️" }
        if isVideo { return "🎬" }
        if isPDF { return "📕" }
        if isHTML { return "🌐" }
        if isTextPreviewable { return "📝" }
        return "📄"
    }
}

struct Channel: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "channel"

    var id: String
    var workspaceId: String
    var name: String? // nil for dm/group_dm
    var kind: String // standard | dm | group_dm
    var topic: String?
    var isPrivate: Bool
    var createdBy: String
    var createdAt: String
    var archivedAt: String?
    var isMember: Bool
    var lastReadMsgId: String?
    /// Unread *messages* — emboldens the sidebar row, never shown as a number
    /// (operator ruling 2026-07-26).
    var unreadCount: Int
    /// Unread *notifications* raised in this channel — the number the sidebar
    /// badge shows. Mentions, thread replies, reactions; every message in a DM.
    var unreadNotifications: Int
    /// Thread roots here holding an unread notification for me (#270) — the
    /// root's "N replies" chip draws a dot, so a reply that needs you is
    /// visible in the transcript and not only in the sidebar badge.
    var unreadThreadRootIds: [String]?
    var notifyLevel: Int // 0=mute 1=mentions 2=all
    /// Parent channel (#118) — set at creation, one level deep. The sidebar
    /// draws this channel indented under it. nil for a top-level channel.
    var parentId: String?
    var memberIds: [String]? // dm/group_dm only

    var isDM: Bool { kind != "standard" }

    /// Sidebar/header title. DMs render member display names, not `name`.
    func displayTitle(userNames: [String: String], currentUserId: String?) -> String {
        if !isDM { return name ?? "channel" }
        let others = (memberIds ?? []).filter { $0 != currentUserId }
        if others.isEmpty { return userNames[currentUserId ?? ""].map { "\($0) (you)" } ?? "Just you" }
        return others.map { userNames[$0] ?? "Unknown" }.sorted().joined(separator: ", ")
    }

    enum CodingKeys: String, CodingKey {
        case id, workspaceId, name, kind, topic, isPrivate, createdBy, createdAt
        case archivedAt, isMember, lastReadMsgId, unreadCount, unreadNotifications
        case unreadThreadRootIds, notifyLevel, parentId, memberIds
    }

    init(
        id: String, workspaceId: String, name: String?, kind: String = "standard", topic: String?,
        isPrivate: Bool, createdBy: String, createdAt: String, archivedAt: String?,
        isMember: Bool, lastReadMsgId: String?, unreadCount: Int, unreadNotifications: Int = 0,
        unreadThreadRootIds: [String]? = nil,
        notifyLevel: Int = 1, parentId: String? = nil, memberIds: [String]? = nil
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.name = name
        self.kind = kind
        self.topic = topic
        self.isPrivate = isPrivate
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.archivedAt = archivedAt
        self.isMember = isMember
        self.lastReadMsgId = lastReadMsgId
        self.unreadCount = unreadCount
        self.unreadNotifications = unreadNotifications
        self.unreadThreadRootIds = unreadThreadRootIds
        self.notifyLevel = notifyLevel
        self.parentId = parentId
        self.memberIds = memberIds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        workspaceId = try c.decode(String.self, forKey: .workspaceId)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "standard"
        topic = try c.decodeIfPresent(String.self, forKey: .topic)
        isPrivate = try c.decodeIfPresent(Bool.self, forKey: .isPrivate) ?? false
        createdBy = try c.decode(String.self, forKey: .createdBy)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        archivedAt = try c.decodeIfPresent(String.self, forKey: .archivedAt)
        isMember = try c.decodeIfPresent(Bool.self, forKey: .isMember) ?? false
        lastReadMsgId = try c.decodeIfPresent(String.self, forKey: .lastReadMsgId)
        unreadCount = try c.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
        unreadNotifications = try c.decodeIfPresent(Int.self, forKey: .unreadNotifications) ?? 0
        unreadThreadRootIds = try c.decodeIfPresent([String].self, forKey: .unreadThreadRootIds)
        notifyLevel = try c.decodeIfPresent(Int.self, forKey: .notifyLevel) ?? 1
        parentId = try c.decodeIfPresent(String.self, forKey: .parentId)
        memberIds = try c.decodeIfPresent([String].self, forKey: .memberIds)
    }
}

extension Channel {
    /// Sub-channels (#118): flatten a channel list into sidebar display order —
    /// each parent immediately followed by its children, which draw indented.
    ///
    /// Membership is per channel, so you can be in a child without being in its
    /// parent. That child has nothing to nest under, and dropping it would hide
    /// a channel you belong to, so it renders at top level instead — same when
    /// the parent is archived and filtered out before this is called.
    ///
    /// Input order is preserved, so callers keep whatever sort they applied.
    /// Shared by the macOS and iOS sidebars, which both compile this file.
    ///
    /// Only a top-level channel can host children. The server rejects
    /// grandchildren, but one arriving anyway renders at top level rather than
    /// being indented twice or silently dropped.
    static func nested(_ list: [Channel]) -> [(channel: Channel, isNested: Bool)] {
        let byId = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func parentOf(_ c: Channel) -> Channel? { c.parentId.flatMap { byId[$0] } }
        var childrenOf: [String: [Channel]] = [:]
        var roots: [Channel] = []
        for c in list {
            if let parent = parentOf(c), parentOf(parent) == nil {
                childrenOf[parent.id, default: []].append(c)
            } else {
                roots.append(c)
            }
        }
        return roots.flatMap { root in
            [(channel: root, isNested: false)]
                + (childrenOf[root.id] ?? []).map { (channel: $0, isNested: true) }
        }
    }
}

struct Message: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "message"

    var id: String
    var channelId: String
    var userId: String
    var threadRootId: String?
    var clientMsgId: String
    var body: String
    var createdAt: String
    var editedAt: String?
    var deletedAt: String?
    /// Channel-wide pin metadata. Nil means the message is not pinned.
    var pinnedAt: String?
    var pinnedBy: String?
    var replyCount: Int
    var lastReplyAt: String?
    /// First (up to) 4 distinct reply authors in thread order (reply-avatar stack).
    var replyParticipantUserIds: [String]
    var reactions: [ReactionAgg]
    var files: [FileAttachment]
    /// Phase 11 link preview cards, in first-in-message order.
    var unfurls: [Unfurl]
    /// Non-nil marks a channel event line (join/leave) rather than a user
    /// message; `body` is the pre-rendered sentence. Rendered as a centered
    /// muted notice with no avatar/header (ui_nits).
    var systemKind: String?
    /// Local-only: true for optimistic rows not yet confirmed by the server.
    var pending: Bool
    /// Local-only: true once an optimistic row's POST errored out. The row
    /// stays visible (not pending) with a Retry affordance; a retry clears it.
    var failed: Bool

    var isDeleted: Bool { deletedAt != nil }

    enum CodingKeys: String, CodingKey {
        case id, channelId, userId, threadRootId, clientMsgId, body
        case createdAt, editedAt, deletedAt, pinnedAt, pinnedBy, replyCount, lastReplyAt
        case replyParticipantUserIds, reactions, files, unfurls, systemKind, pending, failed
    }

    init(
        id: String, channelId: String, userId: String, threadRootId: String?,
        clientMsgId: String, body: String, createdAt: String, editedAt: String?,
        deletedAt: String?, pinnedAt: String? = nil, pinnedBy: String? = nil,
        replyCount: Int, lastReplyAt: String?,
        replyParticipantUserIds: [String] = [],
        reactions: [ReactionAgg] = [], files: [FileAttachment] = [],
        unfurls: [Unfurl] = [], systemKind: String? = nil, pending: Bool, failed: Bool = false
    ) {
        self.id = id
        self.channelId = channelId
        self.userId = userId
        self.threadRootId = threadRootId
        self.clientMsgId = clientMsgId
        self.body = body
        self.createdAt = createdAt
        self.editedAt = editedAt
        self.deletedAt = deletedAt
        self.pinnedAt = pinnedAt
        self.pinnedBy = pinnedBy
        self.replyCount = replyCount
        self.lastReplyAt = lastReplyAt
        self.replyParticipantUserIds = replyParticipantUserIds
        self.reactions = reactions
        self.files = files
        self.unfurls = unfurls
        self.systemKind = systemKind
        self.pending = pending
        self.failed = failed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        channelId = try c.decode(String.self, forKey: .channelId)
        userId = try c.decode(String.self, forKey: .userId)
        threadRootId = try c.decodeIfPresent(String.self, forKey: .threadRootId)
        clientMsgId = try c.decode(String.self, forKey: .clientMsgId)
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        editedAt = try c.decodeIfPresent(String.self, forKey: .editedAt)
        deletedAt = try c.decodeIfPresent(String.self, forKey: .deletedAt)
        pinnedAt = try c.decodeIfPresent(String.self, forKey: .pinnedAt)
        pinnedBy = try c.decodeIfPresent(String.self, forKey: .pinnedBy)
        replyCount = try c.decodeIfPresent(Int.self, forKey: .replyCount) ?? 0
        lastReplyAt = try c.decodeIfPresent(String.self, forKey: .lastReplyAt)
        replyParticipantUserIds = try c.decodeIfPresent([String].self, forKey: .replyParticipantUserIds) ?? []
        reactions = try c.decodeIfPresent([ReactionAgg].self, forKey: .reactions) ?? []
        files = try c.decodeIfPresent([FileAttachment].self, forKey: .files) ?? []
        unfurls = try c.decodeIfPresent([Unfurl].self, forKey: .unfurls) ?? []
        systemKind = try c.decodeIfPresent(String.self, forKey: .systemKind)
        pending = try c.decodeIfPresent(Bool.self, forKey: .pending) ?? false
        failed = try c.decodeIfPresent(Bool.self, forKey: .failed) ?? false
    }
}

/// A personal bookmark of a file shared in chat (server ArtifactDTO, phase 9).
/// Not cached in GRDB: the list is small and per-workspace, so it's fetched
/// on demand and held in AppState (same treatment as notifications).
struct Artifact: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let workspaceId: String
    let channelId: String // the channel this artifact belongs to (shared with all members)
    /// "file" — a pinned file; "link" — a pinned URL opened in the co-browsing
    /// mini-browser (link artifacts). Discriminates which of file/url is set.
    let kind: String
    let fileId: String? // set when kind == "file"
    /// The pinned URL when kind == "link". Mutable: any member changing it in the
    /// mini-browser re-points the artifact and every viewer follows (co-browse).
    let url: String?
    var name: String
    /// True when the artifact owns its backing file — an agent generated the
    /// content via the Flow MCP rather than a human pinning a message file.
    /// Drives auto-opening agent-created artifacts for the requester.
    let ownsFile: Bool
    let createdAt: String
    let updatedAt: String
    let file: FileAttachment? // null for link artifacts

    var isLink: Bool { kind == "link" }

    /// Sidebar/tab glyph: the backing file's kind glyph, or a link glyph for
    /// link artifacts (which have no file).
    var glyph: String { file?.artifactGlyph ?? "🔗" }
}

/// Workspace membership (local cache of GET /workspaces/:id/members).
struct Member: Codable, Sendable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "member"

    var workspaceId: String
    var userId: String
    var role: String
}

// MARK: - REST payloads

struct AuthResponse: Decodable, Sendable {
    let token: String
    let user: User
}

/// GET /v1/config — the public bootstrap payload (phase 16). Tells the
/// signed-out screen which auth options this deployment offers. `googleClientId`
/// is only of use to a browser; native just needs the boolean.
struct PublicConfig: Decodable, Sendable {
    let google: Bool
    /// Optional so a client pointed at a server predating the field still decodes.
    let apple: Bool?
}

struct MemberDTO: Decodable, Sendable {
    let userId: String
    let displayName: String
    let email: String
    let avatarUrl: String?
    let statusEmoji: String?
    let statusText: String?
    let isAgent: Bool?
    let role: String
    let joinedAt: String?
}

struct WorkspacesResponse: Decodable, Sendable { let workspaces: [Workspace] }
struct ChannelsResponse: Decodable, Sendable {
    let channels: [Channel]
    /// Channels with an activity spinner showing right now (#137). Read off the
    /// same rows but kept out of `Channel` on purpose: channel rows are cached
    /// on disk, and a spinner must never survive a relaunch — it's a claim
    /// about what an agent is doing this second.
    let busyChannelIds: Set<String>

    private struct IndicatorRow: Decodable { let id: String; let indicator: String? }
    private enum CodingKeys: String, CodingKey { case channels }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        channels = try c.decode([Channel].self, forKey: .channels)
        let rows = try c.decode([IndicatorRow].self, forKey: .channels)
        busyChannelIds = Set(rows.filter { $0.indicator != nil }.map(\.id))
    }
}

/// `channel.indicator` payload (#137): the channel's aggregate state after a
/// change, so a client only ever sets or clears — `state` nil means quiet.
struct ChannelIndicatorData: Decodable, Sendable {
    let channelId: String
    let state: String?
}
struct MembersResponse: Decodable, Sendable { let members: [MemberDTO] }
struct ChannelMembersResponse: Decodable, Sendable { let userIds: [String] }

/// A user just @-mentioned in a standard channel they don't belong to (web
/// parity: the "Add to channel" CTA). They won't see the mention until added.
struct MentionMiss: Identifiable, Hashable, Sendable {
    let id: String // userId
    let name: String
}
struct MessagesResponse: Decodable, Sendable {
    let messages: [Message] // newest first
    let hasMore: Bool
}
struct PinnedMessagesResponse: Decodable, Sendable {
    let messages: [Message]
}
struct ThreadResponse: Decodable, Sendable {
    let root: Message
    let messages: [Message] // replies, ascending
    let hasMore: Bool
}
struct InviteResponse: Decodable, Sendable {
    let inviteUrl: String
    let email: String?
    let expiresAt: String?
}
/// The workspace's persistent join link (issue #85). `joinUrl` is nil when no
/// link is live — one exists at a time, and revoking clears it.
struct JoinLinkResponse: Decodable, Sendable {
    let workspaceId: String
    let joinUrl: String?
}
/// POST /v1/workspaces/:id/agent-invites — a one-time code for a coding agent
/// plus the ready-to-run command. The raw code is only ever returned here.
struct AgentInviteResponse: Decodable, Sendable {
    let code: String
    let command: String
    let expiresAt: String?
}
struct OkResponse: Decodable, Sendable { let ok: Bool }
struct ReactionsResponse: Decodable, Sendable { let reactions: [ReactionAgg] }
struct ArtifactsResponse: Decodable, Sendable { let artifacts: [Artifact] } // newest first

/// Server NotificationDTO: an in-app notification with its triggering message.
struct NotificationItem: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let userId: String
    let messageId: String
    let channelId: String
    let workspaceId: String
    let kind: Int // 0=mention 1=dm 2=thread_reply 3=channel activity 4=reaction
    /// Who caused it (issue #63) — the reactor for kind 4, the message author
    /// otherwise. Optional: rows written before the column existed have none.
    let actorId: String?
    /// kind 4 only: the emoji someone added to my message.
    let reactionEmoji: String?
    /// Server's alert decision (phase 10: per-user prefs + status suppression).
    /// Optional so an older server, which omits it, still decodes — absent
    /// means "alert", the pre-phase-10 behavior.
    let suppressAlert: Bool?
    let createdAt: String
    let readAt: String?
    let message: Message

    /// The user whose name and avatar the row/banner should show.
    var actorUserId: String { actorId ?? message.userId }
    /// Whether this notification may raise an OS banner.
    var alerts: Bool { suppressAlert != true }

    /// Activity-row title (#267). `channelName` names where it happened —
    /// omitted on DM rows, which already say so, and when the channel isn't
    /// known locally. Shared by the macOS and iOS feeds so they read alike.
    func headline(sender: String, channelName: String?) -> String {
        let suffix = channelName.map { " in #\($0)" } ?? ""
        switch kind {
        case 1: return "\(sender) sent you a direct message"
        case 2: return "\(sender) replied in a thread\(suffix)"
        case 3: return "\(sender) posted\(suffix)"
        case 4: return "\(sender) reacted \(reactionEmoji ?? "") to your message\(suffix)"
            .replacingOccurrences(of: "  ", with: " ")
        case 5:
            // #303. The channel is the point here, so name it or say nothing —
            // "added you in #x" would read as the wrong preposition.
            return channelName.map { "\(sender) added you to #\($0)" }
                ?? "\(sender) added you to a channel"
        default: return "\(sender) mentioned you\(suffix)"
        }
    }
}

/// `notification.read` payload (issue #63): rows this user just read, in this
/// or another session, plus the unread total every badge follows.
struct NotificationReadData: Decodable, Sendable {
    let ids: [String]
    let unreadCount: Int
}

struct NotificationsResponse: Decodable, Sendable {
    let notifications: [NotificationItem]
    let hasMore: Bool
    /// Unread in the workspace we asked for — the sidebar Activity badge.
    let unreadCount: Int
    /// Unread across every workspace — the app icon badge, which still has to
    /// speak for the workspaces you aren't looking at. Optional so a client
    /// pointed at a server predating the field still decodes.
    let totalUnreadCount: Int?
}

struct RegisterBody: Encodable, Sendable {
    let email: String
    let password: String
    let displayName: String
    // Dev-only skip of email verification (server honors it only on the local
    // email driver). Production registration happens on the web, which verifies.
    let autoVerify = true
}
/// POST /v1/auth/register on production servers: email-first, address only.
/// Name and password are set by whoever clicks the emailed link.
struct EmailRegisterBody: Encodable, Sendable {
    let email: String
}
/// Its response — no session yet, just confirmation the email went out. The
/// server answers the same whether or not the address already has an account
/// (no enumeration).
struct RegisterPendingResponse: Decodable, Sendable {
    let requiresVerification: Bool
    let email: String
}
struct LoginBody: Encodable, Sendable {
    let email: String
    let password: String
}
struct AppLinkExchangeBody: Encodable, Sendable {
    let code: String
}
/// POST /v1/auth/apple — the identity token from ASAuthorization, plus the
/// user's name, which Apple hands the client exactly once (first authorization)
/// and is never in the token, so it must ride along or be lost.
struct AppleAuthBody: Encodable, Sendable {
    let identityToken: String
    let name: String?
}
struct SigninLinkBody: Encodable, Sendable {
    let email: String
}
struct CreateWorkspaceBody: Encodable, Sendable {
    let name: String
    let slug: String
}
struct CreateChannelBody: Encodable, Sendable {
    let name: String
    let topic: String?
    let isPrivate: Bool
}
/// PATCH /v1/channels/:id — nil field = unchanged; empty topic clears it.
struct UpdateChannelBody: Encodable, Sendable {
    let name: String?
    let topic: String?
}
struct CreateInviteBody: Encodable, Sendable { let email: String }
struct AcceptInviteBody: Encodable, Sendable { let token: String }
struct SendMessageBody: Encodable, Sendable {
    let clientMsgId: String
    let body: String
    let threadRootId: String?
    let fileIds: [String]?
    let mentions: [String]?

    init(
        clientMsgId: String, body: String, threadRootId: String? = nil,
        fileIds: [String]? = nil, mentions: [String]? = nil
    ) {
        self.clientMsgId = clientMsgId
        self.body = body
        self.threadRootId = threadRootId
        self.fileIds = fileIds
        self.mentions = mentions
    }
}
struct EditMessageBody: Encodable, Sendable { let body: String }
/// POST /v1/channels/:id/read. `threadRootId` means "I'm looking at this
/// thread": it reads the thread's notifications (issue #63) and leaves the
/// channel cursor, which only tracks top-level messages, alone.
struct ReadBody: Encodable, Sendable {
    let lastReadMsgId: String
    var threadRootId: String?
}
struct CreateDmBody: Encodable, Sendable { let userIds: [String] }
struct AddMemberBody: Encodable, Sendable { let userId: String }
struct NotifyLevelBody: Encodable, Sendable { let level: Int }
struct PatchMeBody: Encodable, Sendable {
    let displayName: String?
    let timezone: String?
    let statusEmoji: String? // set with statusText together; "" clears
    let statusText: String?
    /// Phase 10: DND-family statuses pause alerts. Omitted = server keeps the
    /// current value, so senders that support the flag must always send it.
    let statusSuppressAlerts: Bool?
    /// #220: "" clears either field. The server rejects a `website` that is not
    /// an absolute http(s) URL, so the sheets check before they send.
    let website: String?
    let bio: String?

    init(
        displayName: String? = nil, timezone: String? = nil,
        statusEmoji: String? = nil, statusText: String? = nil,
        statusSuppressAlerts: Bool? = nil,
        website: String? = nil, bio: String? = nil
    ) {
        self.displayName = displayName
        self.timezone = timezone
        self.statusEmoji = statusEmoji
        self.statusText = statusText
        self.statusSuppressAlerts = statusSuppressAlerts
        self.website = website
        self.bio = bio
    }
}
/// POST /v1/me/notifications/read — a cursor (`upToId`, opening the Activity
/// feed) or one row (`id`, clicking it). Exactly one is sent.
struct MarkNotificationsReadBody: Encodable, Sendable {
    var upToId: String?
    var id: String?
    /// Keeps an `upToId` sweep inside one workspace (the cursor is a plain id
    /// comparison server-side). Ignored alongside `id`.
    var workspaceId: String?
}
struct UpdateWorkspaceColorBody: Encodable, Sendable { let sidebarColor: String }
/// POST /v1/artifacts — pin a file as a shared artifact in a channel. nil name
/// = server derives it from the filename.
struct CreateArtifactBody: Encodable, Sendable {
    let channelId: String
    var fileId: String?
    var url: String? // pin a link instead of a file (link artifacts) — exactly one of fileId/url
    var name: String?
}
/// PATCH /v1/artifacts/:id — rename, re-point a file artifact at a new file, or
/// re-point a link artifact at a new url (the co-browse navigation write).
struct UpdateArtifactBody: Encodable, Sendable {
    var name: String?
    var fileId: String?
    var url: String?
}

// MARK: - WS events

struct TypingData: Decodable, Sendable {
    let userId: String
    let channelId: String
    /// Set when typing in a thread's composer — the indicator belongs to that
    /// thread, not the channel's main view. Absent = the main composer.
    let threadRootId: String?
}

/// Typing indicators are per-composer: a channel's main composer and each of
/// its threads are separate conversations and get separate keys.
enum TypingKey {
    static func make(channelId: String, threadRootId: String?) -> String {
        "\(channelId)|\(threadRootId ?? "")"
    }
}

struct PresenceData: Decodable, Sendable {
    let userId: String
    let status: String
}

struct MemberJoinedData: Decodable, Sendable {
    let userId: String?
    let channelId: String?
    let displayName: String?
}

struct ReactionEventData: Decodable, Sendable {
    let messageId: String
    let channelId: String
    let emoji: String
    let userId: String
}

enum EventPayload: Sendable {
    case message(Message)
    case typing(TypingData)
    case presence(PresenceData)
    case channelIndicator(ChannelIndicatorData)
    case channel(Channel)
    case channelUpdated(Channel)
    case channelArchived(Channel)
    case memberJoined(MemberJoinedData)
    case memberLeft(MemberJoinedData)
    case reaction(ReactionEventData, added: Bool)
    case notification(NotificationItem)
    case notificationRead(NotificationReadData)
    case userUpdated(User)
    case workspaceUpdated(Workspace)
    case workspaceJoined
    case artifact(Artifact, change: ArtifactChange)
    case unknown
}

/// Lifecycle of an artifact.* event. `created` is distinguished from `updated`
/// so the client can auto-open a freshly agent-created artifact without an
/// in-place content update yanking focus back to the panel.
enum ArtifactChange: Sendable { case created, updated, deleted }

struct EventDTO: Decodable, Sendable {
    let type: String
    let workspaceId: String
    let channelId: String?
    let ts: String
    let payload: EventPayload

    enum CodingKeys: String, CodingKey { case type, workspaceId, channelId, ts, data }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decode(String.self, forKey: .type)
        workspaceId = try c.decode(String.self, forKey: .workspaceId)
        channelId = try c.decodeIfPresent(String.self, forKey: .channelId)
        ts = try c.decode(String.self, forKey: .ts)
        switch type {
        case "message.created", "message.updated", "message.deleted", "message.purged", "thread.reply":
            payload = .message(try c.decode(Message.self, forKey: .data))
        case "typing":
            payload = .typing(try c.decode(TypingData.self, forKey: .data))
        case "presence":
            payload = .presence(try c.decode(PresenceData.self, forKey: .data))
        case "channel.indicator":
            payload = .channelIndicator(try c.decode(ChannelIndicatorData.self, forKey: .data))
        case "channel.created":
            payload = .channel(try c.decode(Channel.self, forKey: .data))
        case "channel.updated":
            payload = .channelUpdated(try c.decode(Channel.self, forKey: .data))
        case "channel.archived":
            payload = .channelArchived(try c.decode(Channel.self, forKey: .data))
        case "member.joined":
            payload = .memberJoined(try c.decode(MemberJoinedData.self, forKey: .data))
        case "member.left":
            payload = .memberLeft(try c.decode(MemberJoinedData.self, forKey: .data))
        case "reaction.added":
            payload = .reaction(try c.decode(ReactionEventData.self, forKey: .data), added: true)
        case "reaction.removed":
            payload = .reaction(try c.decode(ReactionEventData.self, forKey: .data), added: false)
        case "notification.created":
            payload = .notification(try c.decode(NotificationItem.self, forKey: .data))
        case "notification.read":
            payload = .notificationRead(try c.decode(NotificationReadData.self, forKey: .data))
        case "user.updated":
            payload = .userUpdated(try c.decode(User.self, forKey: .data))
        case "workspace.updated":
            payload = .workspaceUpdated(try c.decode(Workspace.self, forKey: .data))
        case "workspace.joined":
            // this user joined a workspace in another session; the envelope's
            // workspaceId is all we need
            payload = .workspaceJoined
        case "artifact.created":
            payload = .artifact(try c.decode(Artifact.self, forKey: .data), change: .created)
        case "artifact.updated":
            payload = .artifact(try c.decode(Artifact.self, forKey: .data), change: .updated)
        case "artifact.deleted":
            payload = .artifact(try c.decode(Artifact.self, forKey: .data), change: .deleted)
        default:
            payload = .unknown
        }
    }
}

/// Frames received over the WebSocket.
enum ServerFrame: Decodable, Sendable {
    case hello(sessionId: String)
    case ping
    case event(EventDTO)
    case unknown

    private enum CodingKeys: String, CodingKey { case op, sessionId, event }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .op) {
        case "hello":
            self = .hello(sessionId: (try? c.decode(String.self, forKey: .sessionId)) ?? "")
        case "ping":
            self = .ping
        case "event":
            self = .event(try c.decode(EventDTO.self, forKey: .event))
        default:
            self = .unknown
        }
    }
}

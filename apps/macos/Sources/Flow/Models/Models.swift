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
    var isAgent: Bool? // first-class AI agent (AGENTS_DESIGN.md)
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

    var id: String { urlHash }

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
    var unreadCount: Int
    var notifyLevel: Int // 0=mute 1=mentions 2=all
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
        case archivedAt, isMember, lastReadMsgId, unreadCount, notifyLevel, memberIds
    }

    init(
        id: String, workspaceId: String, name: String?, kind: String = "standard", topic: String?,
        isPrivate: Bool, createdBy: String, createdAt: String, archivedAt: String?,
        isMember: Bool, lastReadMsgId: String?, unreadCount: Int, notifyLevel: Int = 1,
        memberIds: [String]? = nil
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
        self.notifyLevel = notifyLevel
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
        notifyLevel = try c.decodeIfPresent(Int.self, forKey: .notifyLevel) ?? 1
        memberIds = try c.decodeIfPresent([String].self, forKey: .memberIds)
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
    var replyCount: Int
    var lastReplyAt: String?
    /// First (up to) 4 distinct reply authors in thread order (reply-avatar stack).
    var replyParticipantUserIds: [String]
    var reactions: [ReactionAgg]
    var files: [FileAttachment]
    /// Phase 11 link preview cards, in first-in-message order.
    var unfurls: [Unfurl]
    /// Local-only: true for optimistic rows not yet confirmed by the server.
    var pending: Bool

    var isDeleted: Bool { deletedAt != nil }

    enum CodingKeys: String, CodingKey {
        case id, channelId, userId, threadRootId, clientMsgId, body
        case createdAt, editedAt, deletedAt, replyCount, lastReplyAt
        case replyParticipantUserIds, reactions, files, unfurls, pending
    }

    init(
        id: String, channelId: String, userId: String, threadRootId: String?,
        clientMsgId: String, body: String, createdAt: String, editedAt: String?,
        deletedAt: String?, replyCount: Int, lastReplyAt: String?,
        replyParticipantUserIds: [String] = [],
        reactions: [ReactionAgg] = [], files: [FileAttachment] = [],
        unfurls: [Unfurl] = [], pending: Bool
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
        self.replyCount = replyCount
        self.lastReplyAt = lastReplyAt
        self.replyParticipantUserIds = replyParticipantUserIds
        self.reactions = reactions
        self.files = files
        self.unfurls = unfurls
        self.pending = pending
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
        replyCount = try c.decodeIfPresent(Int.self, forKey: .replyCount) ?? 0
        lastReplyAt = try c.decodeIfPresent(String.self, forKey: .lastReplyAt)
        replyParticipantUserIds = try c.decodeIfPresent([String].self, forKey: .replyParticipantUserIds) ?? []
        reactions = try c.decodeIfPresent([ReactionAgg].self, forKey: .reactions) ?? []
        files = try c.decodeIfPresent([FileAttachment].self, forKey: .files) ?? []
        unfurls = try c.decodeIfPresent([Unfurl].self, forKey: .unfurls) ?? []
        pending = try c.decodeIfPresent(Bool.self, forKey: .pending) ?? false
    }
}

/// A personal bookmark of a file shared in chat (server ArtifactDTO, phase 9).
/// Not cached in GRDB: the list is small and per-workspace, so it's fetched
/// on demand and held in AppState (same treatment as notifications).
struct Artifact: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let workspaceId: String
    let userId: String // owner — artifacts are personal
    let fileId: String
    var name: String
    let createdAt: String
    let file: FileAttachment
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
struct ChannelsResponse: Decodable, Sendable { let channels: [Channel] }
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
    let kind: Int // 0=mention 1=dm 2=thread_reply 3=channel activity
    let createdAt: String
    let readAt: String?
    let message: Message
}

struct NotificationsResponse: Decodable, Sendable {
    let notifications: [NotificationItem]
    let hasMore: Bool
    let unreadCount: Int
}

struct RegisterBody: Encodable, Sendable {
    let email: String
    let password: String
    let displayName: String
    // Dev-only skip of email verification (server honors it only on the local
    // email driver). Production registration happens on the web, which verifies.
    let autoVerify = true
}
struct LoginBody: Encodable, Sendable {
    let email: String
    let password: String
}
struct AppLinkExchangeBody: Encodable, Sendable {
    let code: String
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
struct ReadBody: Encodable, Sendable { let lastReadMsgId: String }
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

    init(
        displayName: String? = nil, timezone: String? = nil,
        statusEmoji: String? = nil, statusText: String? = nil,
        statusSuppressAlerts: Bool? = nil
    ) {
        self.displayName = displayName
        self.timezone = timezone
        self.statusEmoji = statusEmoji
        self.statusText = statusText
        self.statusSuppressAlerts = statusSuppressAlerts
    }
}
struct MarkNotificationsReadBody: Encodable, Sendable { let upToId: String }
struct UpdateWorkspaceColorBody: Encodable, Sendable { let sidebarColor: String }
/// POST /v1/artifacts — nil name = server derives it from the filename.
struct CreateArtifactBody: Encodable, Sendable {
    let fileId: String
    let name: String?
}
struct RenameArtifactBody: Encodable, Sendable { let name: String }

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
    case channel(Channel)
    case channelUpdated(Channel)
    case channelArchived(Channel)
    case memberJoined(MemberJoinedData)
    case memberLeft(MemberJoinedData)
    case reaction(ReactionEventData, added: Bool)
    case notification(NotificationItem)
    case userUpdated(User)
    case workspaceUpdated(Workspace)
    case artifact(Artifact, deleted: Bool)
    case unknown
}

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
        case "user.updated":
            payload = .userUpdated(try c.decode(User.self, forKey: .data))
        case "workspace.updated":
            payload = .workspaceUpdated(try c.decode(Workspace.self, forKey: .data))
        case "artifact.created", "artifact.updated":
            payload = .artifact(try c.decode(Artifact.self, forKey: .data), deleted: false)
        case "artifact.deleted":
            payload = .artifact(try c.decode(Artifact.self, forKey: .data), deleted: true)
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

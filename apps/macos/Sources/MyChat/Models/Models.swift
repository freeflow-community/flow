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
    var createdAt: String?
}

struct Workspace: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "workspace"

    var id: String
    var slug: String
    var name: String
    var createdBy: String
    var createdAt: String
    var role: String?
}

/// One emoji aggregate on a message: who reacted, how many.
struct ReactionAgg: Codable, Sendable, Equatable {
    var emoji: String
    var count: Int
    var userIds: [String]
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
    var reactions: [ReactionAgg]
    var files: [FileAttachment]
    /// Local-only: true for optimistic rows not yet confirmed by the server.
    var pending: Bool

    var isDeleted: Bool { deletedAt != nil }

    enum CodingKeys: String, CodingKey {
        case id, channelId, userId, threadRootId, clientMsgId, body
        case createdAt, editedAt, deletedAt, replyCount, lastReplyAt
        case reactions, files, pending
    }

    init(
        id: String, channelId: String, userId: String, threadRootId: String?,
        clientMsgId: String, body: String, createdAt: String, editedAt: String?,
        deletedAt: String?, replyCount: Int, lastReplyAt: String?,
        reactions: [ReactionAgg] = [], files: [FileAttachment] = [], pending: Bool
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
        self.reactions = reactions
        self.files = files
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
        reactions = try c.decodeIfPresent([ReactionAgg].self, forKey: .reactions) ?? []
        files = try c.decodeIfPresent([FileAttachment].self, forKey: .files) ?? []
        pending = try c.decodeIfPresent(Bool.self, forKey: .pending) ?? false
    }
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
    let role: String
    let joinedAt: String?
}

struct WorkspacesResponse: Decodable, Sendable { let workspaces: [Workspace] }
struct ChannelsResponse: Decodable, Sendable { let channels: [Channel] }
struct MembersResponse: Decodable, Sendable { let members: [MemberDTO] }
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
}
struct LoginBody: Encodable, Sendable {
    let email: String
    let password: String
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

    init(
        displayName: String? = nil, timezone: String? = nil,
        statusEmoji: String? = nil, statusText: String? = nil
    ) {
        self.displayName = displayName
        self.timezone = timezone
        self.statusEmoji = statusEmoji
        self.statusText = statusText
    }
}
struct MarkNotificationsReadBody: Encodable, Sendable { let upToId: String }

// MARK: - WS events

struct TypingData: Decodable, Sendable {
    let userId: String
    let channelId: String
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
    case channelArchived(Channel)
    case memberJoined(MemberJoinedData)
    case memberLeft(MemberJoinedData)
    case reaction(ReactionEventData, added: Bool)
    case notification(NotificationItem)
    case userUpdated(User)
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
        case "message.created", "message.updated", "message.deleted", "thread.reply":
            payload = .message(try c.decode(Message.self, forKey: .data))
        case "typing":
            payload = .typing(try c.decode(TypingData.self, forKey: .data))
        case "presence":
            payload = .presence(try c.decode(PresenceData.self, forKey: .data))
        case "channel.created":
            payload = .channel(try c.decode(Channel.self, forKey: .data))
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

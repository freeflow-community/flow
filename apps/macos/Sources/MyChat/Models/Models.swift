import Foundation
import GRDB

// MARK: - Core entities (shared JSON DTO + GRDB record shapes)
//
// All ids are UUIDv7 strings: lexicographic order == chronological order.
// Timestamps are kept as ISO-8601 strings; sorting always uses ids.

struct User: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "user"

    var id: String
    var email: String
    var displayName: String
    var avatarUrl: String?
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

struct Channel: Codable, Sendable, Equatable, Identifiable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "channel"

    var id: String
    var workspaceId: String
    var name: String
    var topic: String?
    var isPrivate: Bool
    var createdBy: String
    var createdAt: String
    var archivedAt: String?
    var isMember: Bool
    var lastReadMsgId: String?
    var unreadCount: Int

    enum CodingKeys: String, CodingKey {
        case id, workspaceId, name, topic, isPrivate, createdBy, createdAt
        case archivedAt, isMember, lastReadMsgId, unreadCount
    }

    init(
        id: String, workspaceId: String, name: String, topic: String?,
        isPrivate: Bool, createdBy: String, createdAt: String, archivedAt: String?,
        isMember: Bool, lastReadMsgId: String?, unreadCount: Int
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.name = name
        self.topic = topic
        self.isPrivate = isPrivate
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.archivedAt = archivedAt
        self.isMember = isMember
        self.lastReadMsgId = lastReadMsgId
        self.unreadCount = unreadCount
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        workspaceId = try c.decode(String.self, forKey: .workspaceId)
        name = try c.decode(String.self, forKey: .name)
        topic = try c.decodeIfPresent(String.self, forKey: .topic)
        isPrivate = try c.decodeIfPresent(Bool.self, forKey: .isPrivate) ?? false
        createdBy = try c.decode(String.self, forKey: .createdBy)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        archivedAt = try c.decodeIfPresent(String.self, forKey: .archivedAt)
        isMember = try c.decodeIfPresent(Bool.self, forKey: .isMember) ?? false
        lastReadMsgId = try c.decodeIfPresent(String.self, forKey: .lastReadMsgId)
        unreadCount = try c.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
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
    /// Local-only: true for optimistic rows not yet confirmed by the server.
    var pending: Bool

    var isDeleted: Bool { deletedAt != nil }

    enum CodingKeys: String, CodingKey {
        case id, channelId, userId, threadRootId, clientMsgId, body
        case createdAt, editedAt, deletedAt, replyCount, lastReplyAt, pending
    }

    init(
        id: String, channelId: String, userId: String, threadRootId: String?,
        clientMsgId: String, body: String, createdAt: String, editedAt: String?,
        deletedAt: String?, replyCount: Int, lastReplyAt: String?, pending: Bool
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
}
struct EditMessageBody: Encodable, Sendable { let body: String }
struct ReadBody: Encodable, Sendable { let lastReadMsgId: String }

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

enum EventPayload: Sendable {
    case message(Message)
    case typing(TypingData)
    case presence(PresenceData)
    case channel(Channel)
    case memberJoined(MemberJoinedData)
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
        case "member.joined":
            payload = .memberJoined(try c.decode(MemberJoinedData.self, forKey: .data))
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

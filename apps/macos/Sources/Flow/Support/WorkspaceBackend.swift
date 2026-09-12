import Foundation

/// WorkspaceBackend — the provider contract the native clients consume
/// (docs/specs/multi-server-workspaces.md, "Provider abstraction and identity").
/// Mirrors `packages/shared/src/backend.ts` field for field so web, macOS and
/// iOS gate the same control on the same capability with the same wording.
///
/// One connection = one backend. Views and the sync layer consume this
/// protocol and the normalized models; they never build a provider path, and
/// an action whose capability is not `.supported` never falls through to a
/// Flow server mutation.
///
/// Shared by macOS and iOS (including the share extension). Nothing here
/// touches storage or the network.

enum CapabilityState: String, Codable, Sendable {
    case supported, limited, unavailable
}

/// A control's state plus the sentence the client shows for it.
struct Capability: Codable, Equatable, Sendable {
    var state: CapabilityState
    var reason: String?

    static let supported = Capability(state: .supported, reason: nil)
    static func limited(_ reason: String) -> Capability { Capability(state: .limited, reason: reason) }
    static func unavailable(_ reason: String) -> Capability { Capability(state: .unavailable, reason: reason) }

    var usable: Bool { state != .unavailable }
}

enum CapabilityName: String, Codable, CaseIterable, Sendable {
    case conversations, history, threads, send, edit, delete, reactions, files, search
    case readState, liveUpdates, typing, presence, pins, huddles, artifacts, agents, apps
    case admin, scheduledMessages, notifications, channelManagement
}

struct Capabilities: Codable, Equatable, Sendable {
    private var values: [CapabilityName: Capability]

    init(_ values: [CapabilityName: Capability]) { self.values = values }

    /// Every capability supported — the Flow backend's baseline.
    static let allSupported = Capabilities(Dictionary(uniqueKeysWithValues: CapabilityName.allCases.map { ($0, Capability.supported) }))

    /// Every capability set to `base`, then overridden per name.
    static func from(_ base: Capability, overrides: [CapabilityName: Capability]) -> Capabilities {
        var all = Dictionary(uniqueKeysWithValues: CapabilityName.allCases.map { ($0, base) })
        for (name, value) in overrides { all[name] = value }
        return Capabilities(all)
    }

    subscript(_ name: CapabilityName) -> Capability { values[name] ?? .unavailable("Not available for this workspace.") }
    func canUse(_ name: CapabilityName) -> Bool { self[name].usable }
}

enum BackendAuthStatus: String, Codable, Sendable {
    case authenticated, unauthorized, reauthorizationRequired = "reauthorization_required", signedOut = "signed_out"
}

struct BackendAuthState: Codable, Equatable, Sendable {
    var status: BackendAuthStatus
    /// Provider-native user id of the signed-in identity ("U…" for Slack).
    var userId: String?
    /// Human-readable identity line for the switcher.
    var label: String
    var detail: String?
}

/// Where a message came from and how to open it natively. Present only on
/// messages from a non-Flow provider.
struct MessageProvenance: Codable, Equatable, Sendable {
    var provider: ConnectionProvider
    /// Deep link into the provider's own client ("Open in Slack").
    var openUrl: String?
    /// True when the message carried content the client could not render
    /// faithfully: `body` is a safe textual fallback and the UI offers `openUrl`.
    var degraded: Bool
    var subtype: String?
}

struct HistoryPage: Sendable {
    /// Oldest first, like the transcript.
    var messages: [Message]
    var provenance: [String: MessageProvenance] = [:]
    /// Opaque provider cursor for the next older page; nil when exhausted.
    var cursor: String?
    /// True when the provider limited this page (rate budget, page cap,
    /// retention) so the transcript is shown as visibly partial.
    var partial: Bool
    var retryAfter: TimeInterval?
}

struct ThreadPage: Sendable {
    var root: Message
    var replies: [Message]
    var cursor: String?
    var partial: Bool
    var retryAfter: TimeInterval?
}

struct SendMessageInput: Sendable {
    var channelId: String
    var body: String
    /// Client-generated idempotency key; echoed back so a timeout can be
    /// reconciled without a blind retry.
    var clientMsgId: String
    var threadRootId: String?
    var fileIds: [String] = []
}

enum BackendEvent: Sendable {
    case messageCreated(Message)
    case messageUpdated(Message)
    case messageDeleted(channelId: String, messageId: String, threadRootId: String?)
    case threadReply(Message)
    case reactionChanged(channelId: String, messageId: String, emoji: String, userId: String, added: Bool)
    case channelUpdated(Channel)
    case channelRead(channelId: String, lastReadMsgId: String?)
    case typing(channelId: String, userId: String, threadRootId: String?)
    case presence(userId: String, online: Bool)
    case authChanged(BackendAuthState)
    case capabilitiesChanged(Capabilities)
    /// The live stream is degraded: events may be missing until `resumesAt`.
    case streamDegraded(reason: String, resumesAt: Date?)
    case streamRecovered
}

enum BackendErrorCode: String, Sendable {
    case unsupported, rateLimited = "rate_limited", unauthorized, notFound = "not_found", invalid, timeout, providerError = "provider_error"
}

struct BackendError: Error, Equatable, Sendable {
    var code: BackendErrorCode
    var message: String
    var retryAfter: TimeInterval?
    var providerCode: String?
}

/// The contract. Implemented by `FlowBackend` (Flow REST/WS) and `SlackBackend`
/// (the connector's public-API baseline).
protocol WorkspaceBackend: AnyObject, Sendable {
    var provider: ConnectionProvider { get }
    var connectionId: String { get }

    func auth() async -> BackendAuthState
    func capabilities() async -> Capabilities

    func listWorkspaces() async throws -> [Workspace]
    func listConversations(workspaceId: String) async throws -> [Channel]
    func listMembers(workspaceId: String) async throws -> [Member]

    /// Older messages before `cursor` (nil = latest page). Oldest first.
    func history(channelId: String, cursor: String?, limit: Int) async throws -> HistoryPage
    func thread(channelId: String, rootId: String, cursor: String?) async throws -> ThreadPage

    func send(_ input: SendMessageInput) async throws -> Message
    func edit(channelId: String, messageId: String, body: String) async throws -> Message
    func delete(channelId: String, messageId: String) async throws
    func setReaction(channelId: String, messageId: String, emoji: String, on: Bool) async throws
    func markRead(channelId: String, messageId: String) async throws

    func uploadFile(channelId: String, data: Data, name: String, mimeType: String) async throws -> FileAttachment
    func fileURL(_ file: FileAttachment) -> URL?

    /// The normalized live stream. Finishes when the backend is torn down.
    func events() -> AsyncStream<BackendEvent>

    /// Deep link for "Open in <provider>", or nil when the provider has none.
    func openURL(channelId: String, messageId: String?) -> URL?
}

// MARK: - Identity helpers (spec: provider-native ids as strings; Slack `ts` verbatim)

enum SlackIdentity {
    /// Slack's message timestamp: seconds, a dot, six digits. An identifier,
    /// never parsed for arithmetic, never reformatted.
    static func isTs(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, (9...11).contains(parts[0].count), parts[1].count == 6 else { return false }
        return parts.allSatisfy { $0.allSatisfy(\.isNumber) }
    }

    /// Display-only conversion; integer math on the two halves, no floating point.
    static func date(fromTs ts: String) -> Date? {
        guard isTs(ts) else { return nil }
        let parts = ts.split(separator: ".")
        guard let seconds = Int64(parts[0]), let micros = Int64(parts[1]) else { return nil }
        let ms = seconds * 1000 + micros / 1000
        return Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
    }

    /// `providerIdentity` serialization shared with the web registry:
    /// `["slack", enterpriseId-or-null, teamId, userId]`.
    static func identityString(environment: String = "slack", enterpriseId: String?, teamId: String, userId: String) -> String {
        let parts: [Any] = [environment, enterpriseId as Any? ?? NSNull(), teamId, userId]
        let data = (try? JSONSerialization.data(withJSONObject: parts, options: [.withoutEscapingSlashes])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// Cache key for a Slack message: connection, team, channel and the exact `ts`.
    static func messageKey(connectionId: String, teamId: String, channelId: String, ts: String) -> String? {
        guard isTs(ts) else { return nil }
        return "slack:\(connectionId):\(teamId):\(channelId):\(ts)"
    }
}

import Foundation

/// SlackBackend — the WorkspaceBackend a connected Slack team speaks natively,
/// over the Flow Slack connector's public-API baseline (#545). Shared by macOS
/// and iOS (and the share extension once it lists Slack connections).
///
/// The connector already normalizes Slack payloads into the shared DTO shapes,
/// so this class decodes them into the native models, states capabilities with
/// honest reasons, surfaces the rate budget as `.rateLimited` with the wait
/// instead of retrying, and polls the connector's per-grant event stream.
/// Nothing here builds a Slack URL except the Open in Slack deep link.
final class SlackBackend: WorkspaceBackend, @unchecked Sendable {
    typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    let provider: ConnectionProvider = .slack
    let connectionId: String
    let origin: URL
    let teamId: String
    let userId: String

    private let credential: @Sendable () -> String?
    private let transport: Transport
    private let decoder = JSONDecoder()
    private let lock = NSLock()
    private var caps: Capabilities
    private var authState: BackendAuthState
    private var streamSeq = 0
    /// Continuations of live `events()` streams; the poller feeds all of them.
    private var listeners: [UUID: AsyncStream<BackendEvent>.Continuation] = [:]
    private var poller: Task<Void, Never>?
    private var members: [String: User] = [:]
    /// False in tests, which call `pollOnce()` themselves.
    private let autoPoll: Bool

    static let streamInterval: Duration = .seconds(3)

    init(
        connectionId: String, origin: URL, teamId: String, userId: String, label: String,
        granted: [String: Bool], credential: @escaping @Sendable () -> String?,
        transport: Transport? = nil, autoPoll: Bool = true
    ) {
        self.connectionId = connectionId
        self.origin = origin
        self.teamId = teamId
        self.userId = userId
        self.credential = credential
        self.autoPoll = autoPoll
        self.transport = transport ?? { request in
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw BackendError(code: .providerError, message: "No HTTP response") }
            return (data, http)
        }
        self.caps = SlackBackend.capabilities(granted: granted)
        self.authState = BackendAuthState(status: credential() == nil ? .signedOut : .authenticated, userId: userId, label: label)
    }

    deinit { poller?.cancel() }

    // MARK: - Capabilities

    /// Connector capability flags (manifest.js grantedCapabilities) -> the UI's
    /// tri-state per control. Same wording as the web client.
    static func capabilities(granted: [String: Bool]) -> Capabilities {
        let flow = Capability.unavailable("Not available in Slack workspaces. Open in Slack for this.")
        func scope(_ name: String) -> Capability { .unavailable("This Slack app has not been granted \(name) permissions.") }
        let on = { (key: String) in granted[key] == true }
        return Capabilities.from(flow, overrides: [
            .conversations: on("readConversations") ? .supported : scope("conversation"),
            .history: on("readHistory") ? .limited("Slack allows this app one history page per minute, 15 messages at a time. Older messages load slowly.") : scope("history"),
            .threads: on("readHistory") ? .limited("Thread replies load under the same Slack history limit.") : scope("history"),
            .send: on("sendAsUser") ? .supported : scope("send"),
            .edit: on("sendAsUser") ? .supported : scope("send"),
            .delete: on("sendAsUser") ? .supported : scope("send"),
            .reactions: on("reactions") ? .supported : scope("reaction"),
            .files: on("files") ? .limited("Files upload to Slack; previews open in Slack.") : .unavailable("File uploads need a Slack permission this app does not have. Attachments open in Slack."),
            .search: on("search") ? .supported : scope("search"),
            .readState: on("readState") ? .supported : .unavailable("Read markers are not shared with Slack; unread state stays on this device."),
            .liveUpdates: on("liveUpdates") ? .limited("New messages arrive through the Flow Slack connector with a short delay.") : .unavailable("Live updates need the Slack app to subscribe to message events."),
            .typing: .unavailable("Typing indicators are not available for Slack workspaces."),
            .presence: .unavailable("Presence is not available for Slack workspaces."),
            .notifications: on("liveUpdates")
                ? .limited("Mentions and direct messages alert you only while Flow is open. Slack has no push to Flow when it is closed.")
                : .unavailable("Slack notifications need the Slack app to subscribe to message events."),
        ])
    }

    // MARK: - Transport

    private struct ErrorBody: Decodable { let error: String? }

    private func request<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil, as type: T.Type) async throws -> T {
        let data = try await raw(method, path, body: body)
        do { return try decoder.decode(T.self, from: data) } catch {
            throw BackendError(code: .providerError, message: "Unreadable reply from the Slack connector.")
        }
    }

    private func raw(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Data {
        guard let token = credential() else { throw BackendError(code: .unauthorized, message: "Slack authorization expired. Reauthorize this connection.") }
        guard let url = URL(string: "\(origin.absoluteString.hasSuffix("/") ? String(origin.absoluteString.dropLast()) : origin.absoluteString)/\(path)") else {
            throw BackendError(code: .invalid, message: "Bad connector path.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response): (Data, HTTPURLResponse)
        do { (data, response) = try await transport(request) } catch let error as BackendError { throw error } catch {
            throw BackendError(code: .timeout, message: "Slack connector unreachable: \(error.localizedDescription)")
        }
        if (200..<300).contains(response.statusCode) { return data }
        let code = (try? decoder.decode(ErrorBody.self, from: data))?.error ?? "http_\(response.statusCode)"
        switch response.statusCode {
        case 429:
            let seconds = TimeInterval(response.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 60
            throw BackendError(code: .rateLimited, message: "Slack asked Flow to wait \(Int(seconds)) seconds before loading more.", retryAfter: seconds, providerCode: code)
        case 401:
            setAuth(BackendAuthState(status: .reauthorizationRequired, userId: userId, label: authState.label, detail: code))
            throw BackendError(code: .unauthorized, message: "Slack authorization expired. Reauthorize this connection.", providerCode: code)
        case 403 where code == "missing_scopes":
            throw BackendError(code: .unsupported, message: "This Slack app has not been granted the permission for that.", providerCode: code)
        case 404:
            throw BackendError(code: .notFound, message: "Slack could not find that.", providerCode: code)
        case 400..<500:
            throw BackendError(code: .invalid, message: "Slack did not allow that action.", providerCode: code)
        default:
            throw BackendError(code: .providerError, message: "The Slack connector failed (\(code)).", providerCode: code)
        }
    }

    /// Synchronous critical section; callable from async code where the raw
    /// lock/unlock pair is not.
    private func synced<T>(_ body: () -> T) -> T { lock.lock(); defer { lock.unlock() }; return body() }

    private func emit(_ event: BackendEvent) {
        lock.lock(); let sinks = Array(listeners.values); lock.unlock()
        for sink in sinks { sink.yield(event) }
    }

    private func setAuth(_ next: BackendAuthState) {
        lock.lock()
        let changed = next != authState
        authState = next
        lock.unlock()
        if changed { emit(.authChanged(next)) }
    }

    private func setCapabilities(granted: [String: Bool]) {
        let next = SlackBackend.capabilities(granted: granted)
        lock.lock()
        let changed = next != caps
        caps = next
        lock.unlock()
        if changed { emit(.capabilitiesChanged(next)) }
    }

    // MARK: - Contract

    func auth() async -> BackendAuthState { synced { authState } }
    func capabilities() async -> Capabilities { synced { caps } }

    private struct ConnectionInfo: Decodable {
        struct Identity: Decodable { let teamId: String; let userId: String }
        let identity: Identity
        let teamName: String
        let userName: String
        let capabilities: [String: Bool]
        let grantStatus: String
    }

    func currentUser() async throws -> User {
        let info = try await request("GET", "v1/connection", as: ConnectionInfo.self)
        setCapabilities(granted: info.capabilities)
        if info.grantStatus == "active" {
            setAuth(BackendAuthState(status: .authenticated, userId: info.identity.userId, label: "\(info.teamName) · \(info.userName)"))
        } else {
            setAuth(BackendAuthState(status: .reauthorizationRequired, userId: info.identity.userId, label: authState.label, detail: info.grantStatus))
        }
        let profile = try? await listMembers(workspaceId: teamId).first { $0.id == info.identity.userId }
        return profile ?? User(id: info.identity.userId, email: "", displayName: info.userName, avatarUrl: nil)
    }

    func signOut() async throws {
        _ = try? await raw("DELETE", "v1/session")
        setAuth(BackendAuthState(status: .signedOut, userId: userId, label: authState.label))
    }

    func listWorkspaces() async throws -> [Workspace] {
        [try await request("GET", "v1/workspace", as: Workspace.self)]
    }

    private struct Conversations: Decodable { let conversations: [Channel] }
    func listConversations(workspaceId: String) async throws -> [Channel] {
        try await request("GET", "v1/conversations", as: Conversations.self).conversations
    }

    /// The connector's member DTO (WorkspaceMemberDTO) -> the native `User`.
    struct MemberRow: Decodable {
        let userId: String; let displayName: String; let email: String; let avatarUrl: String?
        let statusEmoji: String; let statusText: String; let title: String; let isAgent: Bool; let isBot: Bool
        let sponsorId: String?; let privacyMode: Bool; let role: String
        var user: User { User(id: userId, email: email, displayName: displayName, avatarUrl: avatarUrl, statusEmoji: statusEmoji, statusText: statusText, title: title, isAgent: isAgent, isBot: isBot, sponsorId: sponsorId, privacyMode: privacyMode) }
    }
    private struct Members: Decodable { let members: [MemberRow] }
    func listMembers(workspaceId: String) async throws -> [User] {
        let users = try await request("GET", "v1/members", as: Members.self).members.map(\.user)
        let byId = Dictionary(users.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        synced { members = byId }
        return users
    }

    /// The connector's HistoryPage JSON: messages carry `provenance`, which the
    /// native `Message` (a database row) does not store; it is split off here.
    private struct ProvenanceRow: Decodable { let id: String; let provenance: MessageProvenance? }
    private struct HistoryPayload: Decodable { let messages: [Message]; let cursor: String?; let partial: Bool; let retryAfterMs: Double? }
    private struct ProvenancePayload: Decodable { let messages: [ProvenanceRow] }

    /// One page per minute, 15 messages each, for this app (measured). A short
    /// page with more behind it is `partial`; a 429 is `.rateLimited` with the
    /// wait, never a retry loop.
    func history(channelId: String, cursor: String?, limit: Int) async throws -> HistoryPage {
        var path = "v1/history?channel=\(encode(channelId))&limit=\(min(limit, 15))"
        if let cursor { path += "&cursor=\(encode(cursor))" }
        let data = try await raw("GET", path)
        let page = try decoder.decode(HistoryPayload.self, from: data)
        let provenance = (try? decoder.decode(ProvenancePayload.self, from: data))?.messages ?? []
        return HistoryPage(
            messages: page.messages,
            provenance: Dictionary(uniqueKeysWithValues: provenance.compactMap { row in row.provenance.map { (row.id, $0) } }),
            cursor: page.cursor, partial: page.partial, retryAfter: page.retryAfterMs.map { $0 / 1000 }
        )
    }

    private struct ThreadPayload: Decodable { let root: Message; let replies: [Message]; let cursor: String?; let partial: Bool }
    func thread(channelId: String, rootId: String, cursor: String?) async throws -> ThreadPage {
        var path = "v1/replies?channel=\(encode(channelId))&ts=\(encode(rootId))"
        if let cursor { path += "&cursor=\(encode(cursor))" }
        let page = try await request("GET", path, as: ThreadPayload.self)
        return ThreadPage(root: page.root, replies: page.replies, cursor: page.cursor, partial: page.partial)
    }

    private struct SendPayload: Decodable { let message: Message }
    func send(_ input: SendMessageInput) async throws -> Message {
        if !input.fileIds.isEmpty { throw BackendError(code: .unsupported, message: caps[.files].reason ?? "Files are not available.") }
        var body: [String: Any] = ["channel": input.channelId, "text": input.body]
        if let threadRootId = input.threadRootId { body["thread_ts"] = threadRootId }
        var message = try await request("POST", "v1/messages", body: body, as: SendPayload.self).message
        // Slack does not echo a client message id; stamp ours so the pending
        // row reconciles by clientMsgId the way a Flow send does.
        message.clientMsgId = input.clientMsgId
        return message
    }

    func edit(channelId: String, messageId: String, body: String) async throws -> Message {
        try await request("PATCH", "v1/messages", body: ["channel": channelId, "ts": messageId, "text": body], as: Message.self)
    }

    func delete(channelId: String, messageId: String, purge: Bool) async throws {
        _ = try await raw("DELETE", "v1/messages", body: ["channel": channelId, "ts": messageId])
    }

    func setReaction(channelId: String, messageId: String, emoji: String, on: Bool) async throws {
        guard let name = SlackBackend.shortcode(for: emoji) else { throw BackendError(code: .unsupported, message: "Slack does not know this emoji.") }
        _ = try await raw("POST", "v1/reactions", body: ["channel": channelId, "ts": messageId, "name": name, "on": on])
    }

    func markRead(channelId: String, messageId: String, threadRootId: String?) async throws {
        // Local-only read state until the scope is granted — never a Flow mutation.
        guard caps[.readState].usable else { return }
        _ = try await raw("POST", "v1/read", body: ["channel": channelId, "ts": messageId])
    }

    func uploadFile(workspaceId: String, channelId: String, data: Data, name: String, mimeType: String) async throws -> FileAttachment {
        throw BackendError(code: .unsupported, message: caps[.files].reason ?? "File uploads are not available.")
    }

    /// No file bytes flow through Flow: previews and downloads open in Slack.
    func fileURL(_ file: FileAttachment) -> URL? { nil }

    private struct StreamPayload: Decodable { let events: [StreamEvent]; let seq: Int; let gap: Bool }
    /// The connector's BackendEvent JSON, decoded by `type`.
    struct StreamEvent: Decodable {
        let type: String
        let message: Message?
        let channelId: String?
        let messageId: String?
        let threadRootId: String?
        let emoji: String?
        let userId: String?

        var event: BackendEvent? {
            switch type {
            case "message.created": return message.map { .messageCreated($0) }
            case "message.updated": return message.map { .messageUpdated($0) }
            case "thread.reply": return message.map { .threadReply($0) }
            case "message.deleted":
                guard let channelId, let messageId else { return nil }
                return .messageDeleted(channelId: channelId, messageId: messageId, threadRootId: threadRootId)
            case "reaction.added", "reaction.removed":
                guard let channelId, let messageId, let emoji, let userId else { return nil }
                return .reactionChanged(channelId: channelId, messageId: messageId, emoji: emoji, userId: userId, added: type == "reaction.added")
            default: return nil
            }
        }
    }

    /// Chat events polled from the connector's per-grant stream. Falling behind
    /// its retention is reported as degraded-then-recovered, which the sync
    /// layer treats as "refetch what is on screen".
    func events() -> AsyncStream<BackendEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            lock.lock()
            listeners[id] = continuation
            let start = poller == nil
            lock.unlock()
            continuation.onTermination = { [weak self] _ in
                guard let self else { return }
                self.lock.lock()
                self.listeners[id] = nil
                let stop = self.listeners.isEmpty
                let task = self.poller
                if stop { self.poller = nil }
                self.lock.unlock()
                if stop { task?.cancel() }
            }
            if start && autoPoll { startPolling() }
        }
    }

    private func startPolling() {
        let task = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollOnce()
                try? await Task.sleep(for: SlackBackend.streamInterval)
            }
        }
        lock.lock(); poller = task; lock.unlock()
    }

    /// One poll of `/v1/stream`; exposed for tests.
    func pollOnce() async {
        guard credential() != nil else { return }
        do {
            let page = try await request("GET", "v1/stream?since=\(streamSeq)", as: StreamPayload.self)
            if page.gap {
                emit(.streamDegraded(reason: "Missed Slack events while away.", resumesAt: nil))
                emit(.streamRecovered)
            }
            for event in page.events.compactMap(\.event) { emit(event) }
            streamSeq = page.seq
        } catch let error as BackendError where error.code == .rateLimited {
            emit(.streamDegraded(reason: error.message, resumesAt: error.retryAfter.map { Date().addingTimeInterval($0) }))
        } catch { /* reported by the next request that needs the grant */ }
    }

    func openURL(channelId: String, messageId: String?) -> URL? {
        var text = "https://app.slack.com/client/\(teamId)/\(channelId)"
        if let messageId { text += "/p\(messageId.replacingOccurrences(of: ".", with: ""))" }
        return URL(string: text)
    }

    // MARK: - Helpers

    private func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value
    }

    /// Unicode emoji -> Slack reaction name, from the shared shortcode table
    /// (EmojiShortcodes mirrors packages/shared/src/emoji.ts).
    static func shortcode(for emoji: String) -> String? {
        if emoji.hasPrefix(":"), emoji.hasSuffix(":"), emoji.count > 2 { return String(emoji.dropFirst().dropLast()) }
        return EmojiShortcodes.name(for: emoji)
    }
}

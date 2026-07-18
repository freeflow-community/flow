import Foundation
import GRDB

/// Owns all GRDB writes and coordinates APIClient + SocketClient.
/// SwiftUI never writes to the database; it calls engine methods and
/// observes the database via ValueObservation.
actor SyncEngine {
    private let db: AppDatabase
    private let api: APIClient
    private let socket: SocketClient
    private weak var appState: AppState?

    private var currentUser: User?
    private var activeWorkspaceId: String?
    private var activeChannelId: String?
    private var openThreadRootId: String?
    private var socketConsumer: Task<Void, Never>?
    private var typingLastSent: [String: Date] = [:]

    private static let currentUserIdKey = "currentUserId"

    init(db: AppDatabase, api: APIClient, socket: SocketClient) {
        self.db = db
        self.api = api
        self.socket = socket
    }

    func attach(_ appState: AppState) {
        self.appState = appState
    }

    var currentUserId: String? { currentUser?.id }

    // MARK: - Auth

    func bootstrap() async {
        guard let token = Keychain.loadToken() else {
            await appState?.setPhase(.signedOut)
            return
        }
        await api.setToken(token)
        do {
            let me: User = try await api.get("/v1/me")
            await didSignIn(user: me, token: token)
        } catch let e as APIError where e.status == 401 {
            Keychain.deleteToken()
            await api.setToken(nil)
            await appState?.setPhase(.signedOut)
        } catch {
            // Server unreachable: start offline from the cache if possible.
            let cachedId = UserDefaults.standard.string(forKey: Self.currentUserIdKey)
            let cached: User? = if let cachedId {
                try? await db.reader.read { db in try User.fetchOne(db, key: cachedId) }
            } else { nil }
            if let cached {
                currentUser = cached
                await appState?.setPhase(.signedIn(cached))
                startSocket(token: token)
            } else {
                await appState?.setPhase(.signedOut)
            }
        }
    }

    func register(email: String, password: String, displayName: String) async throws {
        let resp: AuthResponse = try await api.post(
            "/v1/auth/register",
            body: RegisterBody(email: email, password: password, displayName: displayName)
        )
        await api.setToken(resp.token)
        await didSignIn(user: resp.user, token: resp.token)
    }

    func login(email: String, password: String) async throws {
        let resp: AuthResponse = try await api.post(
            "/v1/auth/login",
            body: LoginBody(email: email, password: password)
        )
        await api.setToken(resp.token)
        await didSignIn(user: resp.user, token: resp.token)
    }

    func logout() async {
        let _: OkResponse? = try? await api.post("/v1/auth/logout")
        Keychain.deleteToken()
        UserDefaults.standard.removeObject(forKey: Self.currentUserIdKey)
        await api.setToken(nil)
        await socket.stop()
        socketConsumer?.cancel()
        socketConsumer = nil
        currentUser = nil
        activeWorkspaceId = nil
        activeChannelId = nil
        openThreadRootId = nil
        try? await db.writer.write { db in try AppDatabase.wipe(db) }
        await appState?.didSignOut()
    }

    private func didSignIn(user: User, token: String) async {
        currentUser = user
        Keychain.saveToken(token)
        UserDefaults.standard.set(user.id, forKey: Self.currentUserIdKey)
        try? await db.writer.write { db in try user.save(db) }
        await appState?.setPhase(.signedIn(user))
        startSocket(token: token)
        await refreshWorkspaces()
    }

    // MARK: - Socket lifecycle

    private func startSocket(token: String) {
        socketConsumer?.cancel()
        socketConsumer = Task { [socket] in
            let stream = await socket.start(token: token)
            for await signal in stream {
                if Task.isCancelled { break }
                await self.handle(signal)
            }
        }
    }

    private func handle(_ signal: SocketSignal) async {
        switch signal {
        case .connected:
            await appState?.setConnection(.connected)
            await backfillAfterReconnect()
        case .disconnected:
            await appState?.setConnection(.reconnecting)
        case .event(let event):
            await handleEvent(event)
        }
    }

    private func backfillAfterReconnect() async {
        await refreshWorkspaces()
        if let ws = activeWorkspaceId {
            await refreshChannels(workspaceId: ws)
            await refreshMembers(workspaceId: ws)
        }
        if let ch = activeChannelId {
            await backfillChannel(ch)
        }
        if let root = openThreadRootId {
            await fetchThread(rootId: root)
        }
    }

    /// Fills the gap between the server head and our newest local message by
    /// paging backwards (cursor `before`) until we overlap local history.
    private func backfillChannel(_ channelId: String) async {
        let newestLocalId: String? = try? await db.reader.read { db in
            try String.fetchOne(
                db,
                sql: "SELECT id FROM message WHERE channelId = ? AND pending = 0 ORDER BY id DESC LIMIT 1",
                arguments: [channelId]
            )
        }
        var before: String? = nil
        var pages = 0
        while pages < 5 {
            let query: [URLQueryItem] = [
                URLQueryItem(name: "limit", value: "50"),
                before.map { URLQueryItem(name: "before", value: $0) },
            ].compactMap(\.self)
            guard let resp: MessagesResponse = try? await api.get(
                "/v1/channels/\(channelId)/messages", query: query
            ) else { break }
            pages += 1
            await storeMessages(resp.messages)
            if before == nil {
                await appState?.setHasMore(channelId: channelId, resp.hasMore)
            }
            guard resp.hasMore, let oldest = resp.messages.last?.id else { break }
            if let newest = newestLocalId, oldest <= newest { break }
            before = oldest
        }
    }

    // MARK: - Workspaces

    func refreshWorkspaces() async {
        guard let resp: WorkspacesResponse = try? await api.get("/v1/me/workspaces") else { return }
        let workspaces = resp.workspaces
        try? await db.writer.write { db in
            let ids = workspaces.map(\.id)
            try Workspace.filter(!ids.contains(Column("id"))).deleteAll(db)
            for w in workspaces { try w.save(db) }
        }
    }

    func selectWorkspace(_ id: String?) async {
        activeWorkspaceId = id
        activeChannelId = nil
        openThreadRootId = nil
        guard let id else { return }
        await refreshChannels(workspaceId: id)
        await refreshMembers(workspaceId: id)
    }

    func createWorkspace(name: String, slug: String) async throws -> Workspace {
        let ws: Workspace = try await api.post(
            "/v1/workspaces",
            body: CreateWorkspaceBody(name: name, slug: slug)
        )
        try? await db.writer.write { db in try ws.save(db) }
        return ws
    }

    func createInvite(workspaceId: String, email: String) async throws -> String {
        let resp: InviteResponse = try await api.post(
            "/v1/workspaces/\(workspaceId)/invites",
            body: CreateInviteBody(email: email)
        )
        return resp.inviteUrl
    }

    func acceptInvite(token: String) async throws -> Workspace {
        let ws: Workspace = try await api.post(
            "/v1/invites/accept",
            body: AcceptInviteBody(token: token)
        )
        try? await db.writer.write { db in try ws.save(db) }
        await refreshWorkspaces()
        return ws
    }

    func refreshMembers(workspaceId: String) async {
        guard let resp: MembersResponse = try? await api.get("/v1/workspaces/\(workspaceId)/members")
        else { return }
        let members = resp.members
        try? await db.writer.write { db in
            try Member.filter(Column("workspaceId") == workspaceId).deleteAll(db)
            for m in members {
                // Preserve createdAt if we already know this user.
                let existing = try User.fetchOne(db, key: m.userId)
                try User(
                    id: m.userId,
                    email: m.email,
                    displayName: m.displayName,
                    avatarUrl: m.avatarUrl,
                    createdAt: existing?.createdAt
                ).save(db)
                try Member(workspaceId: workspaceId, userId: m.userId, role: m.role).save(db)
            }
        }
    }

    // MARK: - Channels

    func refreshChannels(workspaceId: String) async {
        guard let resp: ChannelsResponse = try? await api.get("/v1/workspaces/\(workspaceId)/channels")
        else { return }
        let channels = resp.channels
        try? await db.writer.write { db in
            let ids = channels.map(\.id)
            try Channel
                .filter(Column("workspaceId") == workspaceId && !ids.contains(Column("id")))
                .deleteAll(db)
            for c in channels { try c.save(db) }
        }
    }

    func createChannel(workspaceId: String, name: String, topic: String?, isPrivate: Bool) async throws -> Channel {
        let ch: Channel = try await api.post(
            "/v1/workspaces/\(workspaceId)/channels",
            body: CreateChannelBody(name: name, topic: topic, isPrivate: isPrivate)
        )
        try? await db.writer.write { db in try ch.save(db) }
        return ch
    }

    func joinChannel(_ channelId: String) async throws -> Channel {
        let ch: Channel = try await api.post("/v1/channels/\(channelId)/join")
        try? await db.writer.write { db in try ch.save(db) }
        return ch
    }

    func selectChannel(_ channelId: String?) async {
        activeChannelId = channelId
        openThreadRootId = nil
        guard let channelId else { return }
        do {
            let resp: MessagesResponse = try await api.get(
                "/v1/channels/\(channelId)/messages",
                query: [URLQueryItem(name: "limit", value: "50")]
            )
            await storeMessages(resp.messages)
            await appState?.setHasMore(channelId: channelId, resp.hasMore)
            if let newest = resp.messages.first?.id {
                await markRead(channelId: channelId, lastReadMsgId: newest)
            } else {
                try? await db.writer.write { db in
                    try db.execute(
                        sql: "UPDATE channel SET unreadCount = 0 WHERE id = ?",
                        arguments: [channelId]
                    )
                }
            }
        } catch {
            // Offline: render from cache.
        }
    }

    func loadOlder(channelId: String) async {
        let oldest: String? = try? await db.reader.read { db in
            try String.fetchOne(
                db,
                sql: "SELECT id FROM message WHERE channelId = ? AND pending = 0 AND threadRootId IS NULL ORDER BY id ASC LIMIT 1",
                arguments: [channelId]
            )
        }
        guard let oldest else { return }
        guard let resp: MessagesResponse = try? await api.get(
            "/v1/channels/\(channelId)/messages",
            query: [
                URLQueryItem(name: "before", value: oldest),
                URLQueryItem(name: "limit", value: "50"),
            ]
        ) else { return }
        await storeMessages(resp.messages)
        await appState?.setHasMore(channelId: channelId, resp.hasMore)
    }

    func markRead(channelId: String, lastReadMsgId: String) async {
        try? await db.writer.write { db in
            try db.execute(
                sql: "UPDATE channel SET unreadCount = 0, lastReadMsgId = ? WHERE id = ?",
                arguments: [lastReadMsgId, channelId]
            )
        }
        let _: OkResponse? = try? await api.post(
            "/v1/channels/\(channelId)/read",
            body: ReadBody(lastReadMsgId: lastReadMsgId)
        )
    }

    // MARK: - Messages

    func sendMessage(channelId: String, body: String, threadRootId: String? = nil) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let uid = currentUser?.id else { return }
        let clientMsgId = UUID().uuidString.lowercased()
        let now = ISO8601.now()
        let local = Message(
            id: UUIDv7.generate(),
            channelId: channelId,
            userId: uid,
            threadRootId: threadRootId,
            clientMsgId: clientMsgId,
            body: trimmed,
            createdAt: now,
            editedAt: nil,
            deletedAt: nil,
            replyCount: 0,
            lastReplyAt: nil,
            pending: true
        )
        // Optimistic insert; the POST response or WS echo reconciles it.
        try? await db.writer.write { db in
            try local.save(db)
            if let root = threadRootId {
                try db.execute(
                    sql: "UPDATE message SET replyCount = replyCount + 1, lastReplyAt = ? WHERE id = ?",
                    arguments: [now, root]
                )
            }
        }
        do {
            let server: Message = try await api.post(
                "/v1/channels/\(channelId)/messages",
                body: SendMessageBody(clientMsgId: clientMsgId, body: trimmed, threadRootId: threadRootId)
            )
            _ = await applyServerMessage(server)
        } catch {
            await appState?.showError("Couldn't send message: \(error.localizedDescription)")
        }
    }

    func editMessage(id: String, body: String) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let updated: Message = try await api.patch(
                "/v1/messages/\(id)",
                body: EditMessageBody(body: trimmed)
            )
            _ = await applyServerMessage(updated)
        } catch {
            await appState?.showError("Couldn't edit message: \(error.localizedDescription)")
        }
    }

    func deleteMessage(id: String) async {
        do {
            let _: OkResponse = try await api.delete("/v1/messages/\(id)")
            let now = ISO8601.now()
            try? await db.writer.write { db in
                try db.execute(
                    sql: "UPDATE message SET deletedAt = ?, body = '' WHERE id = ?",
                    arguments: [now, id]
                )
            }
        } catch {
            await appState?.showError("Couldn't delete message: \(error.localizedDescription)")
        }
    }

    // MARK: - Threads

    func openThread(rootId: String?) async {
        openThreadRootId = rootId
        guard let rootId else { return }
        await fetchThread(rootId: rootId)
    }

    private func fetchThread(rootId: String) async {
        guard let resp: ThreadResponse = try? await api.get(
            "/v1/messages/\(rootId)/thread",
            query: [URLQueryItem(name: "limit", value: "100")]
        ) else { return }
        await storeMessages([resp.root] + resp.messages)
    }

    // MARK: - Typing

    /// Throttled to one frame per ~3s per channel.
    func typing(channelId: String) async {
        let now = Date()
        if let last = typingLastSent[channelId], now.timeIntervalSince(last) < 3 { return }
        typingLastSent[channelId] = now
        await socket.sendTyping(channelId: channelId)
    }

    // MARK: - Event handling

    private func handleEvent(_ event: EventDTO) async {
        switch event.payload {
        case .message(let m):
            let isNew = await applyServerMessage(m)
            if event.type == "message.created", isNew, m.userId != currentUser?.id {
                if m.channelId == activeChannelId {
                    await markRead(channelId: m.channelId, lastReadMsgId: m.id)
                } else {
                    try? await db.writer.write { db in
                        try db.execute(
                            sql: "UPDATE channel SET unreadCount = unreadCount + 1 WHERE id = ? AND isMember = 1",
                            arguments: [m.channelId]
                        )
                    }
                }
            }

        case .typing(let t):
            if t.userId != currentUser?.id {
                await appState?.typingReceived(channelId: t.channelId, userId: t.userId)
            }

        case .presence(let p):
            await appState?.presenceReceived(userId: p.userId, online: p.status == "online")

        case .channel(let dto):
            // The broadcast DTO claims isMember from the creator's perspective;
            // only trust it if we created the channel.
            var c = dto
            if c.createdBy != currentUser?.id { c.isMember = false }
            c.unreadCount = 0
            c.lastReadMsgId = nil
            let toSave = c
            try? await db.writer.write { db in
                if try Channel.fetchOne(db, key: toSave.id) == nil {
                    try toSave.save(db)
                }
            }

        case .memberJoined(let mj):
            if event.workspaceId == activeWorkspaceId {
                await refreshMembers(workspaceId: event.workspaceId)
            }
            if mj.userId == currentUser?.id {
                await refreshChannels(workspaceId: event.workspaceId)
            }

        case .unknown:
            break
        }
    }

    // MARK: - Write helpers

    /// Saves a server-authoritative message row, removing any optimistic
    /// pending row with the same clientMsgId. Returns true if this message
    /// was not previously known in any form (drives unread/reply-count bumps).
    private func applyServerMessage(_ m: Message) async -> Bool {
        let isNew: Bool? = try? await db.writer.write { db in
            let existed = try Message.filter(key: m.id).fetchCount(db) > 0
            let pendingDeleted = try Message
                .filter(Column("channelId") == m.channelId)
                .filter(Column("clientMsgId") == m.clientMsgId)
                .filter(Column("id") != m.id)
                .deleteAll(db)
            try m.save(db)
            let isNew = !existed && pendingDeleted == 0
            if isNew, let root = m.threadRootId {
                try db.execute(
                    sql: "UPDATE message SET replyCount = replyCount + 1, lastReplyAt = ? WHERE id = ?",
                    arguments: [m.createdAt, root]
                )
            }
            return isNew
        }
        return isNew ?? false
    }

    /// Bulk store for history/backfill pages (no unread or reply-count bumps:
    /// server rows already carry authoritative rollups).
    private func storeMessages(_ messages: [Message]) async {
        guard !messages.isEmpty else { return }
        try? await db.writer.write { db in
            for m in messages {
                try Message
                    .filter(Column("channelId") == m.channelId)
                    .filter(Column("clientMsgId") == m.clientMsgId)
                    .filter(Column("id") != m.id)
                    .filter(Column("pending") == true)
                    .deleteAll(db)
                try m.save(db)
            }
        }
    }
}

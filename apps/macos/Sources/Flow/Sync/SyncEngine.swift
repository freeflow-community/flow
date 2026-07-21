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

    private static let currentUserIdKey = "currentUserId" + Profile.suffix

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
            await didSignIn(user: me, token: token, persistToken: false)
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

    /// Web-to-app handoff (flow://signin deep link): exchanges the one-time
    /// code minted by the web session for this app's own session.
    func loginWithLinkCode(_ code: String) async throws {
        let resp: AuthResponse = try await api.post(
            "/v1/auth/app-link/exchange",
            body: AppLinkExchangeBody(code: code)
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

    /// `persistToken: false` when the token was just read from the Keychain
    /// (bootstrap): re-saving would be a second Keychain ACL prompt after every
    /// rebuild (SecItemDelete on an item the new binary isn't trusted for yet).
    private func didSignIn(user: User, token: String, persistToken: Bool = true) async {
        currentUser = user
        if persistToken { Keychain.saveToken(token) }
        UserDefaults.standard.set(user.id, forKey: Self.currentUserIdKey)
        try? await db.writer.write { db in try user.save(db) }
        await appState?.setPhase(.signedIn(user))
        await Banners.requestPermissionIfNeeded()
        startSocket(token: token)
        await refreshWorkspaces()
        await refreshNotificationBadge()
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
            await refreshArtifacts(workspaceId: ws)
        }
        if let ch = activeChannelId {
            await backfillChannel(ch)
        }
        if let root = openThreadRootId {
            await fetchThread(rootId: root)
        }
        await refreshNotificationBadge()
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
        await refreshArtifacts(workspaceId: id)
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

    /// Sets the workspace's sidebar color preset (owner/admin only, server-enforced).
    func updateWorkspaceColor(workspaceId: String, colorId: String) async throws -> Workspace {
        let ws: Workspace = try await api.patch(
            "/v1/workspaces/\(workspaceId)",
            body: UpdateWorkspaceColorBody(sidebarColor: colorId)
        )
        await saveWorkspacePreservingRole(ws)
        return ws
    }

    /// Saves a workspace row, keeping the locally cached `role` when the
    /// incoming DTO doesn't carry one (broadcast DTOs are role-less).
    private func saveWorkspacePreservingRole(_ ws: Workspace) async {
        try? await db.writer.write { db in
            var toSave = ws
            if toSave.role == nil {
                toSave.role = try Workspace.fetchOne(db, key: ws.id)?.role
            }
            try toSave.save(db)
        }
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
                    timezone: existing?.timezone,
                    statusEmoji: m.statusEmoji,
                    statusText: m.statusText,
                    isAgent: m.isAgent ?? existing?.isAgent ?? false,
                    createdAt: existing?.createdAt
                ).save(db)
                try Member(workspaceId: workspaceId, userId: m.userId, role: m.role).save(db)
            }
        }
        await pushAvatarPaths()
    }

    /// Publishes the userId -> avatarUrl map so message rows can render avatars.
    private func pushAvatarPaths() async {
        let rows: [(String, String)] = (try? await db.reader.read { db in
            try Row.fetchAll(db, sql: "SELECT id, avatarUrl FROM user WHERE avatarUrl IS NOT NULL")
                .map { ($0["id"] as String, $0["avatarUrl"] as String) }
        }) ?? []
        await appState?.setAvatarPaths(Dictionary(uniqueKeysWithValues: rows))
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

    /// Rename / set topic (ui_nits item 5; any channel member, server-enforced).
    /// Only name/topic are written locally — the response DTO carries default
    /// unread/notify fields that must not clobber the cached row.
    func updateChannel(channelId: String, name: String?, topic: String?) async throws {
        let ch: Channel = try await api.patch(
            "/v1/channels/\(channelId)",
            body: UpdateChannelBody(name: name, topic: topic)
        )
        try? await db.writer.write { db in
            try db.execute(
                sql: "UPDATE channel SET name = ?, topic = ? WHERE id = ?",
                arguments: [ch.name, ch.topic, ch.id]
            )
        }
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

    func sendMessage(
        channelId: String,
        body: String,
        threadRootId: String? = nil,
        attachments: [FileAttachment] = []
    ) async {
        var outgoing = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !outgoing.isEmpty || !attachments.isEmpty, let uid = currentUser?.id else { return }
        if outgoing.isEmpty { outgoing = " " } // server requires a non-empty body
        // Composer sugar → wire format: :shortcode: → unicode; @Name → <@id>;
        // @channel/@here/@everyone → <!token>. Returns resolved mention ids.
        let (wireBody, mentions) = await prepareOutgoing(outgoing, channelId: channelId)
        let clientMsgId = UUID().uuidString.lowercased()
        let now = ISO8601.now()
        let local = Message(
            id: UUIDv7.generate(),
            channelId: channelId,
            userId: uid,
            threadRootId: threadRootId,
            clientMsgId: clientMsgId,
            body: wireBody,
            createdAt: now,
            editedAt: nil,
            deletedAt: nil,
            replyCount: 0,
            lastReplyAt: nil,
            files: attachments,
            pending: true
        )
        // Optimistic insert; the POST response or WS echo reconciles it.
        try? await db.writer.write { db in
            try local.save(db)
            if let root = threadRootId {
                try Self.bumpThreadRollup(db, rootId: root, replyAt: now, authorId: uid)
            }
        }
        do {
            let server: Message = try await api.post(
                "/v1/channels/\(channelId)/messages",
                body: SendMessageBody(
                    clientMsgId: clientMsgId,
                    body: wireBody,
                    threadRootId: threadRootId,
                    fileIds: attachments.isEmpty ? nil : attachments.map(\.id),
                    mentions: mentions.isEmpty ? nil : mentions
                )
            )
            _ = await applyServerMessage(server)
        } catch {
            await appState?.showError("Couldn't send message: \(error.localizedDescription)")
        }
    }

    /// Expands shortcodes and resolves mention sugar against the channel's
    /// workspace members: "@Display Name" → "<@userId>" (longest-name-first so
    /// "Bob Smith" wins over "Bob"), "@channel|here|everyone" → "<!token>".
    /// Fenced code regions (``` blocks, phase-3.5 ruling 2) pass through
    /// byte-for-byte: the body is split on fence boundaries and only the
    /// non-code runs get shortcode expansion and mention substitution.
    private func prepareOutgoing(_ body: String, channelId: String) async -> (String, [String]) {
        let needsMentions = MarkdownBlocks.fenceSplit(body)
            .contains { !$0.isCode && $0.text.contains("@") }
        var members: [(id: String, name: String)] = []
        if needsMentions {
            let wsId: String? = try? await db.reader.read { db in
                try String.fetchOne(db, sql: "SELECT workspaceId FROM channel WHERE id = ?", arguments: [channelId])
            }
            if let wsId {
                members = (try? await db.reader.read { db in
                    try Row.fetchAll(
                        db,
                        sql: "SELECT u.id AS id, u.displayName AS name FROM member m JOIN user u ON u.id = m.userId WHERE m.workspaceId = ?",
                        arguments: [wsId]
                    ).map { (id: $0["id"] as String, name: $0["name"] as String) }
                }) ?? []
            }
        }
        // Longest-name-first so "Bob Smith" wins over "Bob".
        let sorted = members.sorted { $0.name.count > $1.name.count }
        var mentions: [String] = []
        let out = MarkdownBlocks.mapNonCode(body) { run in
            var text = EmojiCatalog.expandShortcodes(run)
            guard text.contains("@") else { return text }
            for token in ["channel", "here", "everyone"] {
                text = text.replacingOccurrences(of: "@\(token)", with: "<!\(token)>")
            }
            for m in sorted where !m.name.isEmpty {
                let needle = "@\(m.name)"
                if text.contains(needle) {
                    text = text.replacingOccurrences(of: needle, with: "<@\(m.id)>")
                    if !mentions.contains(m.id) { mentions.append(m.id) }
                }
            }
            return text
        }
        return (out, mentions)
    }

    // MARK: - Reactions

    /// Adds or removes the caller's reaction; server response is authoritative.
    func toggleReaction(messageId: String, emoji: String) async {
        guard let uid = currentUser?.id else { return }
        let mine: Bool = (try? await db.reader.read { db in
            guard let m = try Message.fetchOne(db, key: messageId) else { return false }
            return m.reactions.first { $0.emoji == emoji }?.userIds.contains(uid) ?? false
        }) ?? false
        let path = "/v1/messages/\(messageId)/reactions/\(emoji.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? emoji)"
        do {
            let resp: ReactionsResponse = mine
                ? try await api.delete(path)
                : try await api.put(path)
            await setReactions(messageId: messageId, resp.reactions)
        } catch {
            await appState?.showError("Couldn't update reaction: \(error.localizedDescription)")
        }
    }

    private func setReactions(messageId: String, _ reactions: [ReactionAgg]) async {
        try? await db.writer.write { db in
            guard var m = try Message.fetchOne(db, key: messageId) else { return }
            m.reactions = reactions
            try m.save(db)
        }
    }

    /// Applies a live reaction event by editing the cached aggregate in place.
    private func applyReactionEvent(_ data: ReactionEventData, added: Bool) async {
        try? await db.writer.write { db in
            guard var m = try Message.fetchOne(db, key: data.messageId) else { return }
            var aggs = m.reactions
            if let idx = aggs.firstIndex(where: { $0.emoji == data.emoji }) {
                var agg = aggs[idx]
                if added {
                    if !agg.userIds.contains(data.userId) {
                        agg.userIds.append(data.userId)
                        agg.count += 1
                    }
                } else {
                    agg.userIds.removeAll { $0 == data.userId }
                    agg.count = agg.userIds.count
                }
                if agg.count == 0 { aggs.remove(at: idx) } else { aggs[idx] = agg }
            } else if added {
                aggs.append(ReactionAgg(emoji: data.emoji, count: 1, userIds: [data.userId]))
            }
            m.reactions = aggs
            try m.save(db)
        }
    }

    // MARK: - Files

    func uploadFile(workspaceId: String, fileURL: URL) async throws -> FileAttachment {
        let attrs = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let sizeBytes = (attrs[.size] as? Int) ?? 0
        let mime = Self.mimeType(for: fileURL)
        // presign → PUT the bytes (direct to R2 in prod, server fallback in
        // local dev) → complete (server verifies size + generates thumbnails).
        // The PUT streams from disk — files can be hundreds of MB.
        struct PresignBody: Encodable {
            let filename: String
            let mimeType: String
            let sizeBytes: Int
        }
        let pres: PresignedUpload = try await api.post(
            "/v1/workspaces/\(workspaceId)/files/presign",
            body: PresignBody(filename: fileURL.lastPathComponent, mimeType: mime, sizeBytes: sizeBytes)
        )
        try await api.putRaw(pres.upload.url, headers: pres.upload.headers, fromFile: fileURL)
        return try await api.post("/v1/files/\(pres.file.id)/complete")
    }

    /// Downloads a file to a temp path (original filename preserved) and
    /// returns the local URL — used for "open" on attachments.
    func downloadFile(_ file: FileAttachment) async throws -> URL {
        // streamed to disk — videos can be hundreds of MB
        let tmp = try await api.downloadToFile("/v1/files/\(file.id)")
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("FlowDownloads-\(file.id)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(file.name)
        try? FileManager.default.removeItem(at: dest)
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    /// Fetches a text-ish file's original bytes decoded as UTF-8 (lossy on
    /// invalid sequences) — backs the inline text preview.
    func fileText(_ file: FileAttachment) async throws -> String {
        let data = try await api.getData("/v1/files/\(file.id)")
        return String(decoding: data, as: UTF8.self)
    }

    /// Saves a file's original bytes into ~/Downloads (uniqued name on
    /// collision) — backs the attachment/lightbox Download buttons.
    func saveToDownloads(_ file: FileAttachment) async throws -> URL {
        let data = try await api.getData("/v1/files/\(file.id)")
        let dir = try FileManager.default.url(
            for: .downloadsDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let base = (file.name as NSString).deletingPathExtension
        let ext = (file.name as NSString).pathExtension
        var dest = dir.appendingPathComponent(file.name)
        var n = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            n += 1
            dest = dir.appendingPathComponent(ext.isEmpty ? "\(base)-\(n)" : "\(base)-\(n).\(ext)")
        }
        try data.write(to: dest)
        return dest
    }

    static func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "gif": "image/gif"
        case "webp": "image/webp"
        case "pdf": "application/pdf"
        case "txt", "md", "log": "text/plain"
        case "json": "application/json"
        case "zip": "application/zip"
        case "mp4", "m4v": "video/mp4"
        case "mov": "video/quicktime"
        case "webm": "video/webm"
        default: "application/octet-stream"
        }
    }

    // MARK: - Artifacts (phase 9)

    /// Fetches my artifact bookmarks for a workspace and publishes them to
    /// AppState. No GRDB cache: the list is small and personal, so it gets
    /// the same fetch-on-demand treatment as notifications.
    func refreshArtifacts(workspaceId: String) async {
        guard let resp: ArtifactsResponse = try? await api.get(
            "/v1/workspaces/\(workspaceId)/artifacts"
        ) else { return }
        await appState?.setArtifacts(resp.artifacts)
    }

    /// Bookmarks a file as a personal artifact (idempotent per user+file,
    /// server-enforced) and refreshes the sidebar list.
    func createArtifact(fileId: String, name: String? = nil) async throws -> Artifact {
        let artifact: Artifact = try await api.post(
            "/v1/artifacts",
            body: CreateArtifactBody(fileId: fileId, name: name)
        )
        await refreshArtifacts(workspaceId: artifact.workspaceId)
        return artifact
    }

    func renameArtifact(id: String, name: String) async throws {
        let artifact: Artifact = try await api.patch(
            "/v1/artifacts/\(id)",
            body: RenameArtifactBody(name: name)
        )
        await refreshArtifacts(workspaceId: artifact.workspaceId)
    }

    /// Removes the bookmark — never the underlying file.
    func deleteArtifact(_ artifact: Artifact) async throws {
        let _: OkResponse = try await api.delete("/v1/artifacts/\(artifact.id)")
        await appState?.artifactBecameUnavailable(artifact.id)
        await refreshArtifacts(workspaceId: artifact.workspaceId)
    }

    // MARK: - DMs

    /// Upsert a DM with the given other members (server dedupes by member set).
    func createDm(workspaceId: String, userIds: [String]) async throws -> Channel {
        let ch: Channel = try await api.post(
            "/v1/workspaces/\(workspaceId)/dms",
            body: CreateDmBody(userIds: userIds)
        )
        try? await db.writer.write { db in try ch.save(db) }
        return ch
    }

    // MARK: - Channel membership (phase2.md §5)

    func addMember(channelId: String, userId: String) async throws {
        let _: OkResponse = try await api.post(
            "/v1/channels/\(channelId)/members",
            body: AddMemberBody(userId: userId)
        )
    }

    func leaveChannel(_ channelId: String) async throws {
        let _: OkResponse = try await api.post("/v1/channels/\(channelId)/leave")
        try? await db.writer.write { db in
            try db.execute(sql: "DELETE FROM channel WHERE id = ?", arguments: [channelId])
            try db.execute(sql: "DELETE FROM message WHERE channelId = ?", arguments: [channelId])
        }
        if activeChannelId == channelId {
            await appState?.channelBecameUnavailable(channelId)
        }
    }

    func archiveChannel(_ channelId: String) async throws {
        let ch: Channel = try await api.post("/v1/channels/\(channelId)/archive")
        try? await db.writer.write { db in try ch.save(db) }
        if activeChannelId == channelId {
            await appState?.channelBecameUnavailable(channelId)
        }
    }

    func setNotifyLevel(channelId: String, level: Int) async {
        do {
            let _: OkResponse = try await api.put(
                "/v1/channels/\(channelId)/notify",
                body: NotifyLevelBody(level: level)
            )
            try? await db.writer.write { db in
                try db.execute(
                    sql: "UPDATE channel SET notifyLevel = ? WHERE id = ?",
                    arguments: [level, channelId]
                )
            }
        } catch {
            await appState?.showError("Couldn't update notifications: \(error.localizedDescription)")
        }
    }

    // MARK: - Profile (phase2.md §6)

    func updateProfile(displayName: String?, timezone: String?) async throws {
        let me: User = try await api.patch(
            "/v1/me",
            body: PatchMeBody(displayName: displayName, timezone: timezone)
        )
        currentUser = me
        try? await db.writer.write { db in try me.save(db) }
        await appState?.setPhase(.signedIn(me))
    }

    /// Set (or clear, with two empty strings) the user's status emoji + label.
    func setStatus(emoji: String, text: String) async throws {
        let me: User = try await api.patch(
            "/v1/me",
            body: PatchMeBody(statusEmoji: emoji, statusText: text)
        )
        currentUser = me
        try? await db.writer.write { db in try me.save(db) }
        await appState?.setPhase(.signedIn(me))
    }

    func uploadAvatar(fileURL: URL) async throws {
        let data = try Data(contentsOf: fileURL)
        let me: User = try await api.upload(
            "/v1/me/avatar",
            filename: fileURL.lastPathComponent,
            mimeType: Self.mimeType(for: fileURL),
            data: data
        )
        currentUser = me
        try? await db.writer.write { db in try me.save(db) }
        await appState?.setPhase(.signedIn(me))
    }

    func fetchUser(_ userId: String) async throws -> User {
        let u: User = try await api.get("/v1/users/\(userId)")
        try? await db.writer.write { db in try u.save(db) }
        return u
    }

    // MARK: - Notifications (phase2.md §4)

    func fetchNotifications(before: String? = nil) async throws -> NotificationsResponse {
        let query: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: "50"),
            before.map { URLQueryItem(name: "before", value: $0) },
        ].compactMap(\.self)
        let resp: NotificationsResponse = try await api.get("/v1/me/notifications", query: query)
        await appState?.setNotificationUnread(resp.unreadCount)
        return resp
    }

    func markNotificationsRead(upToId: String) async {
        let _: OkResponse? = try? await api.post(
            "/v1/me/notifications/read",
            body: MarkNotificationsReadBody(upToId: upToId)
        )
        await refreshNotificationBadge()
    }

    private func refreshNotificationBadge() async {
        guard let resp: NotificationsResponse = try? await api.get(
            "/v1/me/notifications", query: [URLQueryItem(name: "limit", value: "1")]
        ) else { return }
        await appState?.setNotificationUnread(resp.unreadCount)
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
            if event.type == "message.created" || event.type == "thread.reply" {
                // The sender's message arrived — clear their typing indicator.
                await appState?.typingStopped(channelId: m.channelId, userId: m.userId)
            }
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
            } else if mj.channelId != nil {
                // membership of a DM/channel we can see changed → refresh so
                // DM memberIds and lists stay accurate
                await refreshChannels(workspaceId: event.workspaceId)
            }

        case .memberLeft(let ml):
            if ml.channelId == nil {
                // Workspace-level departure (member removed / app deleted):
                // refresh so the member and mention lists drop them.
                if event.workspaceId == activeWorkspaceId {
                    await refreshMembers(workspaceId: event.workspaceId)
                }
            }
            if ml.userId == currentUser?.id, let chId = ml.channelId {
                try? await db.writer.write { db in
                    try db.execute(sql: "DELETE FROM channel WHERE id = ?", arguments: [chId])
                    try db.execute(sql: "DELETE FROM message WHERE channelId = ?", arguments: [chId])
                }
                if activeChannelId == chId {
                    await appState?.channelBecameUnavailable(chId)
                }
                await refreshChannels(workspaceId: event.workspaceId)
            }

        case .channelUpdated(let ch):
            try? await db.writer.write { db in
                try db.execute(
                    sql: "UPDATE channel SET name = ?, topic = ? WHERE id = ?",
                    arguments: [ch.name, ch.topic, ch.id]
                )
            }

        case .channelArchived(let ch):
            try? await db.writer.write { db in
                guard var existing = try Channel.fetchOne(db, key: ch.id) else { return }
                existing.archivedAt = ch.archivedAt
                try existing.save(db)
            }
            if activeChannelId == ch.id {
                await appState?.channelBecameUnavailable(ch.id)
            }

        case .reaction(let data, let added):
            await applyReactionEvent(data, added: added)

        case .notification(let n):
            await appState?.notificationReceived(n)
            // Banner unless the user is already looking at that channel.
            if n.channelId != activeChannelId, n.message.userId != currentUser?.id {
                let senderName: String? = try? await db.reader.read { db in
                    try String.fetchOne(
                        db, sql: "SELECT displayName FROM user WHERE id = ?", arguments: [n.message.userId]
                    )
                }
                let title = switch n.kind {
                case 1: senderName ?? "New direct message"
                case 2: "\(senderName ?? "Someone") replied in a thread"
                default: "\(senderName ?? "Someone") mentioned you"
                }
                Banners.show(title: title, body: MentionRendering.plainText(n.message.body), id: n.id)
            }

        case .workspaceUpdated(let ws):
            await saveWorkspacePreservingRole(ws)

        case .artifact(let a, let deleted):
            // Personal bookmarks (phase 9): keep the sidebar list fresh; a
            // deletion of the open artifact falls back to the channel behind it.
            if deleted {
                await appState?.artifactBecameUnavailable(a.id)
            }
            if event.workspaceId == activeWorkspaceId {
                await refreshArtifacts(workspaceId: event.workspaceId)
            }

        case .userUpdated(let u):
            try? await db.writer.write { db in try u.save(db) }
            if u.id == currentUser?.id {
                currentUser = u
                await appState?.setPhase(.signedIn(u))
            }
            await pushAvatarPaths()

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
                try Self.bumpThreadRollup(db, rootId: root, replyAt: m.createdAt, authorId: m.userId)
            }
            return isNew
        }
        return isNew ?? false
    }

    /// Local mirror of the server's thread rollup: bump replyCount/lastReplyAt
    /// on the root and merge the reply author into the first-4 participant set.
    private static func bumpThreadRollup(
        _ db: Database, rootId: String, replyAt: String, authorId: String
    ) throws {
        guard var root = try Message.filter(key: rootId).fetchOne(db) else { return }
        root.replyCount += 1
        root.lastReplyAt = replyAt
        if root.replyParticipantUserIds.count < 4, !root.replyParticipantUserIds.contains(authorId) {
            root.replyParticipantUserIds.append(authorId)
        }
        try root.save(db)
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

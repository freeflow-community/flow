import Foundation
import GRDB
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Owns all GRDB writes and coordinates APIClient + SocketClient.
/// SwiftUI never writes to the database; it calls engine methods and
/// observes the database via ValueObservation.
actor SyncEngine {
    private let db: AppDatabase
    private let api: APIClient
    private let socket: SocketClient
    private weak var appState: AppState?

    private var currentUser: User?
    private var socketConsumer: Task<Void, Never>?
    private var wakeObserver: Task<Void, Never>?
    private var typingLastSent: [String: Date] = [:]
    /// The token the live socket was started with, so a resume can restart it
    /// (#269) without going back to the Keychain — which an unsigned dev build
    /// can't always read, and which would make the re-sync depend on storage
    /// rather than on the session the engine is already holding.
    private var sessionToken: String?
    /// Channels whose history page has landed this session (#269). Membership
    /// means "the server has been asked, and answered" — not "there are
    /// messages" — so an empty channel is asked once, and a channel whose fetch
    /// failed is asked again the next time its transcript appears.
    private var historyLoaded: Set<String> = []
    /// Channels with a history request in flight, so the selection-driven fetch
    /// and a view's `ensureHistory` on the same open don't both ask (#269).
    private var historyInFlight: Set<String> = []
    /// Tries for a channel's history page before falling back to the cache —
    /// 1s then 2s apart, so a transient failure costs a moment, not the
    /// conversation (#269).
    private static let historyAttempts = 3

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

    /// Local teardown for a session the server has already rejected. Same as
    /// `logout()` minus the `/v1/auth/logout` call — the token is dead, so
    /// there is nothing to revoke — and it leaves the cache in place so the
    /// next sign-in on the same account doesn't re-download everything.
    ///
    /// Installed as APIClient's 401 handler in `bootstrap()`. Before this, a
    /// session that died while the app was running was never noticed: reads
    /// came from the local cache and every write failed with the server's raw
    /// message ("invalid or expired token") in whatever sheet triggered it.
    func sessionExpired() async {
        guard currentUser != nil else { return }
        Keychain.deleteToken()
        await api.setToken(nil)
        await socket.stop()
        socketConsumer?.cancel()
        socketConsumer = nil
        currentUser = nil
        sessionToken = nil
        historyLoaded.removeAll() // signing back in re-asks the server (#269)
        await appState?.sessionExpired()
    }

    func bootstrap() async {
        await api.setUnauthorizedHandler { [weak self] in
            await self?.sessionExpired()
        }
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

    /// Email-first registration (production servers): asks the server to send
    /// the signup email. No session results — the account is created by
    /// whoever opens the emailed link, and the web-to-app handoff brings them
    /// back here. The server never reveals whether the address already has an
    /// account, so success just means "the request was accepted".
    func requestSignup(email: String) async throws {
        let _: RegisterPendingResponse = try await api.post(
            "/v1/auth/register",
            body: EmailRegisterBody(email: email)
        )
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

    /// Sign in with Apple (native flow): posts the ASAuthorization identity
    /// token; the server verifies it against Apple's JWKS. Sign-in and
    /// registration are the same act. `fullName` is only delivered by Apple on
    /// the first authorization, so it's forwarded when present.
    func signInWithApple(identityToken: String, fullName: String?) async throws {
        let resp: AuthResponse = try await api.post(
            "/v1/auth/apple",
            body: AppleAuthBody(identityToken: identityToken, name: fullName)
        )
        await api.setToken(resp.token)
        await didSignIn(user: resp.user, token: resp.token)
    }

    /// Which auth options this server offers (phase 16). Open endpoint — safe
    /// to call from the signed-out screen. Callers treat a failure as "no
    /// Google" so an unreachable server just means one less button.
    func publicConfig() async throws -> PublicConfig {
        try await api.get("/v1/config")
    }

    /// Passwordless sign-in: ask the server to email a one-time sign-in link.
    /// The server never reveals whether the address has an account (no
    /// enumeration), so a success here just means "the request was accepted" —
    /// the caller shows a neutral "check your email" confirmation regardless.
    func sendSigninLink(email: String) async throws {
        let _: OkResponse = try await api.post(
            "/v1/auth/signin-link",
            body: SigninLinkBody(email: email)
        )
    }

    func logout() async {
        let _: OkResponse? = try? await api.post("/v1/auth/logout")
        await tearDownSession()
    }

    /// Account deletion (App Store 5.1.1(v)): DELETE /v1/me, then the same
    /// local teardown as sign-out. Throws if the server refuses — the account
    /// is untouched and the session stays signed in.
    func deleteAccount() async throws {
        let _: OkResponse = try await api.delete("/v1/me")
        await tearDownSession()
    }

    private func tearDownSession() async {
        Keychain.deleteToken()
        UserDefaults.standard.removeObject(forKey: Self.currentUserIdKey)
        await api.setToken(nil)
        await socket.stop()
        socketConsumer?.cancel()
        socketConsumer = nil
        currentUser = nil
        sessionToken = nil
        historyLoaded.removeAll() // the cache goes with the session (#269)
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
        sessionToken = token
        socketConsumer?.cancel()
        socketConsumer = Task { [socket] in
            let stream = await socket.start(token: token)
            for await signal in stream {
                if Task.isCancelled { break }
                await self.handle(signal)
            }
        }
        observeWake()
    }

    /// Waking from sleep (macOS) or returning to the foreground (iOS) is the
    /// one moment we *know* unobserved time has passed, so it is the cheapest
    /// place to catch a socket that died half-open while we weren't looking
    /// (#271). The watchdog in `SocketClient` would find it within ~70s anyway;
    /// this only makes it immediate, and must never be the sole mechanism —
    /// Wi-Fi drops and VPN flaps come with no notification at all.
    private func observeWake() {
        guard wakeObserver == nil else { return }
        #if canImport(AppKit)
        let center = NSWorkspace.shared.notificationCenter
        let name = NSWorkspace.didWakeNotification
        #elseif canImport(UIKit)
        let center = NotificationCenter.default
        let name = UIApplication.willEnterForegroundNotification
        #endif
        wakeObserver = Task { [socket] in
            for await _ in center.notifications(named: name).map({ _ in () }) {
                await socket.wake()
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
        // The reconnect bar stays up for the whole catch-up, not just until the
        // socket says hello (#234). `defer` so a cancelled backfill — sign-out
        // mid-page — still clears it.
        await appState?.beginCatchUp()
        let state = appState
        defer { Task { @MainActor in state?.endCatchUp() } }
        await refreshWorkspaces()
        // Every workspace/channel/thread open in *some* window needs the gap
        // filled — the windows are independent, so there can be several of each.
        for ws in await appState?.openWorkspaceIds ?? [] {
            await refreshChannels(workspaceId: ws)
            await refreshMembers(workspaceId: ws)
            await refreshArtifacts(workspaceId: ws)
        }
        for ch in await appState?.openChannelIds ?? [] {
            await backfillChannel(ch)
        }
        for root in await appState?.openThreadRootIds ?? [] {
            await fetchThread(rootId: root)
        }
        // Every reconciling fetch has had its turn (this also runs on the
        // first connect after launch, which is where rows orphaned by a quit
        // mid-send get their verdict).
        await sweepStalePending()
        await refreshNotificationBadge()
    }

    /// Fills the gap between the server head and our newest local message by
    /// paging backwards (cursor `before`) until we overlap local history.
    private func backfillChannel(_ channelId: String) async {
        // The same probe `catchUpRead` uses, and for the same reason it excludes
        // thread replies: the pages being walked back are top-level only, so a
        // newer reply standing in as the overlap mark ends the gap-fill before
        // it has actually overlapped (#328).
        let newestLocalId = await newestCachedMessageId(channelId: channelId)
        var before: String? = nil
        var pages = 0
        // The first page (the newest messages) is stored as soon as it lands,
        // so the transcript updates fast; the older pages accumulate into one
        // write. Each write refetches and re-diffs the whole channel for every
        // observing view, so a deep backfill used to mean up to five full
        // list rebuilds — and five glue scrolls — where one is enough.
        var olderPages: [Message] = []
        while pages < 5 {
            let query: [URLQueryItem] = [
                URLQueryItem(name: "limit", value: "50"),
                before.map { URLQueryItem(name: "before", value: $0) },
            ].compactMap(\.self)
            guard let resp: MessagesResponse = try? await api.get(
                "/v1/channels/\(channelId)/messages", query: query
            ) else { break }
            pages += 1
            if before == nil {
                await storeMessages(resp.messages)
                await appState?.setHasMore(channelId: channelId, resp.hasMore)
            } else {
                olderPages.append(contentsOf: resp.messages)
            }
            guard resp.hasMore, let oldest = resp.messages.last?.id else { break }
            if let newest = newestLocalId, oldest <= newest { break }
            before = oldest
        }
        await storeMessages(olderPages)
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

    /// A window switched to this workspace: bring its data up to date. The
    /// engine holds no "active" selection of its own any more — the windows
    /// do, and `AppState` aggregates them for event scoping.
    func selectWorkspace(_ id: String?) async {
        guard let id else { return }
        await refreshChannels(workspaceId: id)
        await refreshMembers(workspaceId: id)
        await refreshArtifacts(workspaceId: id)
        // Reconcile the rail badges (#345) against the server at the same beat
        // the channel counts are refreshed — the running totals are kept by
        // local arithmetic between refreshes, and this is where they settle up.
        await refreshWorkspaces()
        // The Activity badge counts this workspace only, so it changes meaning
        // the moment the workspace does.
        await refreshNotificationBadge()
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

    /// The workspace's persistent join link, or nil if none is live (issue #85).
    /// Owner/admin only — the server rejects everyone else.
    func joinLink(workspaceId: String) async throws -> String? {
        let resp: JoinLinkResponse = try await api.get("/v1/workspaces/\(workspaceId)/join-link")
        return resp.joinUrl
    }

    /// Mints a fresh join link, replacing (and thereby revoking) any existing one.
    func createJoinLink(workspaceId: String) async throws -> String? {
        let resp: JoinLinkResponse = try await api.post("/v1/workspaces/\(workspaceId)/join-link")
        return resp.joinUrl
    }

    /// Revokes the join link outright; the URL stops working immediately.
    func revokeJoinLink(workspaceId: String) async throws {
        let _: JoinLinkResponse = try await api.delete("/v1/workspaces/\(workspaceId)/join-link")
    }

    /// Mints a single-use invite code for a coding agent (AGENT_MEMBERS.md).
    /// The sponsor is the caller; the agent redeems the code and joins on its
    /// own — no approval step.
    func createAgentInvite(workspaceId: String) async throws -> AgentInviteResponse {
        try await api.post("/v1/workspaces/\(workspaceId)/agent-invites")
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

    /// Workspace avatar (#336): owner/admin only, server-enforced. The response
    /// is the updated workspace; every other client hears the same thing on the
    /// `workspace.updated` broadcast.
    func uploadWorkspaceAvatar(workspaceId: String, fileURL: URL) async throws -> Workspace {
        let data = try Data(contentsOf: fileURL)
        let ws: Workspace = try await api.upload(
            "/v1/workspaces/\(workspaceId)/avatar",
            filename: fileURL.lastPathComponent,
            mimeType: Self.mimeType(for: fileURL),
            data: data
        )
        await saveWorkspacePreservingRole(ws)
        return ws
    }

    /// Removes it — back to the color/initial mark.
    func clearWorkspaceAvatar(workspaceId: String) async throws -> Workspace {
        let ws: Workspace = try await api.delete("/v1/workspaces/\(workspaceId)/avatar")
        await saveWorkspacePreservingRole(ws)
        return ws
    }

    /// Saves a workspace row, keeping the locally cached `role` when the
    /// incoming DTO doesn't carry one (broadcast DTOs are role-less) — and the
    /// cached `unreadCount` for the same reason (#345): only the workspace list
    /// computes it, so an avatar change must not blank the badge.
    private func saveWorkspacePreservingRole(_ ws: Workspace) async {
        try? await db.writer.write { db in
            var toSave = ws
            let cached = try Workspace.fetchOne(db, key: ws.id)
            if toSave.role == nil {
                toSave.role = cached?.role
            }
            if toSave.unreadCount == nil {
                toSave.unreadCount = cached?.unreadCount
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
                    // #220: the roster payload carries neither, so keep what the
                    // profile fetch already cached rather than blanking it.
                    website: existing?.website,
                    bio: existing?.bio,
                    isAgent: m.isAgent ?? existing?.isAgent ?? false,
                    isBot: m.isBot ?? existing?.isBot ?? false,
                    createdAt: existing?.createdAt
                ).save(db)
                try Member(workspaceId: workspaceId, userId: m.userId, role: m.role).save(db)
            }
        }
        await pushAvatarPaths()
    }

    /// Publishes the userId -> avatarUrl map so message rows can render avatars,
    /// and the set of agent ids so the typing indicator can say "thinking".
    private func pushAvatarPaths() async {
        let rows: [(String, String)] = (try? await db.reader.read { db in
            try Row.fetchAll(db, sql: "SELECT id, avatarUrl FROM user WHERE avatarUrl IS NOT NULL")
                .map { ($0["id"] as String, $0["avatarUrl"] as String) }
        }) ?? []
        await appState?.setAvatarPaths(Dictionary(uniqueKeysWithValues: rows))
        let agents: [String] = (try? await db.reader.read { db in
            try String.fetchAll(db, sql: "SELECT id FROM user WHERE isAgent = 1")
        }) ?? []
        await appState?.setAgentIds(Set(agents))
        // Warm the image cache with our own avatar so the very first message
        // we send this session doesn't flash the placeholder.
        if let uid = currentUser?.id, let path = rows.first(where: { $0.0 == uid })?.1 {
            Task.detached(priority: .utility) { _ = await ImageLoader.shared.image(path: path) }
        }
    }

    // MARK: - Channels

    func refreshChannels(workspaceId: String) async {
        guard let resp: ChannelsResponse = try? await api.get("/v1/workspaces/\(workspaceId)/channels")
        else { return }
        let channels = resp.channels
        // Activity spinners (#137) are transient and never hit the local DB —
        // this snapshot is also how a client that missed events while asleep
        // gets back in step.
        await appState?.setBusyChannelIds(resp.busyChannelIds)
        await appState?.setHuddleRosters(resp.huddleRosters)
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

    /// A transcript for `channelId` is on screen — make sure it has one. The
    /// selection-driven fetch below runs only when the *selection changes*
    /// (`WindowState.selectChannel` returns early on the same id) and swallows
    /// its own failures, so a channel could be shown with nothing behind it and
    /// stay that way until the user switched away and back (#269). Views call
    /// this whenever they appear; it costs nothing once a page has landed.
    func ensureHistory(channelId: String) async {
        guard !historyLoaded.contains(channelId) else { return }
        await selectChannel(channelId)
    }

    func selectChannel(_ channelId: String?) async {
        guard let channelId else { return }
        // One page per open. Selecting a channel and showing its transcript
        // both ask, in either order, so without this the loser of that race
        // fetches the same page a second time. Claimed before the first await,
        // because the actor lets the other caller in at every suspension point.
        // The loser also skips the unread clear below — the winner is doing it
        // for the same open.
        guard !historyInFlight.contains(channelId) else { return }
        historyInFlight.insert(channelId)
        defer { historyInFlight.remove(channelId) }
        // Opening the channel is the moment its Activity rows stop being
        // unread — say so now, before the history page is even requested
        // (#227). Left to the server it takes four sequential round trips
        // (history GET → channel read → notification.read → badge refetch),
        // which on a slow link reads as a stuck badge.
        await clearNotificationsLocally(channelId: channelId)
        // The clients render a loading transcript rather than bare background
        // while this page is in flight (#191) — on a slow link it is the whole
        // difference between "still arriving" and "the conversation is gone".
        await appState?.setLoadingHistory(channelId: channelId, true)
        var resp: MessagesResponse? = nil
        // One request used to decide the whole transcript: a connection that
        // failed — the usual one being the first request after a phone wakes up
        // — left an empty channel that only a switch away and back could cure
        // (#269). Try again briefly before settling for the cache.
        for attempt in 0..<Self.historyAttempts {
            if attempt > 0 { try? await Task.sleep(for: .seconds(attempt)) }
            resp = try? await api.get(
                "/v1/channels/\(channelId)/messages",
                query: [URLQueryItem(name: "limit", value: "50")]
            )
            if resp != nil { break }
        }
        guard let resp else {
            // Offline: render from cache — which is all there is going to be,
            // so stop claiming the transcript is still on its way. The channel
            // stays out of `historyLoaded`, so the next appearance retries
            // rather than leaving an empty transcript for good (#269).
            await appState?.setLoadingHistory(channelId: channelId, false)
            return
        }
        historyLoaded.insert(channelId)
        // Rows first, then drop the loading state: clearing it while the
        // transcript is still empty would flash the very blank this avoids.
        await storeMessages(resp.messages)
        await appState?.setLoadingHistory(channelId: channelId, false)
        await appState?.setHasMore(channelId: channelId, resp.hasMore)
        // An empty page still has to tell the server (#227). Zeroing only the
        // local count made the channel *look* read on this device while its
        // notification rows stayed unread everywhere else — the cached newest
        // id is the same fallback `catchUpRead` uses. With nothing cached
        // either there is no cursor to send, so just clear the local pill.
        let cursor = if let newest = resp.messages.first?.id {
            newest
        } else {
            await newestCachedMessageId(channelId: channelId)
        }
        if let cursor {
            await markRead(channelId: channelId, lastReadMsgId: cursor)
        } else {
            try? await db.writer.write { db in
                try db.execute(
                    sql: "UPDATE channel SET unreadCount = 0 WHERE id = ?",
                    arguments: [channelId]
                )
            }
        }
    }

    /// Zero this channel's Activity rows in the local cache and on the badges.
    /// The `notification.read` event that the read call triggers will overwrite
    /// both with the server's numbers a moment later; this is only about not
    /// making the user watch four round trips for something already true.
    private func clearNotificationsLocally(channelId: String) async {
        let cleared: (count: Int, workspaceId: String)? = try? await db.writer.write { db in
            guard let ch = try Channel.fetchOne(db, key: channelId), ch.unreadNotifications > 0
            else { return nil }
            try db.execute(
                sql: "UPDATE channel SET unreadNotifications = 0 WHERE id = ?",
                arguments: [channelId]
            )
            // The rail badge (#345) is the per-workspace sum of these rows.
            try db.execute(
                sql: """
                    UPDATE workspace SET unreadCount = MAX(0, unreadCount - ?)
                    WHERE id = ? AND unreadCount IS NOT NULL
                    """,
                arguments: [ch.unreadNotifications, ch.workspaceId]
            )
            return (ch.unreadNotifications, ch.workspaceId)
        }
        guard let cleared else { return }
        await appState?.notificationsCleared(count: cleared.count, workspaceId: cleared.workspaceId)
    }

    /// Newest top-level message this device has cached for a channel — the read
    /// cursor to fall back on when the server hasn't just handed us one.
    private func newestCachedMessageId(channelId: String) async -> String? {
        try? await db.reader.read { db in
            try String.fetchOne(
                db,
                sql: "SELECT id FROM message WHERE channelId = ? AND pending = 0 AND threadRootId IS NULL ORDER BY id DESC LIMIT 1",
                arguments: [channelId]
            )
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

    /// Advance the channel read cursor. The server also reads that channel's
    /// Activity notifications (issue #63) and pushes back a `notification.read`
    /// event, which is what settles the badge.
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


    /// The app came back to the front with `channelId` on screen: everything
    /// that arrived while it was hidden has now genuinely been seen. Called from
    /// `AppState.setAppActive` — the arrival path deliberately skips backgrounded
    /// windows, so this is what closes the loop.
    func catchUpRead(channelId: String) async {
        guard let newest = await newestCachedMessageId(channelId: channelId) else { return }
        await markRead(channelId: channelId, lastReadMsgId: newest)
    }

    /// "I'm looking at this thread" — reads the thread's notifications without
    /// touching the channel cursor (which only tracks top-level messages).
    private func markThreadRead(channelId: String, rootId: String) async {
        let _: OkResponse? = try? await api.post(
            "/v1/channels/\(channelId)/read",
            body: ReadBody(lastReadMsgId: rootId, threadRootId: rootId)
        )
    }

    // MARK: - Messages

    /// Returns any users mentioned who aren't in this (standard) channel, so the
    /// composer can offer to add them (web-parity CTA). Empty on failure/none.
    @discardableResult
    func sendMessage(
        channelId: String,
        body: String,
        threadRootId: String? = nil,
        attachments: [FileAttachment] = []
    ) async -> [MentionMiss] {
        var outgoing = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !outgoing.isEmpty || !attachments.isEmpty, let uid = currentUser?.id else { return [] }
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
        // A send failure no longer aborts with a toast: `deliver` flags the row
        // `failed` (kept in place with a Retry affordance) and returns false.
        guard await deliver(local, mentions: mentions) else { return [] }
        // Web-parity: after a successful send, flag mentioned users who aren't
        // in this channel — they won't see the mention (an agent never even
        // processes it) until added.
        return await channelMentionMisses(channelId: channelId, mentionIds: mentions)
    }

    /// POST an already-inserted optimistic row and reconcile it. On network or
    /// server failure the row is flagged `failed` (kept in place with a Retry
    /// affordance) rather than left spinning as pending. Returns whether the
    /// send was accepted by the server.
    @discardableResult
    private func deliver(_ local: Message, mentions: [String]) async -> Bool {
        do {
            let server: Message = try await api.post(
                "/v1/channels/\(local.channelId)/messages",
                body: SendMessageBody(
                    clientMsgId: local.clientMsgId,
                    body: local.body,
                    threadRootId: local.threadRootId,
                    fileIds: local.files.isEmpty ? nil : local.files.map(\.id),
                    mentions: mentions.isEmpty ? nil : mentions
                )
            )
            _ = await applyServerMessage(server)
            return true
        } catch {
            try? await db.writer.write { db in
                // `AND pending = 1`: if the WS echo reconciled this send while
                // the POST was timing out, the message is delivered — flagging
                // it "Failed to send" would be a lie about a message everyone
                // else can see.
                try db.execute(
                    sql: "UPDATE message SET pending = 0, failed = 1 WHERE clientMsgId = ? AND pending = 1",
                    arguments: [local.clientMsgId]
                )
                // A failed reply un-bumps the root rollup it optimistically
                // incremented, so counts reflect only confirmed replies — but
                // only when the flag actually flipped, or a confirmed reply
                // loses a count it earned.
                guard db.changesCount > 0, let root = local.threadRootId else { return }
                try Self.unbumpThreadRollup(db, rootId: root)
            }
            return false
        }
    }

    /// Re-send a previously failed message with its original clientMsgId (the
    /// server is idempotent on it). Flips the row back to pending, re-bumps the
    /// thread rollup, then re-POSTs. Mentions are recovered from the stored
    /// wire body so a retry still notifies mentioned users.
    func retrySend(_ message: Message) async {
        try? await db.writer.write { db in
            try db.execute(
                sql: "UPDATE message SET failed = 0, pending = 1 WHERE id = ?",
                arguments: [message.id]
            )
            if let root = message.threadRootId {
                try Self.bumpThreadRollup(db, rootId: root, replyAt: message.createdAt, authorId: message.userId)
            }
        }
        var reloaded = message
        reloaded.failed = false
        reloaded.pending = true
        await deliver(reloaded, mentions: Self.mentionIds(in: message.body))
    }

    /// Discard a failed (never-sent) optimistic row: just drop it locally —
    /// there's no server row to delete. Its rollup was already un-bumped when
    /// the send failed, so this only removes the row.
    func discardFailed(_ message: Message) async {
        try? await db.writer.write { db in
            try Message.filter(key: message.id).deleteAll(db)
        }
    }

    /// Extract `<@userId>` mention targets from a wire-format body (group
    /// tokens like `<!channel>` are recomputed from the body server-side).
    private static func mentionIds(in body: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: "<@([^>]+)>") else { return [] }
        let ns = body as NSString
        return re.matches(in: body, range: NSRange(location: 0, length: ns.length))
            .map { ns.substring(with: $0.range(at: 1)) }
    }

    /// Mentioned userIds that aren't members of `channelId` (standard channels
    /// only — DMs/group DMs have no add-member flow). Resolves display names
    /// from the local user table for the CTA copy.
    private func channelMentionMisses(channelId: String, mentionIds: [String]) async -> [MentionMiss] {
        guard !mentionIds.isEmpty else { return [] }
        let kind: String? = try? await db.reader.read { db in
            try String.fetchOne(db, sql: "SELECT kind FROM channel WHERE id = ?", arguments: [channelId])
        }
        guard kind == "standard" else { return [] }
        let members = Set(await channelMemberIds(channelId: channelId))
        guard !members.isEmpty else { return [] }
        let missing = mentionIds.filter { !members.contains($0) }
        guard !missing.isEmpty else { return [] }
        let names: [String: String] = (try? await db.reader.read { db -> [String: String] in
            let placeholders = missing.map { _ in "?" }.joined(separator: ",")
            var out: [String: String] = [:]
            for row in try Row.fetchAll(
                db,
                sql: "SELECT id, displayName FROM user WHERE id IN (\(placeholders))",
                arguments: StatementArguments(missing)
            ) {
                out[row["id"] as String] = (row["displayName"] as String?)
            }
            return out
        }) ?? [:]
        return missing.map { MentionMiss(id: $0, name: names[$0] ?? "someone") }
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

    // MARK: - Pinned messages

    /// Fetch every pin in the channel so older pinned messages become part of
    /// the local cache even when normal history pagination has not reached them.
    func loadPinnedMessages(channelId: String) async {
        do {
            let response: PinnedMessagesResponse = try await api.get("/v1/channels/\(channelId)/pins")
            // The list is authoritative: clear stale offline-era pins before
            // saving the current rows returned by the server.
            try? await db.writer.write { db in
                try db.execute(
                    sql: "UPDATE message SET pinnedAt = NULL, pinnedBy = NULL WHERE channelId = ?",
                    arguments: [channelId]
                )
            }
            await storeMessages(response.messages)
        } catch {
            await appState?.showError("Couldn't load pinned messages: \(error.localizedDescription)")
        }
    }

    /// Channel Files panel (#347/#348): one page of the channel's shared files.
    /// Browsing-only, so it never touches the GRDB cache — the panel is opened
    /// on demand and the server list is the truth for it.
    func channelFiles(
        channelId: String, sort: ChannelFileSort, before: String?, limit: Int = 30
    ) async throws -> ChannelFilePage {
        var query = [
            URLQueryItem(name: "sort", value: sort.rawValue),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let before { query.append(URLQueryItem(name: "before", value: before)) }
        return try await api.get("/v1/channels/\(channelId)/files", query: query)
    }

    /// Presigned in-place streaming URL for a file (server mints it after the
    /// same access check as a download). nil when the storage driver can't
    /// presign — callers must have a no-network fallback.
    func streamURL(fileId: String) async -> URL? {
        guard let response: StreamUrlResponse = try? await api.get("/v1/files/\(fileId)/url"),
              let raw = response.url else { return nil }
        return URL(string: raw)
    }

    /// Pin or unpin for the whole channel; the returned full message is the
    /// immediate local update and the websocket echo converges other clients.
    func togglePin(_ message: Message) async {
        do {
            let updated: Message
            if message.pinnedAt == nil {
                updated = try await api.put("/v1/messages/\(message.id)/pin")
            } else {
                updated = try await api.delete("/v1/messages/\(message.id)/pin")
            }
            _ = await applyServerMessage(updated)
        } catch {
            await appState?.showError("Couldn't update pin: \(error.localizedDescription)")
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
        case "heic", "heif": "image/heic"
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

    // MARK: - Artifacts (phase 13: per-channel shared)

    /// Fetches the visible artifacts for a workspace (those in channels I'm a
    /// member of) and publishes them to AppState. No GRDB cache: the list is
    /// small, so it gets the same fetch-on-demand treatment as notifications.
    func refreshArtifacts(workspaceId: String) async {
        guard let resp: ArtifactsResponse = try? await api.get(
            "/v1/workspaces/\(workspaceId)/artifacts"
        ) else { return }
        await appState?.setArtifacts(resp.artifacts, workspaceId: workspaceId)
    }

    /// Pins a file as a shared artifact in a channel (idempotent per
    /// channel+file for pins, server-enforced) and refreshes the sidebar list.
    func createArtifact(channelId: String, fileId: String, name: String? = nil) async throws -> Artifact {
        let artifact: Artifact = try await api.post(
            "/v1/artifacts",
            body: CreateArtifactBody(channelId: channelId, fileId: fileId, name: name)
        )
        await refreshArtifacts(workspaceId: artifact.workspaceId)
        return artifact
    }

    /// Pins a link as a shared co-browsing artifact in a channel (idempotent per
    /// channel+url, server-enforced) and refreshes the sidebar list.
    func createLinkArtifact(channelId: String, url: String, name: String? = nil) async throws -> Artifact {
        let artifact: Artifact = try await api.post(
            "/v1/artifacts",
            body: CreateArtifactBody(channelId: channelId, url: url, name: name)
        )
        await refreshArtifacts(workspaceId: artifact.workspaceId)
        return artifact
    }

    func renameArtifact(id: String, name: String) async throws {
        let artifact: Artifact = try await api.patch(
            "/v1/artifacts/\(id)",
            body: UpdateArtifactBody(name: name)
        )
        await refreshArtifacts(workspaceId: artifact.workspaceId)
    }

    /// Re-points a link artifact at a new url — the co-browse navigation write.
    /// The server publishes artifact.updated, so every viewer's mini-browser
    /// follows; we still refresh locally so the initiator updates immediately.
    func setArtifactURL(id: String, url: String) async throws {
        let artifact: Artifact = try await api.patch(
            "/v1/artifacts/\(id)",
            body: UpdateArtifactBody(url: url)
        )
        await refreshArtifacts(workspaceId: artifact.workspaceId)
    }

    /// Deletes the shared artifact. The server reaps the backing file too if the
    /// artifact owned it (guarded).
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

    /// This channel's membership, for any kind (#70). The Channel DTO only
    /// carries `memberIds` for DMs, so standard channels have to ask the
    /// server. Returns [] on failure — callers fall back to what they have.
    func channelMemberIds(channelId: String) async -> [String] {
        guard let resp: ChannelMembersResponse = try? await api.get("/v1/channels/\(channelId)/members")
        else { return [] }
        return resp.userIds
    }

    func addMember(channelId: String, userId: String) async throws {
        let _: OkResponse = try await api.post(
            "/v1/channels/\(channelId)/members",
            body: AddMemberBody(userId: userId)
        )
    }

    /// Delete a workspace (#340 follow-up). The sole owner's only way out: they
    /// cannot leave a workspace with nobody to transfer it to. Local cleanup
    /// and the landing choice are exactly `leaveWorkspace`'s — from the
    /// client's side "this workspace is gone for me" is one fact.
    @discardableResult
    func deleteWorkspace(_ workspaceId: String) async throws -> String? {
        let _: OkResponse = try await api.delete("/v1/workspaces/\(workspaceId)")
        return await purgeLeftWorkspace(workspaceId)
    }

    /// Leave a workspace (#340). The server revokes every channel membership
    /// there and publishes `member.left`; the local mirror is cleared here
    /// rather than waiting for that round trip, so the switcher updates the
    /// instant the call returns. Returns the workspace to land on — the first
    /// one left, or nil for the chooser when this was the last.
    @discardableResult
    func leaveWorkspace(_ workspaceId: String) async throws -> String? {
        let _: OkResponse = try await api.post("/v1/workspaces/\(workspaceId)/leave")
        return await purgeLeftWorkspace(workspaceId)
    }

    /// Forget a workspace we are no longer in. Two callers: our own Leave
    /// above, and the `member.left` that arrives when another client of ours
    /// left it or an admin removed us — the local state has to end up the same
    /// either way. Returns the workspace to land on (nil = the chooser).
    @discardableResult
    func purgeLeftWorkspace(_ workspaceId: String) async -> String? {
        let channelIds = (try? await db.reader.read { db in
            try String.fetchAll(db, sql: "SELECT id FROM channel WHERE workspaceId = ?", arguments: [workspaceId])
        }) ?? []
        try? await db.writer.write { db in
            try db.execute(
                sql: "DELETE FROM message WHERE channelId IN (SELECT id FROM channel WHERE workspaceId = ?)",
                arguments: [workspaceId]
            )
            try db.execute(sql: "DELETE FROM channel WHERE workspaceId = ?", arguments: [workspaceId])
            try db.execute(sql: "DELETE FROM member WHERE workspaceId = ?", arguments: [workspaceId])
            try db.execute(sql: "DELETE FROM workspace WHERE id = ?", arguments: [workspaceId])
        }
        for id in channelIds { historyLoaded.remove(id) } // re-fetch if we ever rejoin (#269)
        // Server truth, in case membership changed elsewhere while we were away.
        await refreshWorkspaces()
        let next = try? await db.reader.read { db in
            try String.fetchOne(db, sql: "SELECT id FROM workspace ORDER BY name COLLATE NOCASE LIMIT 1")
        }
        return next ?? nil
    }

    func leaveChannel(_ channelId: String) async throws {
        let _: OkResponse = try await api.post("/v1/channels/\(channelId)/leave")
        try? await db.writer.write { db in
            try db.execute(sql: "DELETE FROM channel WHERE id = ?", arguments: [channelId])
            try db.execute(sql: "DELETE FROM message WHERE channelId = ?", arguments: [channelId])
        }
        // Unconditional: each window checks its own selection.
        await appState?.channelBecameUnavailable(channelId)
    }

    // MARK: - Voice huddle (Phase 1)

    /// Mints a LiveKit access token scoped to this channel's room. Idempotent
    /// server-side — calling it while already an active participant re-mints
    /// a fresh token rather than erroring (decision log 2026-08-20); this is
    /// also the reconnect path.
    func joinHuddle(channelId: String) async throws -> HuddleJoinResponse {
        try await api.post("/v1/channels/\(channelId)/huddle/join")
    }

    /// Best-effort: the webhook safety net (participant_left) covers a
    /// request that never lands.
    func leaveHuddle(channelId: String) async {
        let _: OkResponse? = try? await api.post("/v1/channels/\(channelId)/huddle/leave")
    }

    func archiveChannel(_ channelId: String) async throws {
        let ch: Channel = try await api.post("/v1/channels/\(channelId)/archive")
        try? await db.writer.write { db in try ch.save(db) }
        await appState?.channelBecameUnavailable(channelId)
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

    func updateProfile(
        displayName: String?, timezone: String?, website: String? = nil, bio: String? = nil
    ) async throws {
        let me: User = try await api.patch(
            "/v1/me",
            body: PatchMeBody(
                displayName: displayName, timezone: timezone, website: website, bio: bio
            )
        )
        currentUser = me
        try? await db.writer.write { db in try me.save(db) }
        await appState?.setPhase(.signedIn(me))
    }

    /// Set (or clear, with two empty strings) the user's status emoji + label.
    /// `suppressAlerts` mirrors the web client's DND-family flag; nil leaves
    /// the server's current value alone.
    func setStatus(emoji: String, text: String, suppressAlerts: Bool? = nil) async throws {
        let me: User = try await api.patch(
            "/v1/me",
            body: PatchMeBody(
                statusEmoji: emoji, statusText: text, statusSuppressAlerts: suppressAlerts
            )
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
        // New avatar key: republish the map so message rows repaint at once
        // instead of waiting for the next member refresh.
        await pushAvatarPaths()
    }

    func fetchUser(_ userId: String) async throws -> User {
        let u: User = try await api.get("/v1/users/\(userId)")
        try? await db.writer.write { db in try u.save(db) }
        return u
    }

    // MARK: - Notifications (phase2.md §4)

    /// Activity is a row inside a workspace, so the feed is scoped to one —
    /// `workspaceId` nil only for the badge refresh before a workspace is
    /// selected. The response's `unreadCount` is that workspace's; the dock
    /// badge follows `totalUnreadCount`.
    func fetchNotifications(
        workspaceId: String? = nil,
        before: String? = nil
    ) async throws -> NotificationsResponse {
        let query: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: "50"),
            workspaceId.map { URLQueryItem(name: "workspaceId", value: $0) },
            before.map { URLQueryItem(name: "before", value: $0) },
        ].compactMap(\.self)
        let resp: NotificationsResponse = try await api.get("/v1/me/notifications", query: query)
        await appState?.setNotificationUnread(
            resp.unreadCount, workspaceId: workspaceId, total: resp.totalUnreadCount
        )
        return resp
    }

    /// Everything up to a cursor (opening the Activity feed). Scoped to the
    /// feed's workspace so it can't read rows the user never saw.
    func markNotificationsRead(upToId: String, workspaceId: String?) async {
        let _: OkResponse? = try? await api.post(
            "/v1/me/notifications/read",
            body: MarkNotificationsReadBody(upToId: upToId, workspaceId: workspaceId)
        )
        await refreshNotificationBadge()
    }

    /// A single row (clicking it in the feed, or seeing it land in the channel
    /// you're already looking at — issue #63).
    func markNotificationRead(id: String) async {
        let _: OkResponse? = try? await api.post(
            "/v1/me/notifications/read",
            body: MarkNotificationsReadBody(id: id)
        )
        await refreshNotificationBadge()
    }

    /// Both badges: every open workspace's count plus the total. Windows can
    /// show different workspaces, so each open one gets its own scoped fetch;
    /// with none open a single unscoped fetch still keeps the dock badge live.
    func refreshNotificationBadge() async {
        let workspaceIds = await appState?.openWorkspaceIds ?? []
        if workspaceIds.isEmpty {
            guard let resp: NotificationsResponse = try? await api.get(
                "/v1/me/notifications", query: [URLQueryItem(name: "limit", value: "1")]
            ) else { return }
            await appState?.setNotificationUnread(
                resp.unreadCount, workspaceId: nil, total: resp.totalUnreadCount
            )
            return
        }
        for workspaceId in workspaceIds {
            guard let resp: NotificationsResponse = try? await api.get(
                "/v1/me/notifications",
                query: [
                    URLQueryItem(name: "limit", value: "1"),
                    URLQueryItem(name: "workspaceId", value: workspaceId),
                ]
            ) else { continue }
            await appState?.setNotificationUnread(
                resp.unreadCount, workspaceId: workspaceId, total: resp.totalUnreadCount
            )
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

    /// Phase 11 §10: the author removes one link preview from their message.
    /// The server tombstones it and republishes the message, so the local row
    /// is patched optimistically and the event confirms it.
    func deleteUnfurl(messageId: String, urlHash: String) async {
        do {
            let _: OkResponse = try await api.delete("/v1/messages/\(messageId)/unfurls/\(urlHash)")
            try? await db.writer.write { db in
                guard var msg = try Message.fetchOne(db, key: messageId) else { return }
                msg.unfurls.removeAll { $0.urlHash == urlHash }
                try msg.update(db)
            }
        } catch {
            await appState?.showError("Couldn't remove preview: \(error.localizedDescription)")
        }
    }

    // MARK: - Threads

    func openThread(rootId: String?) async {
        guard let rootId else { return }
        await fetchThread(rootId: rootId)
    }

    /// Pages the *whole* thread in (cursor `after`, replies ascending). Two
    /// things depend on that: the panel is built on "the thread loads whole"
    /// — its jump-to-reply has no paging of its own — and this is the only
    /// fallback that reconciles an optimistic reply whose ack was missed.
    /// Dropping `hasMore` broke both past 100 replies, and the orphaned
    /// pending row then spun forever (#328).
    private func fetchThread(rootId: String) async {
        var after: String? = nil
        var pages = 0
        var channelId: String? = nil
        var reachedTail = false
        while pages < Self.threadMaxPages {
            let query: [URLQueryItem] = [
                URLQueryItem(name: "limit", value: "\(Self.threadPageSize)"),
                after.map { URLQueryItem(name: "after", value: $0) },
            ].compactMap(\.self)
            guard let resp: ThreadResponse = try? await api.get(
                "/v1/messages/\(rootId)/thread", query: query
            ) else { break }
            pages += 1
            // The root only comes with the first page; later pages are replies.
            await storeMessages(pages == 1 ? [resp.root] + resp.messages : resp.messages)
            channelId = resp.root.channelId
            guard resp.hasMore, let last = resp.messages.last?.id else {
                reachedTail = true
                break
            }
            after = last
        }
        // Nothing arrived: don't claim the thread was read.
        guard let channelId else { return }
        // Only once the tail is actually local is a still-pending reply here
        // known to have missed its ack, rather than sitting on a page a
        // dropped request never fetched.
        if reachedTail { await sweepStalePending(threadRootId: rootId) }
        await markThreadRead(channelId: channelId, rootId: rootId)
    }

    /// Thread paging: 100 replies a page, capped at 50 pages. The cap is a
    /// runaway guard, not a product limit — a thread past 5 000 replies pages
    /// no further, which costs the tail, not correctness of what is shown.
    private static let threadPageSize = 100
    private static let threadMaxPages = 50

    /// A pending row older than this is not in flight any more: the POST that
    /// owned it died with the app, the network, or a half-open socket.
    private static let stalePendingAge: TimeInterval = 120

    /// Flip orphaned optimistic rows to `failed`, so the user gets the Retry
    /// affordance instead of a spinner that never stops (#328).
    ///
    /// Always runs *after* a fetch that could have reconciled them (reconnect
    /// backfill, thread open), so a row the server actually has is already
    /// gone by the time the sweep looks. And when the sweep is wrong anyway —
    /// delivered, but in a channel this pass didn't fetch — it costs one
    /// re-POST and no duplicate: retries reuse the `clientMsgId` the server is
    /// idempotent on, and a server twin deletes the local row on arrival.
    private func sweepStalePending(threadRootId: String? = nil) async {
        let now = Date()
        try? await db.writer.write { db in
            let pending = try Message.filter(Column("pending") == true).fetchAll(db)
            for m in pending {
                if let root = threadRootId, m.threadRootId != root { continue }
                guard let created = ISO8601.parse(m.createdAt),
                      now.timeIntervalSince(created) > Self.stalePendingAge else { continue }
                try db.execute(
                    sql: "UPDATE message SET pending = 0, failed = 1 WHERE id = ?",
                    arguments: [m.id]
                )
                if let root = m.threadRootId { try Self.unbumpThreadRollup(db, rootId: root) }
            }
        }
    }

    // MARK: - Typing

    /// Throttled to one frame per ~3s per composer (a channel's main composer
    /// and each of its threads throttle independently).
    func typing(channelId: String, threadRootId: String? = nil) async {
        let now = Date()
        let key = TypingKey.make(channelId: channelId, threadRootId: threadRootId)
        if let last = typingLastSent[key], now.timeIntervalSince(last) < 3 { return }
        typingLastSent[key] = now
        await socket.sendTyping(channelId: channelId, threadRootId: threadRootId)
    }

    // MARK: - Event handling

    private func handleEvent(_ event: EventDTO) async {
        switch event.payload {
        case .message(let m):
            if event.type == "message.purged" {
                // Hard delete: remove the row entirely (no tombstone) and mirror
                // the server's rollup decrement if it was a thread reply.
                await purgeMessage(m)
                return
            }
            let isNew = await applyServerMessage(m)
            if event.type == "message.created" || event.type == "thread.reply" {
                // The sender's message arrived — clear their typing indicator
                // for the composer they sent it from (main view or that thread).
                await appState?.typingStopped(
                    channelId: m.channelId, threadRootId: m.threadRootId, userId: m.userId)
            }
            // System lines (join/leave) never affect unread — mirror the server,
            // which excludes them from its counts (ui_nits).
            if event.type == "message.created", isNew, m.userId != currentUser?.id, m.systemKind == nil {
                // Same "actually looking at it" test as notifications above —
                // the read cursor now also clears that channel's notification
                // rows server-side, so a backgrounded window must not advance it.
                if await appState?.isViewing(channelId: m.channelId) == true {
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
                await appState?.typingReceived(
                    channelId: t.channelId, threadRootId: t.threadRootId, userId: t.userId)
            }

        case .presence(let p):
            await appState?.presenceReceived(userId: p.userId, online: p.status == "online")

        case .channelIndicator(let ind):
            // Any non-nil state spins the row — an added state later shouldn't
            // leave this client rendering nothing.
            await appState?.channelIndicatorReceived(
                channelId: ind.channelId, busy: ind.state != nil)

        case .huddleUpdated(let d):
            await appState?.huddleUpdated(channelId: d.channelId, participants: d.participants)

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

        case .workspaceJoined:
            // this user entered a workspace from another session (e.g. accepted
            // an invite on the web) — pull the new row so the switcher shows it
            await refreshWorkspaces()

        case .memberJoined(let mj):
            if await appState?.isWorkspaceOpen(event.workspaceId) == true {
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
                if ml.userId == currentUser?.id {
                    // We left this workspace — from another client of ours, or
                    // an admin removed us (#340). Drop it locally and move
                    // every window showing it somewhere it can still read.
                    let next = await purgeLeftWorkspace(event.workspaceId)
                    await appState?.workspaceBecameUnavailable(event.workspaceId, landOn: next)
                    return
                }
                // Workspace-level departure (member removed / app deleted):
                // refresh so the member and mention lists drop them.
                if await appState?.isWorkspaceOpen(event.workspaceId) == true {
                    await refreshMembers(workspaceId: event.workspaceId)
                }
            }
            if ml.userId == currentUser?.id, let chId = ml.channelId {
                try? await db.writer.write { db in
                    try db.execute(sql: "DELETE FROM channel WHERE id = ?", arguments: [chId])
                    try db.execute(sql: "DELETE FROM message WHERE channelId = ?", arguments: [chId])
                }
                historyLoaded.remove(chId) // its cache just went — re-fetch on re-entry (#269)
                await appState?.channelBecameUnavailable(chId)
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
            await appState?.channelBecameUnavailable(ch.id)

        case .reaction(let data, let added):
            await applyReactionEvent(data, added: added)

        case .notification(let n):
            // Only when the row is genuinely on screen — app frontmost, channel
            // selected (AppState.isViewing), and, when the message lives in a
            // thread (a reply, a mention in a reply, a reaction on your reply),
            // that thread open. Threads are behind a click: same scoping the
            // server's channel-read path uses (threadRootId IS NULL). A selected
            // channel in a backgrounded window is not "seen" either — treating
            // it as read swallowed DMs that landed while the app sat behind the
            // browser. Reading it here matters because a reaction moves no read
            // cursor, so nothing else would ever clear it.
            if await appState?.isViewingMessage(
                channelId: n.channelId, threadRootId: n.message.threadRootId
            ) == true {
                await markNotificationRead(id: n.id)
                return
            }
            await appState?.notificationReceived(n)
            // The sidebar badge is this channel's unread-notification count.
            let notifChannelId = n.channelId
            // A reply needs you: also light the dot on that thread's chip
            // (#270), so the transcript says *which* thread, not just that the
            // channel has something. Read-modify-write — it's a JSON array.
            let notifThreadRootId = n.message.threadRootId
            let notifWorkspaceId = n.workspaceId
            try? await db.writer.write { db in
                try db.execute(
                    sql: "UPDATE channel SET unreadNotifications = unreadNotifications + 1 WHERE id = ? AND isMember = 1",
                    arguments: [notifChannelId]
                )
                // The rail badge (#345) counts these same rows per workspace —
                // move it in the same write. Nil = "not fetched yet", stays nil.
                try db.execute(
                    sql: "UPDATE workspace SET unreadCount = unreadCount + 1 WHERE id = ? AND unreadCount IS NOT NULL",
                    arguments: [notifWorkspaceId]
                )
                guard let rootId = notifThreadRootId,
                      var chan = try Channel.filter(key: notifChannelId).fetchOne(db),
                      chan.isMember else { return }
                var roots = chan.unreadThreadRootIds ?? []
                guard !roots.contains(rootId) else { return }
                roots.append(rootId)
                chan.unreadThreadRootIds = roots
                try chan.save(db)
            }
            // Banner unless the server's alert gate (per-user prefs + status
            // suppression, phase 10) says no — kind 3 activity rows are always
            // suppressed there, so they never bannered.
            if n.alerts, n.actorUserId != currentUser?.id {
                // Full name map, not just the sender: the body carries raw
                // <@userId> tokens, and plainText without names renders every
                // one as "@someone". The user table is small and cached.
                let names: [String: String] = (try? await db.reader.read { db in
                    try Dictionary(
                        uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayName) }
                    )
                }) ?? [:]
                let senderName = names[n.actorUserId]
                let title = switch n.kind {
                case 1: senderName ?? "New direct message"
                case 2: "\(senderName ?? "Someone") replied in a thread"
                case 4: "\(senderName ?? "Someone") reacted \(n.reactionEmoji ?? "")"
                    .trimmingCharacters(in: .whitespaces)
                case 5: "\(senderName ?? "Someone") added you to a channel"
                default: "\(senderName ?? "Someone") mentioned you"
                }
                Banners.show(n, title: title, body: MentionRendering.plainText(n.message.body, names: names))
            }

        case .notificationRead:
            // Another session (or the server, on a channel/thread visit) read
            // rows. The event's count is the cross-workspace total, so it can't
            // drive the workspace-scoped sidebar badge — refetch both.
            await refreshNotificationBadge()
            // The rows can span channels (and workspaces, from the Activity
            // feed), and the event carries ids rather than a per-channel
            // breakdown — refetch the lists rather than guess at the deltas.
            for workspaceId in await appState?.openWorkspaceIds ?? [] {
                await refreshChannels(workspaceId: workspaceId)
            }
            // …and the rail badges (#345), which count the same rows.
            await refreshWorkspaces()

        case .workspaceUpdated(let ws):
            await saveWorkspacePreservingRole(ws)

        case .artifact(let a, let change):
            // Per-channel shared artifacts (phase 13): keep the sidebar list
            // fresh; a deletion of the open artifact closes the side panel.
            if change == .deleted {
                await appState?.artifactBecameUnavailable(a.id)
            }
            if await appState?.isWorkspaceOpen(event.workspaceId) == true {
                await refreshArtifacts(workspaceId: event.workspaceId)
                // Auto-open an agent-created artifact for whoever is viewing its
                // channel — the user who asked the agent to make it. Gated on
                // ownsFile (agent-generated) so a human pin never steals focus.
                if change == .created {
                    await appState?.maybeAutoOpenArtifact(a)
                }
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

    /// Hard delete (`message.purged`): drop the row with no tombstone. Mirrors
    /// the server's txn — a purged reply decrements the root's rollup and
    /// recomputes lastReplyAt; a re-posted reply re-bumps it. Participants
    /// recompute on the next thread fetch.
    private func purgeMessage(_ m: Message) async {
        try? await db.writer.write { db in
            try Message.filter(key: m.id).deleteAll(db)
            if let root = m.threadRootId, var r = try Message.filter(key: root).fetchOne(db) {
                r.replyCount = max(0, r.replyCount - 1)
                r.lastReplyAt = try String.fetchOne(
                    db,
                    sql: "SELECT max(createdAt) FROM message WHERE threadRootId = ?",
                    arguments: [root]
                )
                try r.save(db)
            }
        }
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

    /// Reverse a `bumpThreadRollup` when an optimistic reply fails: decrement
    /// replyCount and recompute lastReplyAt from the remaining non-failed
    /// replies. Participants recompute on the next thread fetch (like purge).
    private static func unbumpThreadRollup(_ db: Database, rootId: String) throws {
        guard var root = try Message.filter(key: rootId).fetchOne(db) else { return }
        root.replyCount = max(0, root.replyCount - 1)
        root.lastReplyAt = try String.fetchOne(
            db,
            sql: "SELECT max(createdAt) FROM message WHERE threadRootId = ? AND failed = 0",
            arguments: [rootId]
        )
        try root.save(db)
    }

    /// Bulk store for history/backfill pages (no unread or reply-count bumps:
    /// server rows already carry authoritative rollups).
    private func storeMessages(_ messages: [Message]) async {
        guard !messages.isEmpty else { return }
        try? await db.writer.write { db in
            for m in messages {
                // A local twin of a server row is optimistic by definition
                // (`clientMsgId` is unique per channel server-side). `failed`
                // as well as `pending`: the stale-pending sweep can flag a
                // message the server did receive, and its twin arriving here
                // is the proof — leaving it would show the send twice.
                try Message
                    .filter(Column("channelId") == m.channelId)
                    .filter(Column("clientMsgId") == m.clientMsgId)
                    .filter(Column("id") != m.id)
                    .filter(Column("pending") == true || Column("failed") == true)
                    .deleteAll(db)
                try m.save(db)
            }
        }
    }
}

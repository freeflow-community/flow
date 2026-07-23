import Foundation
import SwiftUI

/// Main-actor UI state: auth phase, selection, and ephemeral (non-persisted)
/// typing/presence maps. Persistent data lives in GRDB and is observed
/// directly by views.
@MainActor
final class AppState: ObservableObject {
    enum Phase: Equatable {
        case loading
        case signedOut
        case signedIn(User)
    }

    enum Connection: Equatable {
        case connecting
        case connected
        case reconnecting

        var label: String {
            switch self {
            case .connecting: "Connecting…"
            case .connected: "Connected"
            case .reconnecting: "Reconnecting…"
            }
        }
    }

    @Published private(set) var phase: Phase = .loading
    @Published var selectedWorkspaceId: String?
    @Published var selectedChannelId: String?
    @Published var openThreadRootId: String?
    /// Open artifact tab (phase 9) — when set, the content pane shows the
    /// artifact panel; the selected channel stays put behind it so closing
    /// the artifact returns to it.
    @Published var selectedArtifactId: String?
    /// Activity feed (phase 12) — the always-present virtual "channel" that
    /// replaced the notifications bell. When true the content pane shows
    /// <ActivityFeedView>; the selected channel stays put behind it (like an
    /// artifact) so picking a channel returns to a normal conversation.
    @Published var showActivity: Bool = false
    /// Jump-to-message target (phase 12): a message id the channel/thread view
    /// should scroll to and flash after navigation (set when a notification is
    /// tapped in the Activity feed). Cleared once reached (or given up on).
    @Published var focusMessageId: String?
    /// My artifact bookmarks for the active workspace (phase 9), newest first.
    @Published private(set) var artifacts: [Artifact] = []
    @Published private(set) var connection: Connection = .connecting
    /// userId -> online?
    @Published private(set) var presence: [String: Bool] = [:]
    /// channelId -> (userId -> last typing event time)
    @Published private(set) var typing: [String: [String: Date]] = [:]
    /// channelId -> more history available on the server
    @Published private(set) var hasMore: [String: Bool] = [:]
    /// Unread in-app notification count (bell badge + dock badge).
    @Published private(set) var notificationUnread: Int = 0
    /// userId -> avatar path (/v1/avatars/<key>), for message rows & popovers.
    @Published private(set) var avatarPaths: [String: String] = [:]
    @Published var errorMessage: String?

    let db: AppDatabase
    let engine: SyncEngine

    init() {
        do {
            self.db = try AppDatabase.open()
        } catch {
            fatalError("Cannot open local database: \(error)")
        }
        let api = APIClient(baseURL: Server.baseURL)
        let socket = SocketClient(url: Server.wsURL)
        self.engine = SyncEngine(db: db, api: api, socket: socket)
        Task {
            await ImageLoader.shared.configure(api: api)
            await engine.attach(self)
            await engine.bootstrap()
        }
    }

    var currentUser: User? {
        if case .signedIn(let user) = phase { user } else { nil }
    }

    // MARK: - Engine callbacks

    func setPhase(_ p: Phase) {
        phase = p
        if case .signedOut = p {
            selectedWorkspaceId = nil
            selectedChannelId = nil
            openThreadRootId = nil
            selectedArtifactId = nil
            artifacts = []
        }
    }

    func didSignOut() {
        phase = .signedOut
        selectedWorkspaceId = nil
        selectedChannelId = nil
        openThreadRootId = nil
        selectedArtifactId = nil
        showActivity = false
        focusMessageId = nil
        artifacts = []
        presence = [:]
        typing = [:]
        hasMore = [:]
        setNotificationUnread(0)
    }

    func setConnection(_ c: Connection) {
        connection = c
    }

    func showError(_ message: String) {
        errorMessage = message
    }

    func setHasMore(channelId: String, _ value: Bool) {
        hasMore[channelId] = value
    }

    func typingReceived(channelId: String, threadRootId: String? = nil, userId: String) {
        let key = TypingKey.make(channelId: channelId, threadRootId: threadRootId)
        typing[key, default: [:]][userId] = Date()
        // Expire after ~5s.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(5.2))
            guard let self else { return }
            if let at = self.typing[key]?[userId],
               Date().timeIntervalSince(at) >= 5 {
                self.typing[key]?.removeValue(forKey: userId)
            }
        }
    }

    /// A message from this user arrived — drop their lingering typing entry
    /// instead of waiting out the 5s window.
    func typingStopped(channelId: String, threadRootId: String? = nil, userId: String) {
        typing[TypingKey.make(channelId: channelId, threadRootId: threadRootId)]?.removeValue(forKey: userId)
    }

    func presenceReceived(userId: String, online: Bool) {
        presence[userId] = online
    }

    func setAvatarPaths(_ paths: [String: String]) {
        avatarPaths = paths
    }

    func setArtifacts(_ list: [Artifact]) {
        artifacts = list
    }

    /// Open artifact was removed (here or on another device): close the panel
    /// back to the channel behind it.
    func artifactBecameUnavailable(_ artifactId: String) {
        if selectedArtifactId == artifactId {
            selectedArtifactId = nil
        }
    }

    func setNotificationUnread(_ n: Int) {
        notificationUnread = n
        Banners.setBadge(n)
    }

    func notificationReceived(_ n: NotificationItem) {
        setNotificationUnread(notificationUnread + 1)
    }

    /// Active channel was archived or left — drop the selection.
    func channelBecameUnavailable(_ channelId: String) {
        if selectedChannelId == channelId {
            selectedChannelId = nil
            openThreadRootId = nil
        }
    }

    /// Activity-feed navigation: jump to a notification's channel (and thread),
    /// then scroll to + flash the triggering message. `focusMessageId` is set
    /// last, since selectChannel clears it for ordinary channel switches.
    func openNotification(_ n: NotificationItem) {
        if selectedWorkspaceId != n.workspaceId {
            selectWorkspace(n.workspaceId)
        }
        selectChannel(n.channelId)
        if let root = n.message.threadRootId {
            openThread(root)
        }
        focusMessageId = n.messageId
    }

    /// Who's typing in one composer. `threadRootId` nil = the channel's main
    /// composer, so a thread's typists never surface in the channel view.
    func typingUserIds(channelId: String, threadRootId: String? = nil) -> [String] {
        (typing[TypingKey.make(channelId: channelId, threadRootId: threadRootId)] ?? [:])
            .filter { Date().timeIntervalSince($0.value) < 5 }
            .map(\.key)
            .sorted()
    }

    // MARK: - UI actions

    private static let activeWorkspaceKey = "activeWorkspaceId" + Profile.suffix

    func selectWorkspace(_ id: String?) {
        selectedWorkspaceId = id
        selectedChannelId = nil
        openThreadRootId = nil
        selectedArtifactId = nil
        showActivity = false
        artifacts = []
        // Active workspace survives relaunch (phase 3.5 fixes).
        if let id {
            UserDefaults.standard.set(id, forKey: Self.activeWorkspaceKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.activeWorkspaceKey)
        }
        Task { await engine.selectWorkspace(id) }
    }

    /// Restore the last active workspace at launch (validated by the caller
    /// against the workspace list once it loads).
    func restoreActiveWorkspace() {
        guard selectedWorkspaceId == nil,
              let saved = UserDefaults.standard.string(forKey: Self.activeWorkspaceKey)
        else { return }
        selectedWorkspaceId = saved
        Task { await engine.selectWorkspace(saved) }
    }

    func selectChannel(_ id: String?) {
        // Selecting a channel always closes an open artifact panel or the
        // activity feed — even when it's the same channel that's behind them.
        selectedArtifactId = nil
        showActivity = false
        guard id != selectedChannelId else { return }
        selectedChannelId = id
        openThreadRootId = nil
        Task { await engine.selectChannel(id) }
    }

    /// Opens (or closes, with nil) an artifact tab. The channel selection is
    /// untouched: the panel covers the channel content and closing returns
    /// to it.
    func selectArtifact(_ id: String?) {
        if id != nil { showActivity = false }
        selectedArtifactId = id
    }

    /// Show the Activity feed (phase 12). Like opening an artifact it covers the
    /// content pane while the channel selection stays put behind it.
    func showActivityFeed() {
        selectedArtifactId = nil
        showActivity = true
    }

    func openThread(_ rootId: String?) {
        openThreadRootId = rootId
        Task { await engine.openThread(rootId: rootId) }
    }

    /// Handles flow://invite/<token> deep links (and pasted URLs/tokens).
    func acceptInvite(_ raw: String) {
        var token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: token), url.scheme == "flow" {
            token = url.lastPathComponent
        }
        guard !token.isEmpty else { return }
        Task {
            do {
                let ws = try await engine.acceptInvite(token: token)
                selectWorkspace(ws.id)
            } catch {
                errorMessage = "Couldn't accept invite: \(error.localizedDescription)"
            }
        }
    }

    func handleDeepLink(_ url: URL) {
        guard url.scheme == "flow" else { return }
        switch url.host {
        case "invite":
            acceptInvite(url.lastPathComponent)
        case "signin":
            let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "code" }?.value ?? ""
            signInFromLink(code: code)
        default:
            break
        }
    }

    /// Web-to-app handoff: flow://signin?code=<one-time code>. Any existing
    /// session is signed out first (the link may be for a different account,
    /// and the local cache must not mix users).
    func signInFromLink(code: String) {
        guard !code.isEmpty else { return }
        Task {
            do {
                if currentUser != nil {
                    await engine.logout()
                }
                try await engine.loginWithLinkCode(code)
            } catch {
                errorMessage = "Couldn't sign in from the app link: \(error.localizedDescription)"
            }
        }
    }
}

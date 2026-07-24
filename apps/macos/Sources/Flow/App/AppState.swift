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
    /// Open artifact (phase 13) — when set, the right-hand side panel shows the
    /// artifact next to its channel (mutually exclusive with the thread panel).
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
    /// Visible artifacts for the active workspace (phase 13) — those in channels
    /// I'm a member of, newest first. Grouped by channel in the sidebar.
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
    /// Set of agent user ids — the typing indicator says an agent "thinks"
    /// rather than "types" (ui_nits). Derived from cached user rows.
    @Published private(set) var agentIds: Set<String> = []
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

    func setAgentIds(_ ids: Set<String>) {
        agentIds = ids
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
        openNotification(
            workspaceId: n.workspaceId,
            channelId: n.channelId,
            messageId: n.messageId,
            threadRootId: n.message.threadRootId
        )
    }

    /// Same jump as `openNotification(_:)` but from the flat fields carried in a
    /// tapped OS banner's `userInfo` — the notification-center callback has no
    /// `NotificationItem` to hand (see `AppDelegate`).
    func openNotification(workspaceId: String, channelId: String, messageId: String, threadRootId: String?) {
        if selectedWorkspaceId != workspaceId {
            selectWorkspace(workspaceId)
        }
        selectChannel(channelId)
        if let threadRootId {
            openThread(threadRootId)
        }
        focusMessageId = messageId
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

    /// Open/activate an artifact tab in the side panel (phase 13). The panel is
    /// a tabbed container shared with the thread — opening an artifact does NOT
    /// close an open thread (they coexist as tabs); it just makes the artifact
    /// the visible tab and selects its channel so the conversation shows behind.
    /// nil just clears the active artifact (the thread tab, if any, stays).
    func selectArtifact(_ id: String?) {
        if let id {
            showActivity = false
            if let a = artifacts.first(where: { $0.id == id }), a.channelId != selectedChannelId {
                selectedChannelId = a.channelId
                Task { await engine.selectChannel(a.channelId) }
            }
        }
        selectedArtifactId = id
    }

    /// Switch the side panel to the Thread tab (the thread stays open).
    func showThread() {
        selectedArtifactId = nil
    }

    /// Close the whole side panel — clears the thread and the active artifact.
    func closeSidePanel() {
        selectedArtifactId = nil
        if openThreadRootId != nil {
            openThreadRootId = nil
            Task { await engine.openThread(rootId: nil) }
        }
    }

    /// Auto-open an agent-created artifact for the user viewing its channel —
    /// the person who asked the agent to make it. Gated on `ownsFile` (the
    /// content was agent-generated, not a human pin) and on the artifact's
    /// channel being the active one, so it only pops for someone in that
    /// conversation and a human "Pin as artifact" never steals focus.
    func maybeAutoOpenArtifact(_ a: Artifact) {
        guard a.ownsFile, a.channelId == selectedChannelId else { return }
        selectArtifact(a.id)
    }

    /// Artifacts pinned in a given channel (for the sidebar's nested rows).
    func artifacts(inChannel channelId: String) -> [Artifact] {
        artifacts.filter { $0.channelId == channelId }
    }

    /// Show the Activity feed (phase 12). Like opening an artifact it covers the
    /// content pane while the channel selection stays put behind it.
    func showActivityFeed() {
        selectedArtifactId = nil
        showActivity = true
    }

    func openThread(_ rootId: String?) {
        if rootId != nil { selectedArtifactId = nil } // shares the slot with the artifact panel (phase 13)
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

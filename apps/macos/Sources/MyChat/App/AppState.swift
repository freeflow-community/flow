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
        let api = APIClient(baseURL: URL(string: "http://127.0.0.1:8787")!)
        let socket = SocketClient(url: URL(string: "ws://127.0.0.1:8787/v1/ws")!)
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
        }
    }

    func didSignOut() {
        phase = .signedOut
        selectedWorkspaceId = nil
        selectedChannelId = nil
        openThreadRootId = nil
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

    func typingReceived(channelId: String, userId: String) {
        typing[channelId, default: [:]][userId] = Date()
        // Expire after ~5s.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(5.2))
            guard let self else { return }
            if let at = self.typing[channelId]?[userId],
               Date().timeIntervalSince(at) >= 5 {
                self.typing[channelId]?.removeValue(forKey: userId)
            }
        }
    }

    func presenceReceived(userId: String, online: Bool) {
        presence[userId] = online
    }

    func setAvatarPaths(_ paths: [String: String]) {
        avatarPaths = paths
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

    /// Bell-menu navigation: jump to a notification's channel (and thread).
    func openNotification(_ n: NotificationItem) {
        if selectedWorkspaceId != n.workspaceId {
            selectWorkspace(n.workspaceId)
        }
        selectChannel(n.channelId)
        if let root = n.message.threadRootId {
            openThread(root)
        }
    }

    func typingUserIds(channelId: String) -> [String] {
        (typing[channelId] ?? [:])
            .filter { Date().timeIntervalSince($0.value) < 5 }
            .map(\.key)
            .sorted()
    }

    // MARK: - UI actions

    func selectWorkspace(_ id: String?) {
        selectedWorkspaceId = id
        selectedChannelId = nil
        openThreadRootId = nil
        Task { await engine.selectWorkspace(id) }
    }

    func selectChannel(_ id: String?) {
        guard id != selectedChannelId else { return }
        selectedChannelId = id
        openThreadRootId = nil
        Task { await engine.selectChannel(id) }
    }

    func openThread(_ rootId: String?) {
        openThreadRootId = rootId
        Task { await engine.openThread(rootId: rootId) }
    }

    /// Handles myapp://invite/<token> deep links (and pasted URLs/tokens).
    func acceptInvite(_ raw: String) {
        var token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: token), url.scheme == "myapp" {
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
        guard url.scheme == "myapp", url.host == "invite" else { return }
        acceptInvite(url.lastPathComponent)
    }
}

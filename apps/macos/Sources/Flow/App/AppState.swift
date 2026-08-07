import Combine
import Foundation
import SwiftUI

/// Main-actor app-wide state: auth phase, connection, and ephemeral
/// (non-persisted) typing/presence maps, shared by every window. What each
/// window is *looking at* lives in that window's `WindowState`; AppState keeps
/// a registry of them so cross-window questions ("is anyone viewing this
/// channel?") have one answer. Persistent data lives in GRDB and is observed
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
    /// Whether a channel or DM sidebar row should draw the selected pill (#113).
    ///
    /// The artifact panel and the Activity feed each sit *over* the channel
    /// selection rather than replacing it — `selectedChannelId` deliberately
    /// stays put behind both — so a row is only highlighted when neither is
    /// showing. Miss one of those terms and two rows light up at once.
    ///
    /// Static and pure so the rule is one testable thing rather than a
    /// condition retyped at every call site; `nonisolated` because it touches
    /// no state and the tests are not on the main actor.
    nonisolated static func channelRowHighlighted(
        rowId: String, selectedChannelId: String?, selectedArtifactId: String?, showActivity: Bool
    ) -> Bool {
        selectedChannelId == rowId && selectedArtifactId == nil && !showActivity
    }

    /// Visible artifacts per workspace (phase 13) — those in channels I'm a
    /// member of, newest first. Keyed by workspace because two windows can
    /// show two workspaces at once; each window reads its own slice.
    @Published private(set) var artifactsByWorkspace: [String: [Artifact]] = [:]
    @Published private(set) var connection: Connection = .connecting
    /// userId -> online?
    @Published private(set) var presence: [String: Bool] = [:]
    /// channelId -> (userId -> last typing event time)
    @Published private(set) var typing: [String: [String: Date]] = [:]
    /// Channels an agent is working in right now (#137) — the sidebar spinner.
    @Published private(set) var busyChannelIds: Set<String> = []
    /// channelId -> more history available on the server
    @Published private(set) var hasMore: [String: Bool] = [:]
    /// Unread notifications per workspace — each window's sidebar Activity
    /// badge reads its own workspace's count.
    @Published private(set) var notificationUnreadByWorkspace: [String: Int] = [:]
    /// Unread across every workspace — the dock badge, which has to keep
    /// speaking for the workspaces you aren't looking at.
    @Published private(set) var notificationUnreadTotal: Int = 0
    /// Is the app frontmost? See `isViewing(channelId:)` — a selection in a
    /// backgrounded window must not count as "the user has seen this".
    @Published private(set) var isAppActive: Bool = true
    /// userId -> avatar path (/v1/avatars/<key>), for message rows & popovers.
    @Published private(set) var avatarPaths: [String: String] = [:]
    /// Set of agent user ids — the typing indicator says an agent "thinks"
    /// rather than "types" (ui_nits). Derived from cached user rows.
    @Published private(set) var agentIds: Set<String> = []
    @Published var errorMessage: String?
    /// Why the sign-in screen is showing, when it isn't because the user asked
    /// (currently: the session expired under them). Cleared on a fresh sign-in.
    @Published var signedOutReason: String?

    let db: AppDatabase
    let engine: SyncEngine

    // MARK: - Window registry

    /// Weak box so a closed window's state just falls out of the registry —
    /// window teardown has no reliable "last onDisappear" to unregister on.
    private final class WeakWindow {
        weak var value: WindowState?
        init(_ value: WindowState) { self.value = value }
    }

    private var windowRefs: [WeakWindow] = []
    /// The window that last was (or is) key — where an OS banner tap or an
    /// accepted invite should navigate.
    private weak var keyWindow: WindowState?

    /// The live windows, compacting out any that have closed.
    var windows: [WindowState] {
        windowRefs.removeAll { $0.value == nil }
        return windowRefs.compactMap(\.value)
    }

    func register(_ window: WindowState) {
        windowRefs.append(WeakWindow(window))
        if keyWindow == nil { keyWindow = window }
    }

    func noteKeyWindow(_ window: WindowState) {
        keyWindow = window
    }

    /// The window navigation from outside a window (banner tap, invite accept)
    /// should land in.
    private var routingWindow: WindowState? {
        if let keyWindow { return keyWindow }
        return windows.first
    }

#if os(iOS)
    // MARK: - Single-window bridge (iOS)

    // iOS has exactly one window, so AppState owns its WindowState and keeps
    // the pre-window-split member names the phone views were written against.
    // WindowState's changes are re-published through AppState (the sink below)
    // because those views observe AppState, not the window.
    private var _window: WindowState?
    private var windowBridge: AnyCancellable?
    var window: WindowState {
        if let w = _window { return w }
        let w = WindowState(app: self)
        windowBridge = w.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
        _window = w
        return w
    }

    var selectedWorkspaceId: String? { window.selectedWorkspaceId }
    var selectedChannelId: String? { window.selectedChannelId }
    var openThreadRootId: String? { window.openThreadRootId }
    var selectedArtifactId: String? { window.selectedArtifactId }
    var showActivity: Bool {
        get { window.showActivity }
        set { window.showActivity = newValue }
    }
    var focusMessageId: String? {
        get { window.focusMessageId }
        set { window.focusMessageId = newValue }
    }
    /// The selected workspace's visible artifacts (newest first).
    var artifacts: [Artifact] { window.artifacts() }
    /// Unread notifications in the selected workspace (the Activity badge).
    var notificationUnread: Int {
        selectedWorkspaceId.flatMap { notificationUnreadByWorkspace[$0] } ?? 0
    }

    func selectWorkspace(_ id: String?) { window.selectWorkspace(id) }
    func restoreActiveWorkspace() { window.restoreActiveWorkspace() }
    func selectChannel(_ id: String?) { window.selectChannel(id) }
    func openThread(_ rootId: String?) { window.openThread(rootId) }
    func selectArtifact(_ id: String?) { window.selectArtifact(id) }
    func showActivityFeed() { window.showActivityFeed() }
    func artifacts(inChannel channelId: String) -> [Artifact] { window.artifacts(inChannel: channelId) }
#endif

    /// Workspaces open in any window — what the engine keeps fresh and applies
    /// workspace-scoped events for.
    var openWorkspaceIds: Set<String> {
        Set(windows.compactMap(\.selectedWorkspaceId))
    }

    /// Channels selected in any window (whether or not covered by Activity or
    /// an artifact — the conversation is still mounted behind those).
    var openChannelIds: Set<String> {
        Set(windows.compactMap(\.selectedChannelId))
    }

    /// Threads open in any window.
    var openThreadRootIds: Set<String> {
        Set(windows.compactMap(\.openThreadRootId))
    }

    func isWorkspaceOpen(_ id: String) -> Bool {
        openWorkspaceIds.contains(id)
    }

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
        if case .signedIn = p { signedOutReason = nil }
        if case .signedOut = p {
            windows.forEach { $0.clearForSignOut() }
            artifactsByWorkspace = [:]
        }
    }

    /// The server rejected our token mid-session. Same teardown as a
    /// deliberate sign-out, but the sign-in screen says why — otherwise being
    /// bounced out mid-sentence looks like the app losing its mind.
    func sessionExpired() {
        didSignOut()
        signedOutReason = "Your session expired. Sign in again to continue."
    }

    func didSignOut() {
        phase = .signedOut
        windows.forEach { $0.clearForSignOut() }
        artifactsByWorkspace = [:]
        presence = [:]
        typing = [:]
        busyChannelIds = []
        hasMore = [:]
        notificationUnreadByWorkspace = [:]
        notificationUnreadTotal = 0
        Banners.setBadge(0)
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

    /// A channel's activity spinner turned on or off (#137). Purely in-memory,
    /// like presence: the server expires these and clears them when the agent
    /// that set one disconnects, so there is nothing worth persisting.
    func channelIndicatorReceived(channelId: String, busy: Bool) {
        if busy {
            busyChannelIds.insert(channelId)
        } else {
            busyChannelIds.remove(channelId)
        }
    }

    /// Replace the whole set from a channel-list fetch — the server's snapshot
    /// is authoritative, and a refresh is how a client that missed events
    /// (asleep, reconnecting) gets back in step.
    func setBusyChannelIds(_ ids: Set<String>) {
        busyChannelIds = ids
    }

    func setAvatarPaths(_ paths: [String: String]) {
        avatarPaths = paths
    }

    func setAgentIds(_ ids: Set<String>) {
        agentIds = ids
    }

    func setArtifacts(_ list: [Artifact], workspaceId: String) {
        artifactsByWorkspace[workspaceId] = list
    }

    /// A workspace's visible artifacts (newest first); empty when none loaded.
    func artifacts(workspaceId: String?) -> [Artifact] {
        workspaceId.flatMap { artifactsByWorkspace[$0] } ?? []
    }

    /// Open artifact was removed (here or on another device): any window
    /// showing it closes the panel back to the channel behind it.
    func artifactBecameUnavailable(_ artifactId: String) {
        windows.forEach { $0.artifactBecameUnavailable(artifactId) }
    }

    /// Auto-open an agent-created artifact in whichever window is viewing its
    /// channel (see `WindowState.maybeAutoOpenArtifact` for the gating).
    func maybeAutoOpenArtifact(_ a: Artifact) {
        windows.forEach { $0.maybeAutoOpenArtifact(a) }
    }

    /// One workspace's Activity-badge count.
    func notificationUnread(workspaceId: String?) -> Int {
        workspaceId.flatMap { notificationUnreadByWorkspace[$0] } ?? 0
    }

    /// `total` nil = the server didn't send one (pre-scoping build): fall back
    /// to the scoped number so the dock badge still shows something sane.
    func setNotificationUnread(_ n: Int, workspaceId: String?, total: Int? = nil) {
        if let workspaceId { notificationUnreadByWorkspace[workspaceId] = n }
        notificationUnreadTotal = total ?? n
        Banners.setBadge(notificationUnreadTotal)
    }

    /// A row counts on the dock always, and in the sidebar badge of whichever
    /// windows show its workspace — their Activity feeds will show the row.
    func notificationReceived(_ n: NotificationItem) {
        setNotificationUnread(
            notificationUnread(workspaceId: n.workspaceId) + 1,
            workspaceId: n.workspaceId,
            total: notificationUnreadTotal + 1
        )
    }

    /// Is the user actually looking at this channel *right now*, in any
    /// window? A selected channel in a backgrounded app is NOT being looked
    /// at — the app keeps its selection while you work elsewhere, so treating
    /// "selected" as "read" silently swallows DMs that arrive while the app
    /// sits behind a browser (the web client's equivalent test is
    /// `document.hidden`).
    func isViewing(channelId: String) -> Bool {
        isAppActive && windows.contains {
            $0.selectedChannelId == channelId && !$0.showActivity
        }
    }

    /// The banner/read gate for an incoming notification: is its message on
    /// screen somewhere? For a top-level message that's `isViewing`; for a
    /// thread reply the thread must also be open *in a window that is viewing
    /// the channel* — a reply behind a closed thread is not "seen".
    func isViewingMessage(channelId: String, threadRootId: String?) -> Bool {
        guard isAppActive else { return false }
        return windows.contains { w in
            guard w.selectedChannelId == channelId, !w.showActivity else { return false }
            guard let threadRootId else { return true }
            return w.openThreadRootId == threadRootId
        }
    }

    /// Frontmost-and-visible, driven by SwiftUI's `scenePhase` in both app
    /// entry points. Starts true so a launch before the first phase callback
    /// behaves as it always did.
    func setAppActive(_ active: Bool) {
        guard isAppActive != active else { return }
        isAppActive = active
        // Coming back to channels that collected mail while we were away is
        // the moment to read them — the arrival path deliberately didn't.
        if active {
            for channelId in openChannelIds {
                Task { await engine.catchUpRead(channelId: channelId) }
            }
        }
    }

    /// A channel was archived or left — every window showing it drops the
    /// selection (each checks its own).
    func channelBecameUnavailable(_ channelId: String) {
        windows.forEach { $0.channelBecameUnavailable(channelId) }
    }

    /// A tapped OS banner routes to the key window (see `AppDelegate`) — the
    /// window the user last worked in is where the jump should happen.
    func openNotification(workspaceId: String, channelId: String, messageId: String, threadRootId: String?) {
        routingWindow?.openNotification(
            workspaceId: workspaceId, channelId: channelId,
            messageId: messageId, threadRootId: threadRootId
        )
    }

    /// Who's typing in one composer. `threadRootId` nil = the channel's main
    /// composer, so a thread's typists never surface in the channel view.
    func typingUserIds(channelId: String, threadRootId: String? = nil) -> [String] {
        (typing[TypingKey.make(channelId: channelId, threadRootId: threadRootId)] ?? [:])
            .filter { Date().timeIntervalSince($0.value) < 5 }
            .map(\.key)
            .sorted()
    }

    // MARK: - App-level actions

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
                routingWindow?.selectWorkspace(ws.id)
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

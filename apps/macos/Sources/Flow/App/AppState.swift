import AVFoundation
import Combine
import Foundation
import LiveKit
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

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
        rowId: String, selectedChannelId: String?, selectedArtifactId: String?, showActivity: Bool,
        showScheduled: Bool = false, showDirectory: Bool = false
    ) -> Bool {
        selectedChannelId == rowId && selectedArtifactId == nil && !showActivity && !showScheduled
            && !showDirectory
    }

    /// Scroll identity for a sidebar channel/DM row (#319), so the sidebar can
    /// scroll the active channel into view when you arrive from a notification,
    /// a deep link or being added to a channel. Namespaced rather than the bare
    /// channel id: the same id already identifies the `ForEach` element that
    /// wraps the row *and its artifacts*, and scrolling should target the row.
    nonisolated static func sidebarRowID(_ channelId: String) -> String {
        "sidebar-row-\(channelId)"
    }

    /// Visible artifacts per workspace (phase 13) — those in channels I'm a
    /// member of, newest first. Keyed by workspace because two windows can
    /// show two workspaces at once; each window reads its own slice.
    @Published private(set) var artifactsByWorkspace: [String: [Artifact]] = [:]
    /// Mini apps per workspace (#394) — every app the server lets this user see,
    /// including ones in public channels they have not joined. A separate map
    /// from `artifactsByWorkspace` on purpose: that list is "artifacts in my
    /// channels" and drives the nested sidebar rows, this one is workspace-wide
    /// discovery and drives the Apps section. Server-ordered by app name.
    @Published private(set) var appArtifactsByWorkspace: [String: [Artifact]] = [:]
    @Published private(set) var connection: Connection = .connecting
    /// How many catch-up passes are in flight (#234). A *count*, not a flag:
    /// a second reconnect can start while the first backfill is still paging,
    /// and a Bool would let the first one to finish declare the app caught up.
    @Published private(set) var catchUpCount: Int = 0
    /// workspaceId -> (userId -> online?). Presence is per (user, workspace)
    /// since #364: one socket carries every workspace we belong to, so a flat
    /// userId map lit an agent's dot in workspaces its bridge wasn't serving.
    /// Read it through `isOnline(_:in:)`, never directly.
    @Published private(set) var presenceByWorkspace: [String: [String: Bool]] = [:]
    /// channelId -> (userId -> last typing event time)
    @Published private(set) var typing: [String: [String: Date]] = [:]
    /// Channels an agent is working in right now (#137) — the sidebar spinner.
    @Published private(set) var busyChannelIds: Set<String> = []
    /// channelId -> live voice-huddle roster (Phase 1). Purely in-memory, like
    /// busyChannelIds: LiveKit is the source of truth (decision log
    /// 2026-08-20), not this cache, so nothing here is worth persisting.
    @Published private(set) var huddleRosters: [String: [HuddleParticipant]] = [:]
    /// Channel id of the huddle this app is connected to, or nil. App-level
    /// (not per-window) so the connection survives navigating between
    /// channels — see CONTEXT.md (Huddle).
    @Published private(set) var activeHuddleChannelId: String?
    @Published private(set) var activeHuddleWorkspaceId: String?
    @Published private(set) var huddleConnecting: Bool = false
    /// Muted on join, by decision — the mic is never auto-published.
    @Published private(set) var huddleMuted: Bool = true
    /// Set when an unmute attempt finds the OS mic permission isn't granted
    /// (never asked, or previously denied — `ensureDeviceAccess` doesn't say
    /// which). Drives a dedicated alert with an "Open Settings" action;
    /// separate from `errorMessage` because that one's alert is a plain "OK"
    /// everywhere else it's used.
    @Published var micPermissionBlocked = false
    /// Same story for the camera (#435) and, on macOS, for Screen Recording:
    /// each is a separate OS grant with its own Settings pane, and each has to
    /// degrade to an explanation rather than a button that silently does nothing.
    @Published var cameraPermissionBlocked = false
    @Published var screenPermissionBlocked = false
    /// Camera and screen share both start off, always — each is turned on
    /// deliberately (#435).
    @Published private(set) var huddleCameraOn: Bool = false
    @Published private(set) var huddleSharing: Bool = false
    /// What the video grid draws. While everyone is audio-only this holds only
    /// avatar tiles and the grid stays unmounted — the thin bar is the whole UI.
    @Published private(set) var huddleTiles: [HuddleTile] = []
    /// Tap-to-focus: the tile blown up, or nil for the even grid.
    @Published var huddleFocusedUserId: String?
    /// Transient one-liner over the huddle UI ("Ada started sharing").
    @Published private(set) var huddleNotice: String?
    /// Set when backgrounding turned the camera off, so returning turns it
    /// back on — and says so (#435).
    private var cameraSuspendedByBackground = false
    /// A ring aimed at us (#436) — drives the incoming-call overlay.
    @Published private(set) var incomingHuddleInvite: HuddleInvite?
    /// Our own outgoing ring while we wait for an answer.
    @Published private(set) var outgoingHuddleInvite: HuddleInvite?
    /// Names we could not reach — the "X isn't available" line.
    @Published private(set) var huddleUnavailable: [String] = []
    /// Another of our devices answered; this one says so rather than blinking out.
    @Published var huddleAnsweredElsewhere: Bool = false
    /// This connection's WS session id, from the `hello` frame. It identifies
    /// the *device*, which is how a ring answered here is told apart from the
    /// same ring answered on a phone.
    private(set) var wsSessionId: String?
    private var huddleRoom: Room?
    private var noticeTask: Task<Void, Never>?
    /// channelId -> more history available on the server
    @Published private(set) var hasMore: [String: Bool] = [:]
    /// Channels whose history page is in flight (#191). A transcript with
    /// nothing cached yet is indistinguishable from a lost conversation, so the
    /// clients render a loading state instead of bare background while this
    /// holds the channel.
    @Published private(set) var loadingHistory: Set<String> = []
    /// Unread notifications per workspace — each window's sidebar Activity
    /// badge reads its own workspace's count.
    @Published private(set) var notificationUnreadByWorkspace: [String: Int] = [:]
    /// Unread across every workspace — the dock badge, which has to keep
    /// speaking for the workspaces you aren't looking at.
    @Published private(set) var notificationUnreadTotal: Int = 0
    /// Bumped when notification-backed content is removed. ActivityFeedView
    /// includes it in its fetch key so already-read rows disappear immediately.
    @Published private(set) var notificationRevision: Int = 0
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
    var showScheduled: Bool {
        get { window.showScheduled }
        set { window.showScheduled = newValue }
    }
    var showDirectory: Bool {
        get { window.showDirectory }
        set { window.showDirectory = newValue }
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
    func openChannelFromSidebar(_ channel: Channel) { window.openChannelFromSidebar(channel) }
    func openThread(_ rootId: String?) { window.openThread(rootId) }
    func selectArtifact(_ id: String?) { window.selectArtifact(id) }
    func showActivityFeed() { window.showActivityFeed() }
    func showScheduledPanel() { window.showScheduledPanel() }
    func showDirectoryPanel() { window.showDirectoryPanel() }
    func jumpToMessage(channelId: String, messageId: String) {
        window.jumpToMessage(channelId: channelId, messageId: messageId)
    }
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
            appArtifactsByWorkspace = [:]
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
        appArtifactsByWorkspace = [:]
        presenceByWorkspace = [:]
        typing = [:]
        busyChannelIds = []
        huddleRosters = [:]
        leaveHuddle() // don't leave a signed-out session's token connected
        hasMore = [:]
        loadingHistory = []
        notificationUnreadByWorkspace = [:]
        notificationUnreadTotal = 0
        catchUpCount = 0
        Banners.setBadge(0)
    }

    func setConnection(_ c: Connection) {
        connection = c
    }

    /// Bracket a catch-up pass (the post-connect backfill). Paired calls only —
    /// see `catchUpCount`.
    func beginCatchUp() {
        catchUpCount += 1
    }

    func endCatchUp() {
        catchUpCount = max(0, catchUpCount - 1)
    }

    /// Is the chat behind the server right now (#234) — the reconnect bar's
    /// input, before any show/hide timing is applied.
    ///
    /// Connected-but-catching-up counts: `SyncEngine` reports `.connected` the
    /// moment the socket says hello, then spends real time refetching channels
    /// and paging messages. A bar tied to the socket alone disappears while the
    /// transcript on screen is still stale, which is exactly the launch delay
    /// this was filed about.
    ///
    /// Static and pure so the rule is one testable thing rather than a
    /// condition retyped in the macOS and iOS views.
    nonisolated static func isSyncing(connection: Connection, catchUpCount: Int) -> Bool {
        connection != .connected || catchUpCount > 0
    }

    var isSyncing: Bool {
        Self.isSyncing(connection: connection, catchUpCount: catchUpCount)
    }

    func showError(_ message: String) {
        errorMessage = message
    }

    func setHasMore(channelId: String, _ value: Bool) {
        hasMore[channelId] = value
    }

    func setLoadingHistory(channelId: String, _ value: Bool) {
        if value {
            loadingHistory.insert(channelId)
        } else {
            loadingHistory.remove(channelId)
        }
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

    func presenceReceived(workspaceId: String, userId: String, online: Bool) {
        presenceByWorkspace[workspaceId, default: [:]][userId] = online
    }

    /// Is this user online *in this workspace*? A connection to another
    /// workspace doesn't count (#364) — that was the whole bug.
    func isOnline(_ userId: String, in workspaceId: String?) -> Bool {
        guard let workspaceId else { return false }
        return presenceByWorkspace[workspaceId]?[userId] == true
    }

    /// Drop every presence entry — used on reconnect, where the server sends a
    /// fresh snapshot and nobody sends `offline` for someone who left while we
    /// were down.
    func presenceReset() {
        presenceByWorkspace = [:]
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

    /// A channel's live huddle roster after a change (Phase 1) — the server's
    /// aggregate, not one joiner/leaver. Empty means the huddle ended.
    func huddleUpdated(channelId: String, participants: [HuddleParticipant]) {
        if participants.isEmpty {
            huddleRosters.removeValue(forKey: channelId)
        } else {
            huddleRosters[channelId] = participants
        }
    }

    /// Replace the whole map from a channel-list fetch, same reasoning as
    /// setBusyChannelIds.
    func setHuddleRosters(_ rosters: [String: [HuddleParticipant]]) {
        huddleRosters = rosters
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

    func setAppArtifacts(_ list: [Artifact], workspaceId: String) {
        appArtifactsByWorkspace[workspaceId] = list
    }

    /// A workspace's visible mini apps (#394), in server order; empty when none
    /// loaded or the server predates the endpoint.
    func appArtifacts(workspaceId: String?) -> [Artifact] {
        workspaceId.flatMap { appArtifactsByWorkspace[$0] } ?? []
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

    /// Opening a channel reads its Activity rows — count them off the badges
    /// now rather than after the server's `notification.read` comes back
    /// (#227). Clamped at zero: this is a guess from the local cache, and the
    /// event that follows replaces both numbers with the server's.
    func notificationsCleared(count: Int, workspaceId: String?) {
        guard count > 0 else { return }
        setNotificationUnread(
            max(0, notificationUnread(workspaceId: workspaceId) - count),
            workspaceId: workspaceId,
            total: max(0, notificationUnreadTotal - count)
        )
    }

    func messagePermanentlyDeleted(_ message: Message) {
        notificationRowsChanged()
        if message.threadRootId == nil {
            windows
                .filter { $0.openThreadRootId == message.id }
                .forEach { $0.openThread(nil) }
        }
    }

    func notificationRowsChanged() {
        notificationRevision += 1
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
        // Backgrounding turns the camera off and the huddle keeps running on
        // audio (#435). Not a cosmetic choice: a suspended app cannot hold a
        // capture session open, so the alternative to turning it off is a
        // frozen frame of whatever the camera last saw, published to everyone.
        // Coming back turns it on again — and says so, since the gap was ours,
        // not theirs.
        if !active, huddleCameraOn {
            cameraSuspendedByBackground = true
            setHuddleCamera(false)
            return
        }
        if active, cameraSuspendedByBackground {
            cameraSuspendedByBackground = false
            setHuddleCamera(true)
            flashHuddleNotice("Your camera turned off while Flow was in the background")
        }
        guard active else { return }
        // Coming back to channels that collected mail while we were away is
        // the moment to read them — the arrival path deliberately didn't.
        for channelId in openChannelIds {
            Task { await engine.catchUpRead(channelId: channelId) }
        }
        // A suspended app's socket is regularly dead with no error on either
        // side, so returning to the front also has to re-check the connection.
        // That is `SyncEngine.observeWake` (#271), on the foreground/wake
        // notification rather than here: it checks liveness first, so a flick
        // to another app and straight back costs nothing.
    }

    /// A channel was archived or left — every window showing it drops the
    /// selection (each checks its own).
    func channelBecameUnavailable(_ channelId: String) {
        windows.forEach { $0.channelBecameUnavailable(channelId) }
    }

    /// A workspace we left (#340) — every window showing it moves to `landOn`,
    /// or to the chooser when that was the last one. Its Activity badge goes
    /// with it: the count belongs to a workspace we can no longer read.
    func workspaceBecameUnavailable(_ workspaceId: String, landOn: String?) {
        notificationUnreadByWorkspace.removeValue(forKey: workspaceId)
        windows.forEach { $0.workspaceBecameUnavailable(workspaceId, landOn: landOn) }
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

    // MARK: - Huddle

    /// Publish settings, all four #435 acceptance criteria in one object:
    /// camera capped at 360p and screen share at 720p/15fps to protect
    /// LiveKit free-tier bandwidth; `adaptiveStream` so a tile nobody can see
    /// stops being sent at all; `dynacast` so simulcast layers nobody
    /// subscribes to stop being encoded. The cap is on *capture* as well as
    /// encoding — a 1080p webcam downscaled at the encoder still costs the
    /// whole capture pipeline.
    private var huddleRoomOptions: RoomOptions {
        RoomOptions(
            defaultCameraCaptureOptions: CameraCaptureOptions(dimensions: .h360_169, fps: 24),
            defaultScreenShareCaptureOptions: ScreenShareCaptureOptions(dimensions: .h720_169, fps: 15),
            defaultVideoPublishOptions: VideoPublishOptions(
                encoding: VideoParameters.presetH360_169.encoding,
                screenShareEncoding: VideoParameters.presetScreenShareH720FPS15.encoding,
                // Two layers, both at or under the cap — the point of the cap
                // is that there is no 720p layer to fall back *up* to.
                simulcastLayers: [.presetH180_169, .presetH360_169]
            ),
            adaptiveStream: true,
            dynacast: true
        )
    }

    /// Join an entity's huddle: mints a token via the server, then connects
    /// LiveKit's `Room`. In a channel "join" doubles as start and nobody is
    /// rung; in a DM the same call *is* the call, and the server rings the
    /// other member(s) (#436). Idempotent — calling this while already in this
    /// entity's huddle is a no-op.
    func joinHuddle(channelId: String, workspaceId: String) {
        guard activeHuddleChannelId != channelId else { return }
        Task { await joinHuddleAsync(channelId: channelId, workspaceId: workspaceId, accepting: nil) }
    }

    /// The shared body of joining and of answering a ring — accepting a call
    /// *is* joining, and the only difference is which endpoint mints the token.
    private func joinHuddleAsync(channelId: String, workspaceId: String, accepting inviteId: String?) async {
        if activeHuddleChannelId != nil { await leaveHuddleAsync() }
        huddleConnecting = true
        defer { huddleConnecting = false }
        do {
            let resp: HuddleJoinResponse
            if let inviteId {
                resp = try await engine.acceptHuddleInvite(inviteId: inviteId, sessionId: wsSessionId)
            } else {
                resp = try await engine.joinHuddle(channelId: channelId)
            }
            let room = Room(delegate: self, roomOptions: huddleRoomOptions)
            do {
                try await room.connect(url: resp.url, token: resp.token)
            } catch {
                // The REST join already landed server-side (it publishes
                // on roster change), but the RTC connection never came
                // up — without this, the roster would show a participant
                // who was never actually live. Roll it back.
                await engine.leaveHuddle(channelId: channelId)
                throw error
            }
            huddleRoom = room
            activeHuddleChannelId = channelId
            activeHuddleWorkspaceId = workspaceId
            huddleMuted = true
            huddleCameraOn = false
            huddleSharing = false
            huddleFocusedUserId = nil
            // In a DM the join is the call: hold the ring so the bar can say
            // "Ringing…", or name who could not be reached.
            outgoingHuddleInvite = resp.invite?.status == .ringing ? resp.invite : nil
            huddleUnavailable = resp.unavailable ?? []
            syncHuddleTiles()
        } catch {
            errorMessage = "Couldn't join the huddle: \(error.localizedDescription)"
        }
    }

    func leaveHuddle() {
        Task { await leaveHuddleAsync() }
    }

    private func leaveHuddleAsync() async {
        guard let channelId = activeHuddleChannelId else { return }
        let room = huddleRoom
        huddleRoom = nil
        activeHuddleChannelId = nil
        activeHuddleWorkspaceId = nil
        huddleMuted = true
        huddleCameraOn = false
        huddleSharing = false
        huddleTiles = []
        huddleFocusedUserId = nil
        outgoingHuddleInvite = nil
        huddleUnavailable = []
        cameraSuspendedByBackground = false
        await room?.disconnect()
        await engine.leaveHuddle(channelId: channelId)
    }

    /// Rebuild the tile list from the Room's own state — one place, so every
    /// track/mute/speaker callback converges on the same shape rather than each
    /// patching a slice of it.
    private func syncHuddleTiles() {
        guard let room = huddleRoom else {
            huddleTiles = []
            return
        }
        func tile(_ p: Participant, isLocal: Bool) -> HuddleTile {
            HuddleTile(
                userId: p.identity?.stringValue ?? "",
                isLocal: isLocal,
                camera: p.firstCameraVideoTrack,
                screen: p.firstScreenShareVideoTrack,
                micOn: p.isMicrophoneEnabled(),
                speaking: p.isSpeaking
            )
        }
        huddleTiles = [tile(room.localParticipant, isLocal: true)]
            + room.remoteParticipants.values.map { tile($0, isLocal: false) }
        huddleCameraOn = room.localParticipant.isCameraEnabled()
        huddleSharing = room.localParticipant.isScreenShareEnabled()
    }

    /// Whoever is currently sharing a screen — at most one (see below).
    var huddleScreenSharerId: String? { huddleTiles.first { $0.screen != nil }?.userId }
    /// True once anyone turns on a camera or a share: the bar becomes a grid.
    var huddleHasVideo: Bool { huddleTiles.contains { $0.camera != nil || $0.screen != nil } }

    private func flashHuddleNotice(_ text: String) {
        huddleNotice = text
        noticeTask?.cancel()
        noticeTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4 * NSEC_PER_SEC)
            guard !Task.isCancelled else { return }
            self?.huddleNotice = nil
        }
    }

    /// Turn the camera on or off. Like the mic, the OS grant is asked for
    /// explicitly first: LiveKit's SDK never prompts on its own, so without
    /// this the capture just fails with a generic error and Flow never even
    /// appears in the Camera privacy list.
    func toggleHuddleCamera() {
        // A deliberate camera-off is not the background one: forget any pending
        // resume, so coming back to the app doesn't undo what the user just did.
        cameraSuspendedByBackground = false
        setHuddleCamera(!huddleCameraOn)
    }

    private func setHuddleCamera(_ on: Bool) {
        guard let room = huddleRoom, huddleCameraOn != on else { return }
        Task {
            if on, !(await LiveKitSDK.ensureDeviceAccess(for: [.video])) {
                cameraPermissionBlocked = true
                return
            }
            do {
                try await room.localParticipant.setCamera(enabled: on)
                huddleCameraOn = on
                syncHuddleTiles()
            } catch {
                errorMessage = "Couldn't turn on the camera: \(error.localizedDescription)"
            }
        }
    }

    /// Start or stop sharing. On macOS `source` names the window or display the
    /// picker chose; iOS ignores it and shares Flow's own content, which is all
    /// a plain app can capture without a Broadcast Upload Extension (#435, and
    /// the extension is explicitly deferred).
    func toggleHuddleScreenShare(source: Any? = nil) {
        guard let room = huddleRoom else { return }
        let next = !huddleSharing
        Task {
            do {
                #if os(macOS)
                if next, let captureSource = source as? MacOSScreenCaptureSource {
                    let track = LocalVideoTrack.createMacOSScreenShareTrack(
                        source: captureSource,
                        options: ScreenShareCaptureOptions(dimensions: .h720_169, fps: 15)
                    )
                    try await room.localParticipant.publish(videoTrack: track)
                } else {
                    try await room.localParticipant.setScreenShare(enabled: next)
                }
                #else
                try await room.localParticipant.setScreenShare(enabled: next)
                #endif
                huddleSharing = next
                syncHuddleTiles()
            } catch {
                // macOS: the overwhelmingly common failure is Screen Recording
                // not being granted, and that one needs Settings rather than an
                // apology — ScreenCaptureKit reports it as a plain capture error,
                // so the guidance has to cover the whole failure.
                #if os(macOS)
                screenPermissionBlocked = true
                #else
                errorMessage = "Couldn't share the screen: \(error.localizedDescription)"
                #endif
            }
        }
    }

    /// The window/display list for the macOS share picker. Empty is itself the
    /// signal that Screen Recording was refused — ScreenCaptureKit returns no
    /// sources rather than an error when the app has no permission.
    #if os(macOS)
    func screenShareSources() async -> [MacOSScreenCaptureSource] {
        (try? await MacOSScreenCapturer.sources(for: .any)) ?? []
    }
    #endif

    /// "Open Settings" for the camera / screen-recording alerts. Same shape as
    /// `openMicrophoneSettings`.
    func openCameraSettings() {
        #if os(macOS)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera") {
            NSWorkspace.shared.open(url)
        }
        #else
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
        #endif
    }

    #if os(macOS)
    func openScreenRecordingSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }
    #endif

    // MARK: - Huddle invites (#436)

    /// The `hello` frame's session id — set by SyncEngine on every connect.
    func setSessionId(_ sessionId: String?) {
        wsSessionId = sessionId
    }

    /// Fold a `huddle.invite` event into ring state. The decision itself lives
    /// in `ringEffect` (Support/HuddleRing.swift) so it can be unit-tested and
    /// so macOS, iOS and web all read one rule.
    func huddleInviteEvent(_ data: HuddleInviteData) {
        guard let selfId = currentUser?.id else { return }
        switch ringEffect(
            data.invite,
            selfId: selfId,
            mySessionId: wsSessionId,
            answeredBySessionId: data.answeredBySessionId,
            unavailable: data.unavailable
        ) {
        case .ring(let invite):
            incomingHuddleInvite = invite
        case .answeredElsewhere:
            if incomingHuddleInvite?.id == data.invite.id { incomingHuddleInvite = nil }
            huddleAnsweredElsewhere = true
        case .dismiss:
            if incomingHuddleInvite?.id == data.invite.id { incomingHuddleInvite = nil }
        case .outgoing(let invite, let unavailable):
            outgoingHuddleInvite = invite
            if !unavailable.isEmpty { huddleUnavailable = unavailable }
        case .ignore:
            break
        }
    }

    func acceptHuddleInvite() {
        guard let invite = incomingHuddleInvite else { return }
        incomingHuddleInvite = nil
        Task {
            await joinHuddleAsync(
                channelId: invite.channelId,
                workspaceId: invite.workspaceId,
                accepting: invite.id
            )
        }
    }

    func declineHuddleInvite() {
        guard let invite = incomingHuddleInvite else { return }
        incomingHuddleInvite = nil
        Task { await engine.declineHuddleInvite(inviteId: invite.id, sessionId: wsSessionId) }
    }

    /// Give up on a ring nobody has answered. Leaving the room ends it
    /// server-side anyway (the roster empties); this is the explicit button.
    func cancelHuddleRing() {
        let invite = outgoingHuddleInvite
        outgoingHuddleInvite = nil
        Task {
            await leaveHuddleAsync()
            if let invite { await engine.cancelHuddleInvite(inviteId: invite.id) }
        }
    }

    func toggleHuddleMute() {
        guard let room = huddleRoom else { return }
        let next = !huddleMuted
        Task {
            // Unmuting is the only transition that opens the mic. LiveKit's
            // SDK never requests OS permission itself (it only exposes this
            // helper — grepped the vendored source to confirm) — until an app
            // calls it, macOS/iOS never show the consent prompt AND never
            // list Flow in the Microphone privacy settings at all, so the
            // capture just fails with a generic "permission not granted"
            // every time. Ask first so that either registers Flow properly
            // (first run) or comes back false immediately, no dead SDK error.
            if !next, !(await LiveKitSDK.ensureDeviceAccess(for: [.audio])) {
                micPermissionBlocked = true
                return
            }
            do {
                try await room.localParticipant.setMicrophone(enabled: !next)
                huddleMuted = next
            } catch {
                // Mic permission denied or capture failed — leave the UI
                // reflecting reality (still muted) rather than claiming live
                // audio that was never actually published.
                errorMessage = "Couldn't turn on the microphone: \(error.localizedDescription)"
            }
        }
    }

    /// "Open Settings" action for the mic-permission alert. Deep-links to the
    /// exact pane on macOS; iOS has no per-permission deep link, so it opens
    /// Flow's own Settings page, which lists Microphone among its toggles —
    /// the standard iOS pattern (same one users see in Slack/Zoom).
    func openMicrophoneSettings() {
        #if os(macOS)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
            NSWorkspace.shared.open(url)
        }
        #else
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
        #endif
    }
}

/// One person in the huddle, as the grid draws them (#435). Built from the
/// LiveKit `Room` on every track/mute/speaker callback — see
/// `AppState.syncHuddleTiles`.
struct HuddleTile: Identifiable, Equatable {
    let userId: String
    let isLocal: Bool
    let camera: VideoTrack?
    let screen: VideoTrack?
    let micOn: Bool
    let speaking: Bool

    var id: String { userId }

    static func == (a: HuddleTile, b: HuddleTile) -> Bool {
        a.userId == b.userId && a.isLocal == b.isLocal && a.micOn == b.micOn && a.speaking == b.speaking
            && a.camera?.sid == b.camera?.sid && a.screen?.sid == b.screen?.sid
    }
}

extension AppState: RoomDelegate {
    /// LiveKit's own disconnect signal — not guaranteed to arrive on the main
    /// thread, hence the hop. Covers both a real network drop and a second
    /// device/tab taking over our identity (decision log 2026-08-20:
    /// bare-userId identity, one live presence per person) — both look the
    /// same from here, and both should clear local huddle state.
    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor [weak self] in
            guard let self, self.huddleRoom === room else { return }
            self.huddleRoom = nil
            self.activeHuddleChannelId = nil
            self.activeHuddleWorkspaceId = nil
            self.huddleMuted = true
            self.huddleCameraOn = false
            self.huddleSharing = false
            self.huddleTiles = []
            self.outgoingHuddleInvite = nil
        }
    }

    // Every media change funnels into one rebuild (see syncHuddleTiles): a
    // callback per event, each doing the same whole-state refresh, is far
    // easier to keep correct than half a dozen partial patches.
    nonisolated func room(_ room: Room, participantDidConnect _: RemoteParticipant) { refreshTiles(room) }
    nonisolated func room(_ room: Room, participantDidDisconnect _: RemoteParticipant) { refreshTiles(room) }
    nonisolated func room(_ room: Room, didUpdateSpeakingParticipants _: [Participant]) { refreshTiles(room) }
    nonisolated func room(_ room: Room, participant _: Participant, trackPublication _: TrackPublication, didUpdateIsMuted _: Bool) {
        refreshTiles(room)
    }
    nonisolated func room(_ room: Room, participant _: LocalParticipant, didPublishTrack _: LocalTrackPublication) {
        refreshTiles(room)
    }
    nonisolated func room(_ room: Room, participant _: LocalParticipant, didUnpublishTrack _: LocalTrackPublication) {
        refreshTiles(room)
    }
    nonisolated func room(_ room: Room, participant _: RemoteParticipant, didUnsubscribeTrack _: RemoteTrackPublication) {
        refreshTiles(room)
    }

    /// A remote track arrived. Screen shares get two extra behaviours here:
    /// the grid focuses them, and — since only one share may be live at a time
    /// (#435) — the newest one wins, so ours stops.
    nonisolated func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        let isShare = publication.source == .screenShareVideo
        let sharer = participant.identity?.stringValue
        let name = participant.name
        Task { @MainActor [weak self] in
            guard let self, self.huddleRoom === room else { return }
            if isShare {
                self.flashHuddleNotice("\(name?.isEmpty == false ? name! : "Someone") started sharing")
                self.huddleFocusedUserId = sharer
                if room.localParticipant.isScreenShareEnabled() {
                    try? await room.localParticipant.setScreenShare(enabled: false)
                }
            }
            self.syncHuddleTiles()
        }
    }

    nonisolated private func refreshTiles(_ room: Room) {
        Task { @MainActor [weak self] in
            guard let self, self.huddleRoom === room else { return }
            self.syncHuddleTiles()
        }
    }
}

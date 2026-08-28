import Foundation
import SwiftUI

/// Per-window UI selection: which workspace, channel, thread, artifact and
/// feed *this* window is showing. Each window owns one (created by
/// `RootView`), so two windows navigate independently — the app-wide state
/// (auth, sync engine, presence, caches) stays in the shared `AppState`,
/// which keeps a registry of these for the aggregate questions ("is anyone
/// viewing this channel?").
@MainActor
final class WindowState: ObservableObject {
    @Published var selectedWorkspaceId: String?
    @Published var selectedChannelId: String?
    @Published var openThreadRootId: String?
    /// Open artifact (phase 13) — when set, the right-hand side panel shows the
    /// artifact next to its channel (mutually exclusive with the thread panel).
    @Published var selectedArtifactId: String?
    /// Channel Files tab (#347) — another tab on the same side panel as the
    /// thread and the artifacts. True means the Files tab is the visible one.
    @Published var filesOpen: Bool = false
    /// Activity feed (phase 12) — covers the content pane; the selected channel
    /// stays put behind it so picking a channel returns to a conversation.
    @Published var showActivity: Bool = false
    /// Jump-to-message target (phase 12): a message id the channel/thread view
    /// should scroll to and flash after navigation. Cleared once reached.
    @Published var focusMessageId: String?
    /// This session's visit history over the main pane (issue #386) — what the
    /// header's back/forward buttons walk. Per-window, like the selection it
    /// records, and reset on workspace switch and sign-out.
    @Published private(set) var nav = NavHistory()

    /// channelId -> the thread that was open there (issue #89). The open thread
    /// lives in the single `openThreadRootId` slot, so switching channels would
    /// otherwise drop it; this parks it instead, and coming back restores it.
    /// In-memory and per-workspace — cleared on workspace switch/sign-out.
    private var openThreadByChannel: [String: String] = [:]

    private unowned let app: AppState
    private var engine: SyncEngine { app.engine }

    init(app: AppState) {
        self.app = app
        app.register(self)
    }

    // MARK: - Workspace

    private static let activeWorkspaceKey = "activeWorkspaceId" + Profile.suffix

    func selectWorkspace(_ id: String?) {
        selectedWorkspaceId = id
        selectedChannelId = nil
        openThreadRootId = nil
        openThreadByChannel.removeAll()
        selectedArtifactId = nil
        filesOpen = false
        showActivity = false
        nav = NavHistory() // the other workspace's channels aren't reachable from here
        // Active workspace survives relaunch (phase 3.5 fixes). Shared across
        // windows on purpose: the *last* pick is what a fresh window starts on.
        if let id {
            UserDefaults.standard.set(id, forKey: Self.activeWorkspaceKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.activeWorkspaceKey)
        }
        if let id {
            let engine = self.engine
            Task { await engine.selectWorkspace(id) }
        }
    }

    /// Restore the last active workspace when the window opens (validated by
    /// the caller against the workspace list once it loads).
    func restoreActiveWorkspace() {
        guard selectedWorkspaceId == nil,
              let saved = UserDefaults.standard.string(forKey: Self.activeWorkspaceKey)
        else { return }
        selectedWorkspaceId = saved
        let engine = self.engine
        Task { await engine.selectWorkspace(saved) }
    }

    // MARK: - Channel

    private static let lastChannelKey = "lastChannelId" + Profile.suffix

    /// The channel to reopen on the next launch, or nil if there isn't one.
    /// Written on every selection (so backgrounding needs no hook of its own)
    /// and cleared when the selection goes away — leaving, archiving, or
    /// signing out. Same storage shape as `activeWorkspaceKey` above, and
    /// shared across windows for the same reason: the *last* pick wins.
    static var lastChannelId: String? {
        get { UserDefaults.standard.string(forKey: lastChannelKey) }
        set {
            if let newValue {
                UserDefaults.standard.set(newValue, forKey: lastChannelKey)
            } else {
                UserDefaults.standard.removeObject(forKey: lastChannelKey)
            }
        }
    }

    func selectChannel(_ id: String?) {
        guard let id else {
            // Deselection only happens when the channel goes away — nothing to
            // record, and `channelBecameUnavailable` clears its history entries.
            selectedArtifactId = nil
            filesOpen = false
            showActivity = false
            if selectedChannelId != nil { switchChannel(to: nil) }
            return
        }
        // Picking a channel is a visit; back/forward replay one, so they go
        // through `show(_:)` directly and record nothing (issue #386).
        nav.record(.channel(id))
        show(.channel(id))
    }

    /// Put a view on the main pane, without recording a visit.
    private func show(_ view: NavView) {
        switch view {
        case .activity:
            selectedArtifactId = nil
            filesOpen = false
            showActivity = true
        case .channel(let id):
            // Selecting a channel always closes an open artifact panel or the
            // activity feed — even when it's the same channel that's behind them.
            selectedArtifactId = nil
            // Files are per-channel: the tab doesn't follow you to the next one.
            filesOpen = false
            showActivity = false
            guard id != selectedChannelId else { return }
            switchChannel(to: id)
        }
    }

    // MARK: - Visit history (issue #386)

    var canGoBack: Bool { nav.canGoBack }
    var canGoForward: Bool { nav.canGoForward }

    /// Return to the previously viewed channel or feed.
    func goBack() { step(-1) }
    /// Re-advance after a `goBack`.
    func goForward() { step(1) }

    private func step(_ delta: Int) {
        guard let target = nav.target(delta) else { return }
        nav.step(delta)
        show(target)
    }

    /// Park the leaving channel's open thread, select `id`, and restore whatever
    /// thread that channel had open (issue #89). The engine fetch for a restored
    /// thread rides the same task, since ordering between tasks isn't guaranteed.
    private func switchChannel(to id: String?) {
        rememberOpenThread()
        selectedChannelId = id
        Self.lastChannelId = id
        openThreadRootId = id.flatMap { openThreadByChannel[$0] }
        let restored = openThreadRootId
        // Local capture: the task must not retain the window (a closed one
        // should deallocate immediately, falling out of AppState's registry).
        let engine = self.engine
        Task {
            await engine.selectChannel(id)
            if let restored { await engine.openThread(rootId: restored) }
        }
    }

    /// Record (or, with no thread open, forget) the active channel's thread.
    private func rememberOpenThread() {
        guard let channelId = selectedChannelId else { return }
        openThreadByChannel[channelId] = openThreadRootId
    }

    /// Active channel was archived or left — drop the selection.
    /// This window was showing a workspace we just left: move it to `landOn`
    /// (the first workspace we still belong to) or to the chooser. Goes
    /// through `selectWorkspace` so the persisted "active workspace" follows —
    /// otherwise the next launch would restore the one we walked out of.
    func workspaceBecameUnavailable(_ workspaceId: String, landOn: String?) {
        guard selectedWorkspaceId == workspaceId else { return }
        selectWorkspace(landOn)
    }

    func channelBecameUnavailable(_ channelId: String) {
        openThreadByChannel.removeValue(forKey: channelId) // nothing to come back to
        nav.forget(.channel(channelId)) // and back must not walk into it either
        if Self.lastChannelId == channelId { Self.lastChannelId = nil } // don't reopen it next launch
        if selectedChannelId == channelId {
            selectedChannelId = nil
            openThreadRootId = nil
            filesOpen = false
        }
    }

    /// The stored last channel, if it is still a channel this user can open:
    /// it exists in the local cache, they're a member, and it belongs to the
    /// workspace this window is showing. Anything else returns nil, and the
    /// caller falls back to its usual landing channel.
    ///
    /// `channels` is the caller's already-observed list rather than a fresh
    /// query, so restoring costs nothing beyond a lookup.
    func restorableLastChannel(from channels: [Channel]) -> String? {
        guard selectedChannelId == nil, !showActivity,
              let saved = Self.lastChannelId,
              let channel = channels.first(where: { $0.id == saved }),
              channel.isMember, channel.archivedAt == nil,
              channel.workspaceId == selectedWorkspaceId
        else { return nil }
        return saved
    }

    // MARK: - Threads

    func openThread(_ rootId: String?) {
        if rootId != nil {
            selectedArtifactId = nil // shares the slot with the artifact panel (phase 13)
            filesOpen = false
        }
        openThreadRootId = rootId
        rememberOpenThread() // so leaving this channel and coming back restores it
        let engine = self.engine
        Task { await engine.openThread(rootId: rootId) }
    }

    /// Switch the side panel to the Thread tab (the thread stays open).
    func showThread() {
        selectedArtifactId = nil
        filesOpen = false
    }

    // MARK: - Files

    /// Open (or close) the channel Files tab (#347). It takes the panel the way
    /// an artifact tab does; the thread, if any, stays open behind it.
    func openFiles(_ open: Bool) {
        filesOpen = open
        if open {
            selectedArtifactId = nil
            showActivity = false
        }
    }

    /// Close the whole side panel — clears the thread and the active artifact.
    func closeSidePanel() {
        selectedArtifactId = nil
        filesOpen = false
        if openThreadRootId != nil {
            openThreadRootId = nil
            rememberOpenThread() // an explicit close: don't restore it later
            let engine = self.engine
            Task { await engine.openThread(rootId: nil) }
        }
    }

    // MARK: - Artifacts

    /// Open/activate an artifact tab in the side panel (phase 13). The panel is
    /// a tabbed container shared with the thread — opening an artifact does NOT
    /// close an open thread (they coexist as tabs); it just makes the artifact
    /// the visible tab and selects its channel so the conversation shows behind.
    /// nil just clears the active artifact (the thread tab, if any, stays).
    func selectArtifact(_ id: String?) {
        if let id {
            showActivity = false
            filesOpen = false
            if let a = artifacts().first(where: { $0.id == id }), a.channelId != selectedChannelId {
                // Same park-and-restore as an ordinary channel switch, or the
                // Thread tab would keep showing the *previous* channel's thread
                // over this channel's conversation (issue #89).
                nav.record(.channel(a.channelId))
                switchChannel(to: a.channelId)
            }
        }
        selectedArtifactId = id
    }

    /// Auto-open an agent-created artifact for the user viewing its channel —
    /// the person who asked the agent to make it. Gated on `ownsFile` (the
    /// content was agent-generated, not a human pin) and on the artifact's
    /// channel being this window's active one, so it only pops for someone in
    /// that conversation and a human "Pin as artifact" never steals focus.
    func maybeAutoOpenArtifact(_ a: Artifact) {
        guard a.ownsFile, a.channelId == selectedChannelId else { return }
        selectArtifact(a.id)
    }

    /// Open artifact was removed (here or on another device): close the panel
    /// back to the channel behind it.
    func artifactBecameUnavailable(_ artifactId: String) {
        if selectedArtifactId == artifactId {
            selectedArtifactId = nil
        }
    }

    /// This window's workspace's visible artifacts (newest first).
    func artifacts() -> [Artifact] {
        app.artifacts(workspaceId: selectedWorkspaceId)
    }

    /// Artifacts pinned in a given channel (for the sidebar's nested rows).
    func artifacts(inChannel channelId: String) -> [Artifact] {
        artifacts().filter { $0.channelId == channelId }
    }

    /// This window's workspace's mini apps (#394), in server order.
    func appArtifacts() -> [Artifact] {
        app.appArtifacts(workspaceId: selectedWorkspaceId)
    }

    /// Open a channel *and* an artifact tab in it in one action (#394) — what
    /// the Apps section does. `selectArtifact` can't serve here: it finds the
    /// artifact's channel by looking it up in the member-artifact list, which by
    /// definition does not hold an app from a channel this user has only just
    /// joined (or is about to).
    func openArtifact(_ artifactId: String, inChannel channelId: String) {
        showActivity = false
        filesOpen = false
        if channelId != selectedChannelId { switchChannel(to: channelId) }
        selectedArtifactId = artifactId
    }

    // MARK: - Activity

    /// Show the Activity feed (phase 12). Like opening an artifact it covers the
    /// content pane while the channel selection stays put behind it.
    func showActivityFeed() {
        nav.record(.activity)
        show(.activity)
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
    /// tapped OS banner's `userInfo` (routed here via AppState's key window).
    func openNotification(workspaceId: String, channelId: String, messageId: String, threadRootId: String?) {
        if selectedWorkspaceId != workspaceId {
            selectWorkspace(workspaceId)
        }
        selectChannel(channelId)
        // Unconditional: an explicit jump decides what's open in the target
        // channel, so a top-level target closes any thread parked there rather
        // than letting it hide the message we're jumping to (issue #89).
        openThread(threadRootId)
        focusMessageId = messageId
    }

    // MARK: - Sign-out

    func clearForSignOut() {
        // The next person to sign in on this device gets their own landing
        // channel, not the last one this account was reading.
        Self.lastChannelId = nil
        selectedWorkspaceId = nil
        selectedChannelId = nil
        openThreadRootId = nil
        openThreadByChannel.removeAll()
        selectedArtifactId = nil
        filesOpen = false
        showActivity = false
        focusMessageId = nil
        nav = NavHistory()
    }
}

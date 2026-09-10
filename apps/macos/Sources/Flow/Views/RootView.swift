import AppKit
import SwiftUI

struct RootView: View {
    let initial: AppState
    @State private var selected: AppState?
    @State private var showConnections = false
    @State private var incomingAddress = ""
    @State private var workspace: String?
    @State private var notificationTarget: NavigationTarget?
    /// This window's identity, so the manager can tell which connection each
    /// window is showing — and which one a window stopped showing (#542).
    @State private var windowId = UUID()
    init(app: AppState) { initial = app }
    private var active: AppState { selected ?? initial }

    /// Tell the manager this window is now showing `app`'s connection.
    private func showing(_ app: AppState) {
        app.connections.noteShowing(app.connectionId, window: windowId)
    }
    var body: some View {
        SessionRootView(app: active, workspaceId: workspace, notification: notificationTarget)
            .environmentObject(active)
            .id("\(active.connectionId):\(workspace ?? ""):\(notificationTarget?.messageId ?? "")")
            // Every connected server syncs while the app runs, not just the one
            // this window shows (#542). Bounded and idempotent, so a second
            // window calling it again costs nothing.
            .task { active.connections.startBackgroundSync() }
            // Which server this window is looking at. A connection nobody is
            // showing must not suppress its own banners or mark its channel
            // read — its `WindowState` outlives the switch (#542). Recorded on
            // appearance *and* at every site that changes `selected`, because
            // the two have to agree before the first event arrives.
            .onAppear { showing(active) }
            .background(WindowKeyObserver {
                active.connections.presentNotification = { app, target in
                    selected = app
                    workspace = target.workspaceId
                    notificationTarget = target
                    showing(app)
                }
            })
            .overlay(alignment: .topTrailing) {
                if let owner = AppState.joinedHuddleOwner, owner !== active {
                    Button("Return to huddle on \(URL(string: owner.serverOrigin)?.host ?? "server")") {
                        selected = owner
                        workspace = owner.activeHuddleWorkspaceId
                        showing(owner)
                    }.padding(8)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                Button("Workspaces and servers") { showConnections = true }.padding(8)
            }
            .onOpenURL { url in
                if url.scheme == "https" || url.scheme == "http" {
                    incomingAddress = url.absoluteString
                    showConnections = true
                } else { active.handleDeepLink(url) }
            }
            .sheet(isPresented: $showConnections) {
                ServerConnectionsView(current: active, initialAddress: incomingAddress) { app, workspaceId in
                    if let workspaceId { UserDefaults.standard.set(workspaceId, forKey: app.sessionScope.key("activeWorkspaceId")) }
                    notificationTarget = nil
                    workspace = workspaceId
                    selected = app
                    showing(app)
                }
            }
    }
}

private struct SessionRootView: View {
    @EnvironmentObject private var app: AppState
    /// This window's own selection state (workspace/channel/thread/…) — a
    /// `@StateObject` here is per window, unlike one on the `App` struct,
    /// which is what used to make every window mirror the same selection.
    @StateObject private var win: WindowState

    init(app: AppState, workspaceId: String?, notification: NavigationTarget?) {
        let window = WindowState(app: app)
        if let workspaceId { window.selectWorkspace(workspaceId) }
        if let notification, let channel = notification.channelId, let message = notification.messageId {
            window.openNotification(workspaceId: notification.workspaceId, channelId: channel,
                                    messageId: message, threadRootId: notification.threadRootId)
        }
        _win = StateObject(wrappedValue: window)
    }

    var body: some View {
        Group {
            switch app.phase {
            case .loading:
                ProgressView("Loading…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                AuthView()
            case .signedIn:
                if win.selectedWorkspaceId == nil {
                    WorkspaceSwitcherView()
                        .onAppear { win.restoreActiveWorkspace() }
                } else {
                    MainView()
                }
            }
        }
        .environmentObject(win)
        // Confetti overlay for 🎉 reactions (#524). Per window, so a burst
        // lands in the window whose pill was reacted to and nowhere else.
        .confettiHost()
        .debugAutoLogin(app)
        // Banner taps and accepted invites navigate the key window — tell the
        // shared state which one that is.
        .background(WindowKeyObserver { app.noteKeyWindow(win) })

        .alert(
            "Error",
            isPresented: Binding(
                get: { app.errorMessage != nil },
                set: { if !$0 { app.errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(app.errorMessage ?? "")
        }
        // Voice huddle (Phase 1): unmuting with no OS mic permission. Its own
        // alert (not the generic one above) because this is the one place an
        // action button — jumping straight to the Microphone privacy pane —
        // actually helps.
        .alert(
            "Microphone Access Needed",
            isPresented: $app.micPermissionBlocked
        ) {
            Button("Open Settings") { app.openMicrophoneSettings() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Flow needs microphone access to talk in a huddle. Enable it in System Settings → Privacy & Security → Microphone.")
        }
        // Same shape for the camera (#435) — a separate OS grant, a separate
        // pane, and the same reason for its own alert: "Open Settings" is the
        // only useful thing to offer.
        .alert(
            "Camera Access Needed",
            isPresented: $app.cameraPermissionBlocked
        ) {
            Button("Open Settings") { app.openCameraSettings() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Flow needs camera access to turn on video in a huddle. Enable it in System Settings → Privacy & Security → Camera.")
        }
        // Screen Recording refused, or never granted. ScreenCaptureKit answers
        // an ungranted app with an empty source list rather than an error, so
        // this covers both "denied" and "never asked" — and both are fixed in
        // the same pane.
        .alert(
            "Screen Recording Access Needed",
            isPresented: $app.screenPermissionBlocked
        ) {
            Button("Open Settings") { app.openScreenRecordingSettings() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Flow needs Screen Recording access to share a window or screen. Enable it in System Settings → Privacy & Security → Screen Recording, then reopen Flow.")
        }
    }
}

/// Reports when this view's window becomes key. SwiftUI has no per-window
/// key-status hook, so a zero-size AppKit view listens for the window's
/// `didBecomeKeyNotification` (and fires once on attach if already key).
private struct WindowKeyObserver: NSViewRepresentable {
    let onKey: () -> Void

    func makeNSView(context: Context) -> KeyObserverView {
        let view = KeyObserverView()
        view.onKey = onKey
        return view
    }

    func updateNSView(_ nsView: KeyObserverView, context: Context) {
        nsView.onKey = onKey
    }

    final class KeyObserverView: NSView {
        var onKey: (() -> Void)?
        private var observer: NSObjectProtocol?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            // Leaving a window (including window close, which strips its views
            // before dealloc) is where the observer is released — a deinit
            // cleanup would race Swift 6's nonisolated-deinit rules.
            if let observer {
                NotificationCenter.default.removeObserver(observer)
                self.observer = nil
            }
            guard let window else { return }
            if window.isKeyWindow { onKey?() }
            observer = NotificationCenter.default.addObserver(
                forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main
            ) { [weak self] _ in
                // Delivery is pinned to the main queue above, but
                // NotificationCenter's callback is `@Sendable`; make that
                // runtime guarantee explicit to Swift 6's actor checker.
                MainActor.assumeIsolated {
                    self?.onKey?()
                }
            }
        }
    }
}

import AppKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var app: AppState
    /// This window's own selection state (workspace/channel/thread/…) — a
    /// `@StateObject` here is per window, unlike one on the `App` struct,
    /// which is what used to make every window mirror the same selection.
    @StateObject private var win: WindowState

    init(app: AppState) {
        _win = StateObject(wrappedValue: WindowState(app: app))
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
        .debugAutoLogin(app)
        // Banner taps and accepted invites navigate the key window — tell the
        // shared state which one that is.
        .background(WindowKeyObserver { app.noteKeyWindow(win) })
        .onOpenURL { url in
            app.handleDeepLink(url)
        }
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

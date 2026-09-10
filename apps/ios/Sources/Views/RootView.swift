import SwiftUI

struct RootView: View {
    @EnvironmentObject private var initial: AppState
    @State private var selected: AppState?
    @State private var showConnections = false
    @State private var incomingAddress = ""
    @State private var workspace: String?
    private var active: AppState { selected ?? initial }
    var body: some View {
        SessionRootView()
            .environmentObject(active)
            .id("\(active.connectionId):\(workspace ?? "")")
            .overlay(alignment: .topTrailing) {
                if let owner = AppState.joinedHuddleOwner, owner !== active {
                    Button("Return to huddle on \(URL(string: owner.serverOrigin)?.host ?? "server")") {
                        selected = owner
                        workspace = owner.activeHuddleWorkspaceId
                    }.padding(8)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                Button("Workspaces and servers") { showConnections = true }
                    .font(.caption).padding(8).background(.regularMaterial, in: Capsule()).padding(8)
            }
            .onReceive(NotificationCenter.default.publisher(for: .init("flow.selectConnection"))) { event in
                if let app = event.object as? AppState { selected = app; workspace = nil }
            }
            .onOpenURL { url in
                if url.scheme == "https" || url.scheme == "http" {
                    incomingAddress = url.absoluteString
                    showConnections = true
                } else { active.handleDeepLink(url) }
            }
            .sheet(isPresented: $showConnections) {
                ServerConnectionsView(current: active, initialAddress: incomingAddress) { app, workspaceId in
                    if let workspaceId { app.selectWorkspace(workspaceId) }
                    workspace = workspaceId
                    selected = app
                }
            }
    }
}

private struct SessionRootView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        Group {
            switch app.phase {
            case .loading:
                ProgressView().controlSize(.large)
            case .signedOut:
                AuthView()
            case .signedIn:
                MainView()
            }
        }
        .animation(.default, value: app.phase)
        // Confetti overlay for 🎉 reactions (#524) — same host modifier the
        // macOS root mounts; the overlay and the rule are shared code.
        .confettiHost()
        .debugAutoLogin(app)
        // Port of the macOS `RootView` alert. `showError` has always set
        // `errorMessage` on iOS too, but nothing rendered it — every failure on
        // the phone was silent, which is how a refused workspace delete looked
        // like a no-op (#340 follow-up).
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
        // action button — jumping straight to Flow's Settings page — actually
        // helps. Port of the macOS RootView alert.
        .alert(
            "Microphone Access Needed",
            isPresented: $app.micPermissionBlocked
        ) {
            Button("Open Settings") { app.openMicrophoneSettings() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Flow needs microphone access to talk in a huddle. Enable it in Settings → Flow → Microphone.")
        }
        // Same shape for the camera (#435): a separate OS grant, and "Open
        // Settings" is the only useful thing to offer once it's refused.
        .alert(
            "Camera Access Needed",
            isPresented: $app.cameraPermissionBlocked
        ) {
            Button("Open Settings") { app.openCameraSettings() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Flow needs camera access to turn on video in a huddle. Enable it in Settings → Flow → Camera.")
        }
    }
}

import SwiftUI

@main
struct FlowApp: App {
    // APNs (#249): token registration, the foreground rule and tap routing all
    // arrive as UIKit callbacks, some of them before any view exists.
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var pushDelegate
    @StateObject private var app = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .tint(MC.accent)
                // `MC` is a single fixed light palette (macOS parity — see the
                // note in that client's AppDelegate). iOS fares better than
                // macOS in Dark mode because its `paragraphText` names
                // `MC.ink`, but everything drawn in a system colour still
                // inverts: day pills, the composer placeholder and the
                // `(edited)` marker all vanish against the light background.
                .preferredColorScheme(.light)
                // Backgrounded (or on the app switcher) is not "seen": the
                // selected channel must not mark its mail read (issue #63).
                .onChange(of: scenePhase) { _, phase in app.setAppActive(phase == .active) }
                // Hand the app state to the push delegate, which replays a
                // token or a tap that arrived before the UI was ready (a cold
                // launch from a banner is exactly that).
                .onAppear { pushDelegate.attach(app) }
                // And again on every phase change: a tapped push can only be
                // routed once we are signed in, which on a cold launch happens
                // several beats after the first view appears (#458).
                .onChange(of: app.phase) { _, _ in pushDelegate.attach(app) }
                // Web-to-app handoff: flow://signin?code=… (and flow://invite/…)
                .onOpenURL { app.handleDeepLink($0) }
        }
    }
}

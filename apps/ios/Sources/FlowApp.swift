import SwiftUI

@main
struct FlowApp: App {
    @StateObject private var app = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .tint(MC.accent)
                // Backgrounded (or on the app switcher) is not "seen": the
                // selected channel must not mark its mail read (issue #63).
                .onChange(of: scenePhase) { _, phase in app.setAppActive(phase == .active) }
                // Web-to-app handoff: flow://signin?code=… (and flow://invite/…)
                .onOpenURL { app.handleDeepLink($0) }
        }
    }
}

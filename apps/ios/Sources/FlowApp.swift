import SwiftUI

@main
struct FlowApp: App {
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .tint(MC.accent)
                // Web-to-app handoff: flow://signin?code=… (and flow://invite/…)
                .onOpenURL { app.handleDeepLink($0) }
        }
    }
}

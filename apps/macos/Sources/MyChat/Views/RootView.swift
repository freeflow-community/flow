import SwiftUI

struct RootView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        Group {
            switch app.phase {
            case .loading:
                ProgressView("Loading…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                AuthView()
            case .signedIn:
                if app.selectedWorkspaceId == nil {
                    WorkspaceSwitcherView()
                } else {
                    MainView()
                }
            }
        }
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
    }
}

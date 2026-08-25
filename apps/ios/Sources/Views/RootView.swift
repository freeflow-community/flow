import SwiftUI

struct RootView: View {
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
    }
}

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
    }
}

import SwiftUI

/// DEBUG-only QA affordance (analogous to the macOS FLOW_PROFILE hook): when
/// launched with FLOW_DEBUG_EMAIL + FLOW_DEBUG_PASSWORD in the environment,
/// sign in automatically once bootstrap resolves to signed-out. Lets the
/// simulator be driven end-to-end without a UI text-input tool. Compiled out
/// of release builds.
struct DebugAutoLogin: ViewModifier {
    @ObservedObject var app: AppState
    @State private var attempted = false

    private var signedOut: Bool {
        if case .signedOut = app.phase { return true }
        return false
    }

    func body(content: Content) -> some View {
        #if DEBUG
        content.onChange(of: signedOut, initial: true) { _, isOut in
            guard isOut, !attempted else { return }
            let env = ProcessInfo.processInfo.environment
            guard let email = env["FLOW_DEBUG_EMAIL"], !email.isEmpty,
                  let password = env["FLOW_DEBUG_PASSWORD"], !password.isEmpty
            else { return }
            attempted = true
            Task {
                do { try await app.engine.login(email: email, password: password) }
                catch { NSLog("debugAutoLogin failed: \(error)") }
            }
        }
        #else
        content
        #endif
    }
}

extension View {
    func debugAutoLogin(_ app: AppState) -> some View {
        modifier(DebugAutoLogin(app: app))
    }
}

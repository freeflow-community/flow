import SwiftUI

/// Sign-in only (registration is web-first on real servers — the email-first
/// flow lives on app.flowtoo.org, then the flow://signin handoff brings you
/// into the app). Mirrors the macOS auth screen's server-aware behavior.
struct AuthView: View {
    @EnvironmentObject var app: AppState

    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    private var formValid: Bool { !email.isEmpty && !password.isEmpty }

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 52))
                .foregroundStyle(MC.accent)
            Text("Flow").font(.largeTitle.bold()).foregroundStyle(MC.ink)

            VStack(spacing: 12) {
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .onSubmit(submit)
            }
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 320)

            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
                    .multilineTextAlignment(.center).frame(maxWidth: 320)
            }

            Button(action: submit) {
                Group {
                    if busy { ProgressView() } else { Text("Sign In").bold() }
                }
                .frame(maxWidth: 320).frame(height: 22).padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .tint(MC.accent)
            .disabled(busy || !formValid)

            if !Server.isDefaultLocal {
                Link("New to Flow? Create your account on the web", destination: Server.baseURL)
                    .font(.callout)
            }
            Spacer()
            Text("Server: \(Server.displayName)")
                .font(.caption).foregroundStyle(MC.muted)
                .padding(.bottom, 8)
        }
        .padding()
        .background(MC.base.ignoresSafeArea())
    }

    private func submit() {
        guard formValid, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.engine.login(email: email, password: password)
            } catch {
                self.error = (error as? APIError)?.message ?? error.localizedDescription
            }
        }
    }
}

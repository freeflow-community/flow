import SwiftUI

/// Sign-in only (registration is web-first on real servers — the email-first
/// flow lives on app.freeflow.im, then the flow://signin handoff brings you
/// into the app). Mirrors the macOS auth screen's server-aware behavior.
struct AuthView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.openURL) private var openURL

    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    /// Whether this server offers Google sign-in (GET /v1/config). A failed
    /// check leaves it false, so the button is absent rather than broken.
    @State private var googleEnabled = false
    /// True after a sign-in link was requested — swaps the form for a neutral
    /// "check your email" confirmation.
    @State private var linkSent = false

    private var formValid: Bool { !email.isEmpty && !password.isEmpty }
    private var emailValid: Bool { email.contains("@") && !email.hasSuffix("@") }

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 52))
                .foregroundStyle(MC.accent)
            Text("Flow").font(.largeTitle.bold()).foregroundStyle(MC.ink)

            if linkSent {
                linkSentCard
            } else {
                signInForm
            }

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
        .task {
            googleEnabled = (try? await app.engine.publicConfig())?.google ?? false
        }
    }

    /// Google sign-in (phase16 §9): iOS carries no Google SDK, so this opens
    /// Safari at the Flow handoff page, which signs in and returns via
    /// flow://signin?code=… — the deep link the app already handles.
    private var googleButton: some View {
        VStack(spacing: 6) {
            Divider().frame(maxWidth: 320)
            Button {
                openURL(Server.nativeGoogleSignInURL)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "globe")
                    Text("Continue with Google").bold()
                }
                .frame(maxWidth: 320).frame(height: 22).padding(.vertical, 8)
            }
            .buttonStyle(.bordered)
            .tint(MC.accent)
            .disabled(busy)
            Text("Opens Safari, then brings you back to Flow.")
                .font(.caption).foregroundStyle(MC.muted)
        }
    }

    private var signInForm: some View {
        VStack(spacing: 22) {
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

            // Passwordless alternative: email a one-time sign-in link. Enabled on
            // a plausible email alone — no password needed.
            Button(action: sendLink) {
                Text("Email me a sign-in link")
            }
            .font(.callout)
            .tint(MC.accent)
            .disabled(busy || !emailValid)

            if googleEnabled { googleButton }
        }
    }

    private var linkSentCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "envelope.badge.fill")
                .font(.system(size: 34))
                .foregroundStyle(MC.accent)
            Text("Check your email").font(.title3.bold()).foregroundStyle(MC.ink)
            Text("If an account exists for \(email), we just sent a sign-in link. Open it to sign in — the link works once and expires in 15 minutes.")
                .font(.callout).foregroundStyle(MC.muted)
                .multilineTextAlignment(.center).frame(maxWidth: 320)
            Button("Back to sign in") {
                linkSent = false
                error = nil
            }
            .font(.callout).tint(MC.accent).padding(.top, 4)
        }
        .frame(maxWidth: 320)
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

    private func sendLink() {
        guard emailValid, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.engine.sendSigninLink(email: email)
                linkSent = true
            } catch {
                // Only a transport failure lands here — the server itself never
                // reveals whether the address exists.
                self.error = (error as? APIError)?.message ?? error.localizedDescription
            }
        }
    }
}

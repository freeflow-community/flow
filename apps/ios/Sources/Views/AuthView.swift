import AuthenticationServices
import SwiftUI

/// Sign-in and email-first registration. Everything runs in the app (App
/// Store Guideline 4): email+password and Sign in with Apple are native,
/// Google runs in an in-app ASWebAuthenticationSession sheet, and Register
/// sends the signup email from here — the emailed link finishes account
/// setup on the web and hands the session back via flow://signin.
struct AuthView: View {
    private enum Mode { case signIn, register }

    @EnvironmentObject var app: AppState

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    /// Whether this server offers Google sign-in (GET /v1/config). A failed
    /// check leaves it false, so the button is absent rather than broken.
    @State private var googleEnabled = false
    /// Same for Sign in with Apple — native flow, no web roundtrip at all.
    @State private var appleEnabled = false
    /// True after a sign-in link was requested — swaps the form for a neutral
    /// "check your email" confirmation.
    @State private var linkSent = false
    /// True after a signup email was requested — same swap for Register.
    @State private var signupSent = false

    private var formValid: Bool { !email.isEmpty && !password.isEmpty }
    private var emailValid: Bool { email.contains("@") && !email.hasSuffix("@") }

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 52))
                .foregroundStyle(MC.accent)
            Text("Flow").font(.largeTitle.bold()).foregroundStyle(MC.ink)

            // Set when the server rejected our token mid-session, so being
            // bounced to this screen has a stated reason.
            if let reason = app.signedOutReason {
                Text(reason)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 24)
                    .accessibilityIdentifier("auth.signedOutReason")
            }

            if linkSent {
                linkSentCard
            } else if signupSent {
                signupSentCard
            } else {
                modePicker
                if mode == .signIn { signInForm } else { registerForm }
            }
            Spacer()
            Text("Server: \(Server.displayName)")
                .font(.caption).foregroundStyle(MC.muted)
                .padding(.bottom, 8)
        }
        .padding()
        .background(MC.base.ignoresSafeArea())
        .task {
            let cfg = try? await app.engine.publicConfig()
            googleEnabled = cfg?.google ?? false
            appleEnabled = cfg?.apple ?? false
        }
    }

    private var modePicker: some View {
        HStack(spacing: 8) {
            Button("Sign In") { switchMode(.signIn) }
                .fontWeight(mode == .signIn ? .semibold : .regular)
                .foregroundStyle(mode == .signIn ? MC.accent : MC.muted)
            Text("·").foregroundStyle(MC.muted)
            Button("Register") { switchMode(.register) }
                .fontWeight(mode == .register ? .semibold : .regular)
                .foregroundStyle(mode == .register ? MC.accent : MC.muted)
        }
        .font(.callout)
        .disabled(busy)
    }

    /// Google sign-in (phase16 §9): iOS carries no Google SDK, so the Flow
    /// handoff page runs in an in-app ASWebAuthenticationSession sheet. It
    /// signs in and ends at flow://signin?code=…, which the sheet intercepts —
    /// no trip through Safari (App Store Guideline 4).
    private var googleButton: some View {
        Button {
            signInWithGoogle()
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

            if appleEnabled || googleEnabled {
                Divider().frame(maxWidth: 320)
            }
            if appleEnabled { appleButton }
            if googleEnabled { googleButton }
        }
    }

    /// Email-first registration, matching the web: the only input is the
    /// address. Name and password are chosen from the emailed link, which
    /// proves address ownership first.
    private var registerForm: some View {
        VStack(spacing: 22) {
            Text("Enter your email and we'll send you a link to set up your account.")
                .font(.callout).foregroundStyle(MC.muted)
                .multilineTextAlignment(.center).frame(maxWidth: 320)

            TextField("Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 320)
                .onSubmit(sendSignup)

            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
                    .multilineTextAlignment(.center).frame(maxWidth: 320)
            }

            Button(action: sendSignup) {
                Group {
                    if busy { ProgressView() } else { Text("Send me a link").bold() }
                }
                .frame(maxWidth: 320).frame(height: 22).padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .tint(MC.accent)
            .disabled(busy || !emailValid)

            // Google and Apple create the account in one step — offer them
            // here too, exactly like the web Register panel.
            if appleEnabled || googleEnabled {
                Divider().frame(maxWidth: 320)
            }
            if appleEnabled { appleButton }
            if googleEnabled { googleButton }
        }
    }

    /// Native Sign in with Apple: the OS sheet hands back an identity token the
    /// server verifies against Apple's JWKS — no browser roundtrip. The name
    /// only arrives on the very first authorization, so it's forwarded then.
    private var appleButton: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
        } onCompletion: { result in
            switch result {
            case .success(let authorization):
                guard
                    let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                    let tokenData = credential.identityToken,
                    let token = String(data: tokenData, encoding: .utf8)
                else {
                    error = "Apple sign-in returned no identity token."
                    return
                }
                let name = credential.fullName.flatMap {
                    let formatted = PersonNameComponentsFormatter.localizedString(from: $0, style: .default)
                    return formatted.isEmpty ? nil : formatted
                }
                busy = true
                error = nil
                Task {
                    defer { busy = false }
                    do {
                        try await app.engine.signInWithApple(identityToken: token, fullName: name)
                    } catch {
                        self.error = (error as? APIError)?.message ?? error.localizedDescription
                    }
                }
            case .failure(let err):
                // Cancelling the sheet is not an error worth showing.
                if (err as? ASAuthorizationError)?.code != .canceled {
                    error = err.localizedDescription
                }
            }
        }
        .signInWithAppleButtonStyle(.black)
        .frame(maxWidth: 320)
        .frame(height: 44)
        .disabled(busy)
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

    private var signupSentCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "envelope.badge.fill")
                .font(.system(size: 34))
                .foregroundStyle(MC.accent)
            Text("Check your email").font(.title3.bold()).foregroundStyle(MC.ink)
            Text("We sent a link to \(email). Open it to finish creating your account — you'll land right back here, signed in.")
                .font(.callout).foregroundStyle(MC.muted)
                .multilineTextAlignment(.center).frame(maxWidth: 320)
            Button("Back to sign in") {
                signupSent = false
                switchMode(.signIn)
            }
            .font(.callout).tint(MC.accent).padding(.top, 4)
        }
        .frame(maxWidth: 320)
    }

    private func switchMode(_ m: Mode) {
        mode = m
        error = nil
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

    private func sendSignup() {
        guard emailValid, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.engine.requestSignup(email: email)
                signupSent = true
            } catch {
                self.error = (error as? APIError)?.message ?? error.localizedDescription
            }
        }
    }

    private func signInWithGoogle() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                // nil = the user closed the sheet; not an error worth showing.
                guard let code = try await WebAuthSession.signInCode(
                    startingAt: Server.nativeGoogleSignInURL
                ) else { return }
                try await app.engine.loginWithLinkCode(code)
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

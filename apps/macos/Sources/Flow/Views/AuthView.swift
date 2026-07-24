import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var app: AppState

    @State private var isRegister = false
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var busy = false
    @State private var error: String?
    /// Whether this server offers Google sign-in (GET /v1/config). Nil until
    /// the check answers; a failure resolves to false, so the button simply
    /// doesn't appear rather than appearing and failing.
    @State private var googleEnabled = false

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("Flow")
                .font(.largeTitle.bold())

            // In-app registration uses the dev-only autoVerify path, so it only
            // exists against the local dev server. Real servers register via the
            // web (email-first flow) + "Open the desktop app" handoff.
            if Server.isDefaultLocal {
                Picker("", selection: $isRegister) {
                    Text("Sign In").tag(false)
                    Text("Register").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 240)
                .labelsHidden()
                .accessibilityIdentifier("auth.mode")
            }

            VStack(spacing: 10) {
                if isRegister {
                    TextField("Display name", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("auth.displayName")
                }
                TextField("Email", text: $email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.username)
                    .accessibilityIdentifier("auth.email")
                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(submit)
                    .accessibilityIdentifier("auth.password")
            }
            .frame(width: 280)

            if let error {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .frame(width: 300)
                    .multilineTextAlignment(.center)
            }

            Button(action: submit) {
                if busy {
                    ProgressView().controlSize(.small).frame(width: 120)
                } else {
                    Text(isRegister ? "Create Account" : "Sign In")
                        .frame(width: 120)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy || !formValid)
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("auth.submit")

            // Google sign-in (phase16 §9): the Mac app carries no Google SDK,
            // so this opens the browser at the Flow handoff page, which signs
            // in and bounces back via flow://signin?code=… — the same handoff
            // "Open the desktop app" uses in the other direction.
            if googleEnabled {
                Divider().frame(width: 280)
                Button {
                    NSWorkspace.shared.open(Server.nativeGoogleSignInURL)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "globe")
                        Text("Continue with Google")
                    }
                    .frame(width: 200)
                }
                .accessibilityIdentifier("auth.google")
                Text("Opens your browser, then returns you here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !Server.isDefaultLocal {
                Button("New to Flow? Create your account on the web") {
                    NSWorkspace.shared.open(Server.baseURL)
                }
                .buttonStyle(.link)
                .font(.callout)
            }

            Text("Server: \(Server.displayName)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            googleEnabled = (try? await app.engine.publicConfig())?.google ?? false
        }
    }

    private var formValid: Bool {
        !email.isEmpty && !password.isEmpty && (!isRegister || !displayName.isEmpty)
    }

    private func submit() {
        guard formValid, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                if isRegister {
                    try await app.engine.register(
                        email: email, password: password, displayName: displayName
                    )
                } else {
                    try await app.engine.login(email: email, password: password)
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

import SwiftUI

struct AuthView: View {
    @EnvironmentObject private var app: AppState

    @State private var isRegister = false
    @State private var email = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("MyChat")
                .font(.largeTitle.bold())

            Picker("", selection: $isRegister) {
                Text("Sign In").tag(false)
                Text("Register").tag(true)
            }
            .pickerStyle(.segmented)
            .frame(width: 240)
            .labelsHidden()

            VStack(spacing: 10) {
                if isRegister {
                    TextField("Display name", text: $displayName)
                        .textFieldStyle(.roundedBorder)
                }
                TextField("Email", text: $email)
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.username)
                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(submit)
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
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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

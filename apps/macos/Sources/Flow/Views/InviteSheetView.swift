import AppKit
import SwiftUI

struct InviteSheetView: View {
    let workspaceId: String
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var inviteUrl: String?
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Invite to Workspace").font(.headline)
            Text("Enter an email address to create an invite link. No email is sent — copy the link and share it yourself.")
                .font(.callout)
                .foregroundStyle(.secondary)

            HStack {
                TextField("person@example.com", text: $email)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(createInvite)
                Button("Create Invite") { createInvite() }
                    .disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
            }

            if let inviteUrl {
                HStack {
                    Text(inviteUrl)
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(inviteUrl, forType: .string)
                        copied = true
                    } label: {
                        Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(.quaternary.opacity(0.5)))
            }

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 460)
    }

    private func createInvite() {
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !busy else { return }
        busy = true
        error = nil
        copied = false
        Task {
            defer { busy = false }
            do {
                inviteUrl = try await app.engine.createInvite(workspaceId: workspaceId, email: trimmed)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

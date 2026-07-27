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

    // Persistent workspace join link (issue #85). `canManageJoinLink` stays
    // false until the server answers — non-admins get a 403 and never see the
    // section at all.
    @State private var joinUrl: String?
    @State private var canManageJoinLink = false
    @State private var joinBusy = false
    @State private var joinCopied = false
    @State private var joinError: String?

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

            if canManageJoinLink {
                Divider()
                joinLinkSection
            }

            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 460)
        .task { await loadJoinLink() }
    }

    /// Generate / copy / regenerate / revoke the one link that's live for this
    /// workspace. Regenerate is also how you revoke a leaked link without
    /// closing the door.
    private var joinLinkSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Share a join link").font(.headline)
            Text("Anyone with this link can join the workspace. It stays valid until you regenerate or revoke it.")
                .font(.callout)
                .foregroundStyle(.secondary)

            if let joinUrl {
                HStack {
                    Text(joinUrl)
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(joinUrl, forType: .string)
                        joinCopied = true
                    } label: {
                        Label(joinCopied ? "Copied" : "Copy", systemImage: joinCopied ? "checkmark" : "doc.on.doc")
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(.quaternary.opacity(0.5)))

                HStack {
                    Button("Regenerate") { mutateJoinLink(revoke: false) }
                    Button("Revoke", role: .destructive) { mutateJoinLink(revoke: true) }
                }
                .disabled(joinBusy)
            } else {
                Button("Create Join Link") { mutateJoinLink(revoke: false) }
                    .disabled(joinBusy)
            }

            if let joinError {
                Text(joinError).font(.callout).foregroundStyle(.red)
            }
        }
    }

    private func loadJoinLink() async {
        do {
            joinUrl = try await app.engine.joinLink(workspaceId: workspaceId)
            canManageJoinLink = true
        } catch {
            canManageJoinLink = false // not an owner/admin, or offline
        }
    }

    private func mutateJoinLink(revoke: Bool) {
        guard !joinBusy else { return }
        joinBusy = true
        joinError = nil
        joinCopied = false
        Task {
            defer { joinBusy = false }
            do {
                if revoke {
                    try await app.engine.revokeJoinLink(workspaceId: workspaceId)
                    joinUrl = nil
                } else {
                    joinUrl = try await app.engine.createJoinLink(workspaceId: workspaceId)
                }
            } catch {
                joinError = error.localizedDescription
            }
        }
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

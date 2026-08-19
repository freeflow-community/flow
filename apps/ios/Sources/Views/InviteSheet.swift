import SwiftUI

/// iOS counterpart of the macOS `InviteSheetView`: the one place you invite a
/// person to the workspace. Two ways in, same as macOS —
///
/// 1. an emailed-to-nobody **invite link** minted per address (the server sends
///    no mail; you copy the link and pass it on yourself), and
/// 2. the workspace's persistent **join link**, which owners/admins can create,
///    regenerate or revoke (issue #85).
///
/// The join-link section stays hidden until the server confirms the caller may
/// manage it — non-admins get a 403 and simply never see it, matching macOS.
///
/// The engine calls are the shared `SyncEngine` ones macOS already uses, so this
/// file is purely the phone's half of the port. Where macOS offers Copy, iOS
/// offers Copy *and* a share sheet: passing a link on from a phone is a system
/// affordance, and a link you can't send anywhere is the wrong end of the flow.
struct InviteSheet: View {
    let workspaceId: String

    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var inviteUrl: String?
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false

    // Persistent workspace join link. `canManageJoinLink` stays false until the
    // server answers, so the section never flashes for someone who can't use it.
    @State private var joinUrl: String?
    @State private var canManageJoinLink = false
    @State private var joinBusy = false
    @State private var joinCopied = false
    @State private var joinError: String?

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            Form {
                inviteSection
                if canManageJoinLink { joinLinkSection }
            }
            .navigationTitle("Invite People")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("invite.done")
                }
            }
            .task { await loadJoinLink() }
        }
    }

    // MARK: - Invite by email

    private var inviteSection: some View {
        Section {
            TextField("person@example.com", text: $email)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .onSubmit(createInvite)
                .accessibilityIdentifier("invite.email")

            Button("Create Invite") { createInvite() }
                .disabled(busy || trimmedEmail.isEmpty)
                .accessibilityIdentifier("invite.create")

            if let error {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(MC.danger)
                    .accessibilityIdentifier("invite.error")
            }

            if let inviteUrl {
                linkRow(
                    url: inviteUrl,
                    copied: copied,
                    idPrefix: "invite.link",
                    onCopy: {
                        UIPasteboard.general.string = inviteUrl
                        copied = true
                    }
                )
            }
        } header: {
            Text("Invite by email")
        } footer: {
            Text("Creates an invite link for that address. No email is sent — share the link yourself.")
        }
    }

    // MARK: - Join link

    /// Create / copy / regenerate / revoke the one link that's live for this
    /// workspace. Regenerating is also how you kill a leaked link without
    /// closing the door on everyone.
    private var joinLinkSection: some View {
        Section {
            if let joinUrl {
                linkRow(
                    url: joinUrl,
                    copied: joinCopied,
                    idPrefix: "invite.joinLink",
                    onCopy: {
                        UIPasteboard.general.string = joinUrl
                        joinCopied = true
                    }
                )
                Button("Regenerate") { mutateJoinLink(revoke: false) }
                    .disabled(joinBusy)
                    .accessibilityIdentifier("invite.joinLink.regenerate")
                Button("Revoke", role: .destructive) { mutateJoinLink(revoke: true) }
                    .disabled(joinBusy)
                    .accessibilityIdentifier("invite.joinLink.revoke")
            } else {
                Button("Create Join Link") { mutateJoinLink(revoke: false) }
                    .disabled(joinBusy)
                    .accessibilityIdentifier("invite.joinLink.create")
            }

            if let joinError {
                Text(joinError)
                    .font(.callout)
                    .foregroundStyle(MC.danger)
                    .accessibilityIdentifier("invite.joinLink.error")
            }
        } header: {
            Text("Share a join link")
        } footer: {
            Text("Anyone with this link can join the workspace. It stays valid until you regenerate or revoke it.")
        }
    }

    // MARK: - Shared pieces

    /// A minted link plus the two things you'd do with it. The URL wraps rather
    /// than truncating: on a phone this is often the only copy you get to see,
    /// and a middle-truncated link reads as broken.
    private func linkRow(
        url: String,
        copied: Bool,
        idPrefix: String,
        onCopy: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(url)
                .font(.system(size: 13, design: .monospaced))
                .textSelection(.enabled)
                .accessibilityIdentifier(idPrefix)

            HStack(spacing: 16) {
                Button(action: onCopy) {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .accessibilityIdentifier("\(idPrefix).copy")

                if let link = URL(string: url) {
                    ShareLink(item: link) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("\(idPrefix).share")
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Actions

    private func createInvite() {
        let trimmed = trimmedEmail
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
}

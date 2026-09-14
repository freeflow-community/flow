import SwiftUI

/// iOS counterpart of the macOS `InviteSheetView`: the one place you invite a
/// person to the workspace. Two ways in, same as macOS —
///
/// 1. **invite by email** — one or more addresses in a single submit; the
///    server emails each person an invite link and answers per address (#577),
///    and
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

    @State private var emails = ""
    @State private var results: [InviteResult]?
    @State private var busy = false
    @State private var error: String?
    @State private var copiedUrl: String?

    // Persistent workspace join link. `canManageJoinLink` stays false until the
    // server answers, so the section never flashes for someone who can't use it.
    @State private var joinUrl: String?
    @State private var canManageJoinLink = false
    @State private var joinBusy = false
    @State private var joinCopied = false
    @State private var joinError: String?

    /// Whatever was pasted, split into addresses (shared with macOS and web).
    private var parsed: [String] { InviteAddresses.parse(emails) }

    private var sendTitle: String { parsed.count > 1 ? "Send \(parsed.count) Invites" : "Send Invites" }

    var body: some View {
        NavigationStack {
            Form {
                if let results, !results.isEmpty { resultsSection(results) }
                // Everything landed: nothing is left to retype, so the box goes
                // away and Done is the only thing left to do.
                if results == nil || !parsed.isEmpty { inviteSection }
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
            TextField("person@example.com, someone@example.com", text: $emails, axis: .vertical)
                .lineLimit(1...4)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)
                .accessibilityIdentifier("invite.email")

            Button(sendTitle) { sendInvites() }
                .disabled(busy || parsed.isEmpty)
                .accessibilityIdentifier("invite.send")

            if let error {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(MC.danger)
                    .accessibilityIdentifier("invite.error")
            }
        } header: {
            Text("Invite by email")
        } footer: {
            Text("Separate addresses with commas. We'll email each person an invite link.")
        }
    }

    // MARK: - Results

    /// One row per address, in the order they were typed. Only an address the
    /// email could not reach shows a link — the rest were delivered, and five
    /// links for five successes is noise.
    private func resultsSection(_ results: [InviteResult]) -> some View {
        Section {
            ForEach(results, id: \.email) { result in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: result.status.isDelivered ? "checkmark.circle.fill" : "exclamationmark.circle")
                            .foregroundStyle(statusColor(result.status))
                        Text(result.email)
                            .font(.callout)
                            .accessibilityIdentifier("invite.result.\(result.email)")
                        Spacer(minLength: 8)
                        Text(result.status.label)
                            .font(.caption)
                            .multilineTextAlignment(.trailing)
                            .foregroundStyle(statusColor(result.status))
                            .accessibilityIdentifier("invite.status.\(result.email)")
                    }

                    // The one case where the person still has to do something:
                    // nothing was delivered, so hand them the link to pass on.
                    if result.status == .emailFailed, let url = result.inviteUrl {
                        linkRow(
                            url: url,
                            copied: copiedUrl == url,
                            idPrefix: "invite.link.\(result.email)",
                            onCopy: {
                                UIPasteboard.general.string = url
                                copiedUrl = url
                            }
                        )
                    }
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text("Results")
        }
    }

    private func statusColor(_ status: InviteStatus) -> Color {
        if status.isFailure { return MC.danger }
        return status.isDelivered ? .green : .secondary
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

    /// One call for the whole list (#577): the server decides per address, so a
    /// typo never costs the rest of the batch.
    private func sendInvites() {
        let addresses = parsed
        guard !addresses.isEmpty, !busy else { return }
        busy = true
        error = nil
        copiedUrl = nil
        Task {
            defer { busy = false }
            do {
                let results = try await app.engine.createInvites(workspaceId: workspaceId, emails: addresses)
                self.results = results
                // Only what failed stays in the box: hitting Send again retries
                // exactly those and never re-mails the ones that landed.
                emails = results.filter { $0.status.isFailure }.map(\.email).joined(separator: ", ")
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

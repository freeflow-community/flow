import AppKit
import SwiftUI

struct InviteSheetView: View {
    let workspaceId: String
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var emails = ""
    @State private var results: [InviteResult]?
    @State private var busy = false
    @State private var error: String?
    @State private var copiedUrl: String?

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
            Text("Invite to Workspace").flowFont(.headline)

            if let results, !results.isEmpty {
                resultsSection(results)
            }

            if results == nil || !parsed.isEmpty {
                Text("Separate addresses with commas. We'll email each person an invite link.")
                    .flowFont(.callout)
                    .foregroundStyle(.secondary)

                HStack(alignment: .top) {
                    TextField("person@example.com, someone@example.com", text: $emails, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(2...4)
                    Button(sendTitle) { sendInvites() }
                        .disabled(busy || parsed.isEmpty)
                }
            }

            if let error {
                Text(error).flowFont(.callout).foregroundStyle(.red)
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
            Text("Share a join link").flowFont(.headline)
            Text("Anyone with this link can join the workspace. It stays valid until you regenerate or revoke it.")
                .flowFont(.callout)
                .foregroundStyle(.secondary)

            if let joinUrl {
                HStack {
                    Text(joinUrl)
                        .flowFont(.callout, design: .monospaced)
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
                Text(joinError).flowFont(.callout).foregroundStyle(.red)
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

    /// One row per address, in the order they were typed. Only an address the
    /// email could not reach shows a link — the rest were delivered, and five
    /// links for five successes is noise.
    private func resultsSection(_ results: [InviteResult]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(results, id: \.email) { result in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Image(systemName: result.status.isDelivered ? "checkmark.circle.fill" : "exclamationmark.circle")
                            .foregroundStyle(result.status.isDelivered ? Color.green : (result.status.isFailure ? .red : .secondary))
                        Text(result.email).flowFont(.callout).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Text(result.status.label)
                            .flowFont(.caption)
                            .foregroundStyle(result.status.isFailure ? Color.red : .secondary)
                    }
                    if result.status == .emailFailed, let url = result.inviteUrl {
                        HStack {
                            Text(url)
                                .flowFont(.caption, design: .monospaced)
                                .textSelection(.enabled)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(url, forType: .string)
                                copiedUrl = url
                            } label: {
                                Label(copiedUrl == url ? "Copied" : "Copy", systemImage: copiedUrl == url ? "checkmark" : "doc.on.doc")
                            }
                        }
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(.quaternary.opacity(0.5)))
            }
        }
    }

    private var parsed: [String] { InviteAddresses.parse(emails) }

    private var sendTitle: String { parsed.count > 1 ? "Send \(parsed.count) Invites" : "Send Invites" }

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
}

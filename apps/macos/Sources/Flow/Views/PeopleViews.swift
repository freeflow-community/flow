import AppKit
import SwiftUI

// MARK: - New DM

struct NewDMSheet: View {
    let workspaceId: String
    let members: [MemberInfo]
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var busy = false
    @State private var error: String?

    private var others: [MemberInfo] {
        members.filter { $0.userId != app.currentUser?.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("New Direct Message").flowFont(.headline)
            Text("Pick one person for a DM, several for a group DM (max 8).")
                .flowFont(.caption)
                .foregroundStyle(.secondary)
            List(others) { member in
                Toggle(isOn: Binding(
                    get: { selected.contains(member.userId) },
                    set: { on in
                        if on { selected.insert(member.userId) } else { selected.remove(member.userId) }
                    }
                )) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(app.presence[member.userId] == true ? .green : Color.gray.opacity(0.5))
                            .frame(width: 8, height: 8)
                        Text(member.displayName + (member.isAgent == true ? " 🤖" : ""))
                    }
                }
                .accessibilityIdentifier("newdm.member.\(member.displayName)")
            }
            .frame(minHeight: 180, maxHeight: 260)
            if let error {
                Text(error).flowFont(.callout).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Start") {
                    busy = true
                    error = nil
                    Task {
                        defer { busy = false }
                        do {
                            let ch = try await app.engine.createDm(
                                workspaceId: workspaceId, userIds: Array(selected)
                            )
                            dismiss()
                            win.selectChannel(ch.id)
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || selected.isEmpty || selected.count > 8)
                .accessibilityIdentifier("newdm.start")
            }
        }
        .padding(20)
        .frame(width: 380)
    }
}

// MARK: - Invite to channel

struct AddMemberSheet: View {
    let channel: Channel
    let members: [MemberInfo]
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss
    @State private var busy: Set<String> = []
    @State private var added: Set<String> = []
    @State private var error: String?

    private var candidates: [MemberInfo] {
        members.filter { $0.userId != app.currentUser?.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Invite to #\(channel.name ?? "")").flowFont(.headline)
            List(candidates) { member in
                HStack(spacing: 6) {
                    Text(member.displayName + (member.isAgent == true ? " 🤖" : ""))
                    Spacer()
                    if added.contains(member.userId) {
                        Image(systemName: "checkmark")
                            .foregroundStyle(.green)
                    } else {
                        Button("Add") {
                            busy.insert(member.userId)
                            Task {
                                defer { busy.remove(member.userId) }
                                do {
                                    try await app.engine.addMember(
                                        channelId: channel.id, userId: member.userId
                                    )
                                    added.insert(member.userId)
                                } catch {
                                    self.error = error.localizedDescription
                                }
                            }
                        }
                        .disabled(busy.contains(member.userId))
                        .accessibilityIdentifier("invitechannel.add.\(member.displayName)")
                    }
                }
            }
            .frame(minHeight: 160, maxHeight: 240)
            if let error {
                Text(error).flowFont(.callout).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 360)
    }
}

// MARK: - Member profile

struct MemberProfileSheet: View {
    let userId: String
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss
    @State private var user: User?
    @State private var sponsor: User?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 12) {
            avatar
            Text(user.map(\.displayNameWithBadge) ?? "…")
                .flowFont(.title3, weight: .bold)
                .accessibilityIdentifier("profile.name")
            if user?.isAgent == true {
                Text("AI agent").flowFont(.caption).foregroundStyle(.secondary)
            }
            if let sponsor {
                sponsorRow(sponsor)
            }
            if let email = user?.email {
                Text(email)
                    .flowFont(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            if let tz = user?.timezone {
                Text(localTimeLine(tz))
                    .flowFont(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("profile.localTime")
            }
            // #220: the server stores http(s) URLs only, but re-check the scheme
            // before making it tappable — never hand an arbitrary string to
            // `Link`. A value that fails shows as plain text.
            if let site = user?.website, !site.isEmpty {
                Group {
                    if let url = safeWebsiteURL(site) {
                        Link(site.replacingOccurrences(
                            of: "^https?://", with: "", options: [.regularExpression, .caseInsensitive]
                        ), destination: url)
                    } else {
                        Text(site).foregroundStyle(.secondary)
                    }
                }
                .flowFont(.callout)
                .lineLimit(1)
                .truncationMode(.middle)
                .accessibilityIdentifier("profile.website")
            }
            // Plain text, not markdown: SwiftUI Text renders it literally, and
            // the default wrapping keeps the author's line breaks.
            if let bio = user?.bio, !bio.isEmpty {
                Text(bio)
                    .flowFont(.callout)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("profile.bio")
            }
            if let error {
                Text(error).flowFont(.callout).foregroundStyle(.red)
            }
            HStack {
                if userId != app.currentUser?.id, let wsId = win.selectedWorkspaceId {
                    Button("Message") {
                        Task {
                            do {
                                let ch = try await app.engine.createDm(
                                    workspaceId: wsId, userIds: [userId]
                                )
                                dismiss()
                                win.selectChannel(ch.id)
                            } catch {
                                self.error = error.localizedDescription
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("profile.message")
                }
                Button("Close") { dismiss() }
            }
        }
        .padding(24)
        .frame(width: 300)
        .task {
            do {
                let u = try await app.engine.fetchUser(userId)
                user = u
                // Agents carry a human sponsor; show who it is (ui_nits).
                if u.isAgent == true, let sid = u.sponsorId {
                    sponsor = try? await app.engine.fetchUser(sid)
                }
            } catch { self.error = error.localizedDescription }
        }
    }

    /// "Sponsored by <name>" chip for an agent's card.
    private func sponsorRow(_ s: User) -> some View {
        HStack(spacing: 6) {
            Text("Sponsored by").flowFont(.caption).foregroundStyle(.secondary)
            Group {
                if let path = s.avatarUrl, path.hasPrefix("/v1/avatars/") {
                    AuthImage(path: path) { Circle().fill(.secondary.opacity(0.2)) }
                        .scaledToFill()
                        .frame(width: 18, height: 18)
                        .clipShape(Circle())
                } else {
                    Circle().fill(.secondary.opacity(0.2)).frame(width: 18, height: 18)
                }
            }
            Text(s.displayName).flowFont(.callout, weight: .semibold)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(.secondary.opacity(0.12)))
        .accessibilityIdentifier("profile.sponsor")
    }

    private var avatar: some View {
        Group {
            if let path = user?.avatarUrl, path.hasPrefix("/v1/avatars/") {
                AuthImage(path: path) {
                    Circle().fill(.secondary.opacity(0.2))
                }
                .scaledToFill()
                .frame(width: 72, height: 72)
                .clipShape(Circle())
            } else {
                Circle()
                    .fill(.secondary.opacity(0.2))
                    .frame(width: 72, height: 72)
                    .overlay(
                        Text(initials)
                            .flowFont(.title2, weight: .bold)
                            .foregroundStyle(.secondary)
                    )
            }
        }
    }

    private var initials: String {
        let parts = (user?.displayName ?? "?").split(separator: " ")
        let chars = parts.prefix(2).compactMap(\.first)
        return chars.isEmpty ? "?" : String(chars).uppercased()
    }

    private func localTimeLine(_ tzName: String) -> String {
        guard let tz = TimeZone(identifier: tzName) else { return tzName }
        let fmt = DateFormatter()
        fmt.timeZone = tz
        fmt.timeStyle = .short
        fmt.dateStyle = .none
        return "\(fmt.string(from: Date())) local time (\(tzName))"
    }
}

// MARK: - My profile (edit)

struct MyProfileSheet: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss
    @State private var displayName = ""
    @State private var timezone = TimeZone.current.identifier
    @State private var website = ""
    @State private var bio = ""
    @State private var busy = false
    @State private var error: String?
    @State private var avatarBusy = false
    @State private var confirmDelete = false
    @State private var deleteBusy = false

    private static let timezones = TimeZone.knownTimeZoneIdentifiers.sorted()

    /// #220: the server accepts an absolute http(s) URL only, so say so here
    /// instead of letting Save come back with a validation error.
    private var trimmedWebsite: String { website.trimmingCharacters(in: .whitespaces) }
    private var websiteInvalid: Bool {
        !trimmedWebsite.isEmpty && safeWebsiteURL(trimmedWebsite) == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("My Profile").flowFont(.headline)

            HStack(spacing: 12) {
                avatar
                Button(avatarBusy ? "Uploading…" : "Change Avatar…") { pickAvatar() }
                    .disabled(avatarBusy)
                    .accessibilityIdentifier("profile.changeAvatar")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Display name").flowFont(.caption).foregroundStyle(.secondary)
                TextField("Display name", text: $displayName)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("profile.displayName")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Timezone").flowFont(.caption).foregroundStyle(.secondary)
                Picker("Timezone", selection: $timezone) {
                    ForEach(Self.timezones, id: \.self) { tz in
                        Text(tz).tag(tz)
                    }
                }
                .labelsHidden()
                .accessibilityIdentifier("profile.timezone")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Website").flowFont(.caption).foregroundStyle(.secondary)
                TextField("https://example.com", text: $website)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("profile.website")
                    .onChange(of: website) { _, new in
                        if new.count > profileWebsiteMax { website = String(new.prefix(profileWebsiteMax)) }
                    }
                if websiteInvalid {
                    Text("Must be a full link starting with http:// or https://")
                        .flowFont(.caption)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("profile.websiteError")
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("Bio").flowFont(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(bio.count)/\(profileBioMax)")
                        .flowFont(.caption)
                        .foregroundStyle(bio.count >= profileBioMax ? .red : .secondary)
                        .accessibilityIdentifier("profile.bioCount")
                }
                TextEditor(text: $bio)
                    .frame(height: 64)
                    .font(.body)
                    .border(.secondary.opacity(0.3))
                    .accessibilityIdentifier("profile.bio")
                    .onChange(of: bio) { _, new in
                        if new.count > profileBioMax { bio = String(new.prefix(profileBioMax)) }
                    }
            }

            if let error {
                Text(error).flowFont(.callout).foregroundStyle(.red)
            }

            HStack {
                // App Store 5.1.1(v) parity: the same self-service account
                // deletion the iOS app offers.
                Button(deleteBusy ? "Deleting…" : "Delete Account…", role: .destructive) {
                    confirmDelete = true
                }
                .disabled(deleteBusy || busy)
                .accessibilityIdentifier("profile.deleteAccount")
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") {
                    busy = true
                    error = nil
                    Task {
                        defer { busy = false }
                        do {
                            try await app.engine.updateProfile(
                                displayName: displayName.trimmingCharacters(in: .whitespaces),
                                timezone: timezone,
                                website: trimmedWebsite,
                                bio: bio
                            )
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    busy || displayName.trimmingCharacters(in: .whitespaces).isEmpty || websiteInvalid
                )
                .accessibilityIdentifier("profile.save")
            }
        }
        .padding(20)
        .frame(width: 380)
        .alert("Delete your account?", isPresented: $confirmDelete) {
            Button("Delete Account", role: .destructive) { deleteAccount() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Permanently deletes your account, removes you from every workspace, and frees your email address. It cannot be undone.")
        }
        .onAppear {
            displayName = app.currentUser?.displayName ?? ""
            timezone = app.currentUser?.timezone ?? TimeZone.current.identifier
            website = app.currentUser?.website ?? ""
            bio = app.currentUser?.bio ?? ""
        }
    }

    /// On success the engine's teardown flips the app to signed-out, which
    /// tears down this sheet with the rest of the signed-in UI.
    private func deleteAccount() {
        deleteBusy = true
        error = nil
        Task {
            defer { deleteBusy = false }
            do {
                try await app.engine.deleteAccount()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private var avatar: some View {
        Group {
            if let path = app.currentUser?.avatarUrl, path.hasPrefix("/v1/avatars/") {
                AuthImage(path: path) {
                    Circle().fill(.secondary.opacity(0.2))
                }
                .scaledToFill()
                .frame(width: 56, height: 56)
                .clipShape(Circle())
                .id(path) // refresh when the key changes
            } else {
                Circle()
                    .fill(.secondary.opacity(0.2))
                    .frame(width: 56, height: 56)
                    .overlay(Image(systemName: "person").foregroundStyle(.secondary))
            }
        }
    }

    private func pickAvatar() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.png, .jpeg, .gif, .webP]
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            avatarBusy = true
            Task { @MainActor in
                defer { avatarBusy = false }
                do {
                    try await app.engine.uploadAvatar(fileURL: url)
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

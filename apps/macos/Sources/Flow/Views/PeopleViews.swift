import AppKit
import SwiftUI

// MARK: - New DM

struct NewDMSheet: View {
    let workspaceId: String
    let members: [MemberInfo]
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var busy = false
    @State private var error: String?

    private var others: [MemberInfo] {
        members.filter { $0.userId != app.currentUser?.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("New Direct Message").font(.headline)
            Text("Pick one person for a DM, several for a group DM (max 8).")
                .font(.caption)
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
                Text(error).font(.callout).foregroundStyle(.red)
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
                            app.selectChannel(ch.id)
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
    @Environment(\.dismiss) private var dismiss
    @State private var busy: Set<String> = []
    @State private var added: Set<String> = []
    @State private var error: String?

    private var candidates: [MemberInfo] {
        members.filter { $0.userId != app.currentUser?.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Invite to #\(channel.name ?? "")").font(.headline)
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
                Text(error).font(.callout).foregroundStyle(.red)
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
    @Environment(\.dismiss) private var dismiss
    @State private var user: User?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 12) {
            avatar
            Text(user.map(\.displayNameWithBadge) ?? "…")
                .font(.title3.bold())
                .accessibilityIdentifier("profile.name")
            if user?.isAgent == true {
                Text("AI agent").font(.caption).foregroundStyle(.secondary)
            }
            if let email = user?.email {
                Text(email)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            if let tz = user?.timezone {
                Text(localTimeLine(tz))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("profile.localTime")
            }
            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            HStack {
                if userId != app.currentUser?.id, let wsId = app.selectedWorkspaceId {
                    Button("Message") {
                        Task {
                            do {
                                let ch = try await app.engine.createDm(
                                    workspaceId: wsId, userIds: [userId]
                                )
                                dismiss()
                                app.selectChannel(ch.id)
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
            do { user = try await app.engine.fetchUser(userId) }
            catch { self.error = error.localizedDescription }
        }
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
                            .font(.title2.bold())
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
    @Environment(\.dismiss) private var dismiss
    @State private var displayName = ""
    @State private var timezone = TimeZone.current.identifier
    @State private var busy = false
    @State private var error: String?
    @State private var avatarBusy = false

    private static let timezones = TimeZone.knownTimeZoneIdentifiers.sorted()

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("My Profile").font(.headline)

            HStack(spacing: 12) {
                avatar
                Button(avatarBusy ? "Uploading…" : "Change Avatar…") { pickAvatar() }
                    .disabled(avatarBusy)
                    .accessibilityIdentifier("profile.changeAvatar")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Display name").font(.caption).foregroundStyle(.secondary)
                TextField("Display name", text: $displayName)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("profile.displayName")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Timezone").font(.caption).foregroundStyle(.secondary)
                Picker("Timezone", selection: $timezone) {
                    ForEach(Self.timezones, id: \.self) { tz in
                        Text(tz).tag(tz)
                    }
                }
                .labelsHidden()
                .accessibilityIdentifier("profile.timezone")
            }

            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
            }

            HStack {
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
                                timezone: timezone
                            )
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || displayName.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("profile.save")
            }
        }
        .padding(20)
        .frame(width: 380)
        .onAppear {
            displayName = app.currentUser?.displayName ?? ""
            timezone = app.currentUser?.timezone ?? TimeZone.current.identifier
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

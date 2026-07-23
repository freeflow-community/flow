import SwiftUI
import GRDB

/// Sidebar equivalent: the active workspace's channels and DMs, plus a
/// workspace switcher and sign-out in the toolbar.
struct ChannelListView: View {
    /// Pushes a channel onto the stack owned by `MainView`. Joining or creating
    /// a channel drops you straight into it, the way the other clients select
    /// it in their sidebar.
    var onOpenChannel: (String) -> Void = { _ in }

    @EnvironmentObject var app: AppState
    @StateObject private var channels = DBObserved<[Channel]>(initial: [])
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])
    @StateObject private var users = DBObserved<[User]>(initial: [])
    @State private var joining: String?
    @State private var showCreate = false

    private var usersById: [String: User] { Dictionary(users.value.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var standard: [Channel] { channels.value.filter { $0.isMember && $0.kind == "standard" && $0.archivedAt == nil } }
    private var dms: [Channel] { channels.value.filter { $0.isMember && $0.isDM } }
    /// Public channels you're not in yet — same filter the macOS sidebar's
    /// Browse section uses. The server already drops archived channels and
    /// private ones you can't see, so this needs no extra guard.
    private var browsable: [Channel] { channels.value.filter { !$0.isMember && !$0.isPrivate && !$0.isDM } }
    private var workspaceName: String {
        workspaces.value.first { $0.id == app.selectedWorkspaceId }?.name ?? "Flow"
    }

    var body: some View {
        List {
            Section {
                activityRow
            }
            if !standard.isEmpty {
                Section("Channels") {
                    ForEach(standard) { ch in row(ch, title: "# \(ch.name ?? "channel")") }
                }
            }
            if !dms.isEmpty {
                Section("Direct Messages") {
                    ForEach(dms) { ch in
                        row(ch, title: ch.displayTitle(
                            userNames: usersById.mapValues { $0.displayNameWithBadge },
                            currentUserId: app.currentUser?.id))
                    }
                }
            }
            if !browsable.isEmpty {
                Section("Browse") {
                    ForEach(browsable) { ch in browseRow(ch) }
                }
            }
            if standard.isEmpty && dms.isEmpty && browsable.isEmpty {
                Text("No channels yet").foregroundStyle(MC.muted)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(workspaceName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    ForEach(workspaces.value) { ws in
                        Button {
                            app.selectWorkspace(ws.id)
                        } label: {
                            Label(ws.name, systemImage: ws.id == app.selectedWorkspaceId ? "checkmark" : "")
                        }
                    }
                } label: { Image(systemName: "square.grid.2x2") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showCreate = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityIdentifier("channel.create")
                .accessibilityLabel("New channel")
                .disabled(app.selectedWorkspaceId == nil)
            }
            ToolbarItem(placement: .topBarTrailing) {
                AccountToolbarButton()
            }
        }
        .sheet(isPresented: $showCreate) {
            if let wsId = app.selectedWorkspaceId {
                NewChannelSheet(workspaceId: wsId, onCreated: onOpenChannel)
            }
        }
        .task {
            users.start(db: app.db) { try User.fetchAll($0) }
            reloadChannels()
        }
        .onChange(of: app.selectedWorkspaceId) { _, _ in reloadChannels() }
    }

    private func reloadChannels() {
        guard let wsId = app.selectedWorkspaceId else { return }
        // Non-member rows are kept too — they're what the Browse section shows.
        // `refreshChannels` already caches every channel the server lets this
        // user see, so browsing needs no extra fetch.
        channels.start(db: app.db, reset: []) { db in
            try Channel
                .filter(Column("workspaceId") == wsId)
                .order(Column("name"))
                .fetchAll(db)
        }
        workspaces.start(db: app.db) { try Workspace.order(Column("name")).fetchAll($0) }
    }

    /// A channel you're not in: no NavigationLink, since the server refuses
    /// message reads until you've joined. Tapping Join enrolls you and pushes
    /// the channel, after which it moves up into the Channels section.
    @ViewBuilder
    private func browseRow(_ ch: Channel) -> some View {
        HStack {
            Text("# \(ch.name ?? "channel")")
                .foregroundStyle(MC.muted)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button("Join") { join(ch) }
                .buttonStyle(.borderless)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(MC.accentSoft)
                .disabled(joining != nil)
                .accessibilityIdentifier("channel.join.\(ch.name ?? "")")
        }
    }

    private func join(_ ch: Channel) {
        joining = ch.id
        Task {
            defer { joining = nil }
            do {
                let joined = try await app.engine.joinChannel(ch.id)
                onOpenChannel(joined.id)
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }

    /// The always-present Activity feed entry (phase 12) — a virtual route (no
    /// real channel) carrying the notification unread badge. Pushes the feed
    /// onto the stack `MainView` owns.
    @ViewBuilder
    private var activityRow: some View {
        NavigationLink(value: MainView.activityRoute) {
            HStack {
                Image(systemName: app.notificationUnread > 0 ? "bell.badge" : "bell")
                    .foregroundStyle(MC.accentSoft)
                    .frame(width: 22)
                Text("Activity").foregroundStyle(MC.ink)
                Spacer()
                if app.notificationUnread > 0 {
                    Text("\(min(app.notificationUnread, 99))")
                        .font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(MC.unread))
                }
            }
        }
        .accessibilityIdentifier("sidebar.activity")
    }

    @ViewBuilder
    private func row(_ ch: Channel, title: String) -> some View {
        NavigationLink(value: ch.id) {
            HStack {
                Text(title).foregroundStyle(MC.ink).lineLimit(1)
                Spacer()
                if ch.unreadCount > 0 {
                    Text("\(ch.unreadCount)")
                        .font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(MC.unread))
                }
            }
        }
    }
}

/// Create-channel form, the iOS counterpart of macOS's `CreateChannelSheet`.
/// Name normalization matches it exactly (lowercased, spaces to dashes) so the
/// two clients can't produce differently-shaped names.
struct NewChannelSheet: View {
    let workspaceId: String
    let onCreated: (String) -> Void

    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var topic = ""
    @State private var isPrivate = false
    @State private var busy = false
    @State private var error: String?

    private var normalized: String {
        name.trimmingCharacters(in: .whitespaces)
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("general", text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("newChannel.name")
                    if !normalized.isEmpty, normalized != name {
                        Text("Will be created as #\(normalized)")
                            .font(.caption)
                            .foregroundStyle(MC.faint)
                    }
                }
                Section("Topic") {
                    TextField("Optional", text: $topic)
                        .accessibilityIdentifier("newChannel.topic")
                }
                Section {
                    Toggle("Private channel", isOn: $isPrivate)
                        .accessibilityIdentifier("newChannel.private")
                } footer: {
                    Text("Private channels are visible only to people who are invited.")
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("New Channel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Create") { create() }
                        .disabled(busy || normalized.isEmpty)
                        .accessibilityIdentifier("newChannel.create")
                }
            }
        }
    }

    private func create() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let ch = try await app.engine.createChannel(
                    workspaceId: workspaceId,
                    name: normalized,
                    topic: topic.isEmpty ? nil : topic,
                    isPrivate: isPrivate
                )
                dismiss()
                onCreated(ch.id)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

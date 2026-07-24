import SwiftUI
import GRDB

/// iOS port of the web mobile drawer (and the macOS `SidebarView`): the
/// slide-in overlay that holds the workspace rail plus the active workspace's
/// channel/DM list, layered over a dimmed conversation. Mirrors the design-3a
/// violet sidebar — a workspace-colored gradient, section headers, unread
/// badges, presence dots — and a profile/status footer pinned to the bottom.
///
/// Selecting anything (channel, DM, activity) drives `AppState` the same way
/// macOS does, then calls `onSelect` so `MainView` can close the drawer and let
/// the conversation take the full screen (matching the web's mobile behavior).
struct SidebarDrawer: View {
    /// Called after a selection so the host can dismiss the drawer.
    var onSelect: () -> Void = {}

    @EnvironmentObject private var app: AppState
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])
    @StateObject private var channels = DBObserved<[Channel]>(initial: [])
    @StateObject private var users = DBObserved<[User]>(initial: [])

    @State private var showCreateChannel = false
    @State private var showAddWorkspace = false
    /// One-shot guard so the persistent self-DM upsert fires once per workspace.
    @State private var ensuredSelfDmWs: String?

    private var usersById: [String: User] {
        Dictionary(users.value.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }
    private var userNames: [String: String] {
        usersById.mapValues { $0.displayNameWithBadge }
    }

    private var currentWorkspace: Workspace? {
        workspaces.value.first { $0.id == app.selectedWorkspaceId }
    }
    private var palette: SidebarPalette {
        SidebarPalette.palette(for: currentWorkspace?.sidebarColor)
    }

    private var standard: [Channel] {
        channels.value.filter { $0.isMember && !$0.isDM && $0.archivedAt == nil }
    }
    private var dms: [Channel] {
        // Direct messages sort alphabetically by display title, case-insensitive
        // (ui_nits — matches web/macOS). DM channels have a null `name`, so sort
        // by the resolved member-name title rather than the channel row order.
        // The self-DM ("<you> (you)") is a scratchpad, not a conversation — it's
        // always pinned to the bottom regardless of name.
        let me = app.currentUser?.id
        let names = userNames
        func isSelf(_ c: Channel) -> Bool {
            c.kind == "dm" && (c.memberIds ?? []).allSatisfy { $0 == me }
        }
        return channels.value
            .filter { $0.isMember && $0.isDM }
            .sorted {
                if isSelf($0) != isSelf($1) { return !isSelf($0) }
                return $0.displayTitle(userNames: names, currentUserId: me)
                    .localizedCaseInsensitiveCompare(
                        $1.displayTitle(userNames: names, currentUserId: me)
                    ) == .orderedAscending
            }
    }
    private var browsable: [Channel] {
        channels.value.filter { !$0.isMember && !$0.isPrivate && !$0.isDM }
    }

    var body: some View {
        HStack(spacing: 0) {
            WorkspaceRail(
                workspaces: workspaces.value,
                palette: palette,
                onAdd: { showAddWorkspace = true }
            )
            sidebar
        }
        // Bleed the rail + gradient under the status bar and home indicator so
        // the drawer reads as one full-height panel; the columns' own content
        // stays within the safe area.
        .background(alignment: .leading) {
            HStack(spacing: 0) {
                palette.rail.frame(width: 64)
                palette.gradient
            }
            .ignoresSafeArea()
        }
        .task {
            workspaces.start(db: app.db) { db in
                try Workspace.order(Column("name").collating(.nocase)).fetchAll(db)
            }
            users.start(db: app.db) { try User.fetchAll($0) }
            reloadChannels()
        }
        .onChange(of: app.selectedWorkspaceId) { _, _ in reloadChannels() }
        // Default channel + persistent self-DM (macOS SidebarView parity): a
        // workspace opened with nothing selected lands on #general; every
        // workspace gets a "<Name> (you)" DM (idempotent server upsert).
        .onChange(of: channels.value) { _, chans in defaultSelectionAndSelfDm(chans) }
        .sheet(isPresented: $showCreateChannel) {
            if let wsId = app.selectedWorkspaceId {
                NewChannelSheet(workspaceId: wsId, onCreated: { open($0) })
            }
        }
        .sheet(isPresented: $showAddWorkspace) { AddWorkspaceSheet() }
    }

    // MARK: - Sidebar column

    private var sidebar: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 14)
                .padding(.top, 14)
                .padding(.bottom, 6)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    activityRow

                    sectionHeader("Channels") {
                        Button {
                            showCreateChannel = true
                        } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.6))
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("channel.create")
                        .accessibilityLabel("New channel")
                    }
                    ForEach(standard) { channelRow($0) }

                    if !dms.isEmpty {
                        sectionHeader("Direct Messages") { EmptyView() }
                        ForEach(dms) { dmRow($0) }
                    }

                    if !browsable.isEmpty {
                        sectionHeader("Browse") { EmptyView() }
                        ForEach(browsable) { browseRow($0) }
                    }

                    if standard.isEmpty && dms.isEmpty && browsable.isEmpty {
                        Text("No channels yet")
                            .font(.system(size: 14))
                            .foregroundStyle(.white.opacity(0.6))
                            .padding(.horizontal, 8)
                            .padding(.top, 8)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 10)
            }

            DrawerStatusFooter(palette: palette)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(palette.gradient)
    }

    // MARK: - Header

    private var header: some View {
        Menu {
            ForEach(workspaces.value) { ws in
                Button {
                    app.selectWorkspace(ws.id)
                } label: {
                    if ws.id == app.selectedWorkspaceId {
                        Label(ws.name, systemImage: "checkmark")
                    } else {
                        Text(ws.name)
                    }
                }
            }
            Divider()
            Button("Add Workspace…") { showAddWorkspace = true }
        } label: {
            HStack(spacing: 4) {
                Text(currentWorkspace?.name ?? "Flow")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("sidebar.workspaceMenu")
    }

    private func sectionHeader(_ label: String, @ViewBuilder action: () -> some View) -> some View {
        HStack {
            Text(label.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(0.7)
                .foregroundStyle(.white.opacity(0.55))
            Spacer()
            action()
        }
        .padding(.horizontal, 8)
        .padding(.top, 14)
        .padding(.bottom, 3)
    }

    // MARK: - Rows

    private func rowBackground(_ active: Bool) -> some View {
        RoundedRectangle(cornerRadius: 8).fill(active ? Color.white : Color.clear)
    }

    /// The always-present Activity feed row (phase 12) — a virtual, client-only
    /// entry carrying the notification unread badge.
    private var activityRow: some View {
        let active = app.showActivity
        let unread = app.notificationUnread
        return Button {
            app.showActivityFeed()
            onSelect()
        } label: {
            HStack(spacing: 9) {
                Image(systemName: unread > 0 ? "bell.badge" : "bell")
                    .font(.system(size: 15))
                    .foregroundStyle(active ? MC.accentDeep.opacity(0.7) : .white.opacity(0.6))
                    .frame(width: 18)
                Text("Activity")
                    .font(.system(size: 15, weight: active || unread > 0 ? .semibold : .regular))
                    .foregroundStyle(active ? MC.accentDeep : .white.opacity(unread > 0 ? 1 : 0.82))
                Spacer(minLength: 0)
                if unread > 0 { unreadBadge(min(unread, 99)) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 9)
            .background(rowBackground(active))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.activity")
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }

    private func channelRow(_ channel: Channel) -> some View {
        let active = app.selectedChannelId == channel.id && !app.showActivity
        return Button {
            open(channel.id)
        } label: {
            HStack(spacing: 9) {
                Group {
                    if channel.isPrivate {
                        Image(systemName: "lock")
                    } else {
                        Text("#")
                    }
                }
                .font(.system(size: 15))
                .foregroundStyle(active ? MC.accentDeep.opacity(0.6) : .white.opacity(0.6))
                .frame(width: 18)
                Text(channel.name ?? "")
                    .font(.system(size: 15, weight: active || channel.unreadCount > 0 ? .semibold : .regular))
                    .foregroundStyle(active ? MC.accentDeep : .white.opacity(channel.unreadCount > 0 ? 1 : 0.82))
                    .lineLimit(1)
                if channel.notifyLevel == 0 {
                    Image(systemName: "bell.slash")
                        .font(.caption2)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.5) : .white.opacity(0.5))
                }
                Spacer(minLength: 0)
                if channel.unreadCount > 0 { unreadBadge(channel.unreadCount) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 9)
            .background(rowBackground(active))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.channel.\(channel.name ?? channel.id)")
        .accessibilityValue(channel.unreadCount > 0 ? "\(channel.unreadCount) unread" : "read")
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }

    private func dmRow(_ channel: Channel) -> some View {
        let title = channel.displayTitle(userNames: userNames, currentUserId: app.currentUser?.id)
        let active = app.selectedChannelId == channel.id && !app.showActivity
        let otherId = (channel.memberIds ?? []).first { $0 != app.currentUser?.id }
        let otherStatus = otherId.flatMap { usersById[$0] }
        return Button {
            open(channel.id)
        } label: {
            HStack(spacing: 9) {
                if channel.kind == "dm" {
                    // self-DM (no other member): online by definition
                    presenceDot(online: otherId.map { app.presence[$0] == true } ?? true)
                        .frame(width: 18)
                } else {
                    Image(systemName: "person.2")
                        .font(.caption)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.6) : .white.opacity(0.6))
                        .frame(width: 18)
                }
                Text(title)
                    .font(.system(size: 15, weight: active || channel.unreadCount > 0 ? .semibold : .regular))
                    .foregroundStyle(active ? MC.accentDeep : .white.opacity(channel.unreadCount > 0 ? 1 : 0.82))
                    .lineLimit(1)
                if channel.kind == "dm", let emoji = otherStatus?.statusEmoji, !emoji.isEmpty {
                    Text(emoji).font(.system(size: 15))
                }
                if channel.notifyLevel == 0 {
                    Image(systemName: "bell.slash")
                        .font(.caption2)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.5) : .white.opacity(0.5))
                }
                Spacer(minLength: 0)
                if channel.unreadCount > 0 { unreadBadge(channel.unreadCount) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 9)
            .background(rowBackground(active))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.dm.\(title.replacingOccurrences(of: " 🤖", with: ""))")
        .accessibilityValue(channel.unreadCount > 0 ? "\(channel.unreadCount) unread" : "read")
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }

    /// A public channel you're not in yet: tapping Join enrolls and opens it,
    /// after which it moves up into the Channels section.
    private func browseRow(_ channel: Channel) -> some View {
        HStack(spacing: 9) {
            Text("#")
                .font(.system(size: 15))
                .foregroundStyle(.white.opacity(0.6))
                .frame(width: 18)
            Text(channel.name ?? "")
                .font(.system(size: 15))
                .foregroundStyle(.white.opacity(0.7))
                .lineLimit(1)
            Spacer(minLength: 0)
            Button("Join") { join(channel) }
                .buttonStyle(.plain)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .accessibilityIdentifier("channel.join.\(channel.name ?? "")")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 9)
    }

    private func presenceDot(online: Bool) -> some View {
        Circle()
            .fill(online ? MC.online : Color.clear)
            .overlay(Circle().strokeBorder(online ? Color.clear : .white.opacity(0.4), lineWidth: 1.5))
            .frame(width: 8, height: 8)
    }

    private func unreadBadge(_ n: Int) -> some View {
        Text("\(n)")
            .font(.system(size: 11, weight: .bold))
            .padding(.horizontal, 7)
            .padding(.vertical, 1)
            .background(Capsule().fill(MC.unread))
            .foregroundStyle(.white)
    }

    // MARK: - Actions

    /// Select a channel and dismiss the drawer (the web mobile behavior).
    private func open(_ channelId: String) {
        app.selectChannel(channelId)
        onSelect()
    }

    private func join(_ channel: Channel) {
        Task {
            do {
                let joined = try await app.engine.joinChannel(channel.id)
                open(joined.id)
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }

    private func reloadChannels() {
        guard let wsId = app.selectedWorkspaceId else { return }
        // Non-member rows are kept too — they're what Browse shows.
        channels.start(db: app.db, reset: []) { db in
            try Channel
                .filter(Column("workspaceId") == wsId)
                .order(Column("name").collating(.nocase))
                .fetchAll(db)
        }
    }

    private func defaultSelectionAndSelfDm(_ chans: [Channel]) {
        guard let wsId = app.selectedWorkspaceId, !chans.isEmpty else { return }
        if app.selectedChannelId == nil && !app.showActivity {
            let target = chans.first { $0.isMember && $0.name == "general" }
                ?? chans.first { $0.isMember && !$0.isDM }
            if let target { app.selectChannel(target.id) }
        }
        if let me = app.currentUser?.id, ensuredSelfDmWs != wsId {
            ensuredSelfDmWs = wsId
            let hasSelfDm = chans.contains {
                $0.kind == "dm" && $0.isMember && ($0.memberIds ?? []).allSatisfy { $0 == me }
            }
            if !hasSelfDm {
                Task { _ = try? await app.engine.createDm(workspaceId: wsId, userIds: [me]) }
            }
        }
    }
}

/// The 64px workspace rail (web/macOS design column 1): the active workspace's
/// siblings as initial chips, plus a "+" that offers create/accept-invite.
private struct WorkspaceRail: View {
    let workspaces: [Workspace]
    let palette: SidebarPalette
    let onAdd: () -> Void

    @EnvironmentObject private var app: AppState

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 14) {
                ForEach(workspaces) { ws in
                    let active = ws.id == app.selectedWorkspaceId
                    Button {
                        if !active { app.selectWorkspace(ws.id) }
                    } label: {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(active ? Color.white : Color.white.opacity(0.15))
                            .frame(width: 40, height: 40)
                            .overlay(
                                Text(String(ws.name.prefix(1)).uppercased())
                                    .font(.system(size: 16, weight: .heavy))
                                    .foregroundStyle(active ? MC.accent : .white)
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("rail.workspace.\(ws.slug)")
                    .accessibilityLabel(ws.name)
                    .accessibilityAddTraits(active ? [.isSelected] : [])
                }
                Button(action: onAdd) {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4]))
                        .foregroundStyle(.white.opacity(0.4))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Image(systemName: "plus")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.7))
                        )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("rail.addWorkspace")
                .accessibilityLabel("Add a workspace")
            }
            .padding(.vertical, 16)
        }
        .frame(width: 64)
        .frame(maxHeight: .infinity)
        .background(palette.rail)
    }
}

/// Profile/status footer pinned to the drawer bottom (macOS `StatusFooterView`
/// parity). Reuses the existing `AccountSheet` for the status picker, profile,
/// and sign-out — tapping anywhere in the footer opens it.
private struct DrawerStatusFooter: View {
    let palette: SidebarPalette
    @EnvironmentObject private var app: AppState
    @State private var showAccount = false

    private var statusEmoji: String { app.currentUser?.statusEmoji ?? "" }
    private var statusText: String { app.currentUser?.statusText ?? "" }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(.white.opacity(0.14)).frame(height: 1)
            Button {
                showAccount = true
            } label: {
                HStack(spacing: 10) {
                    AvatarChip(
                        userId: app.currentUser?.id ?? "",
                        name: app.currentUser?.displayName ?? "?",
                        avatarPath: app.myAvatarPath,
                        size: 34,
                        radius: 10
                    )
                    .overlay(alignment: .bottomTrailing) {
                        if !statusEmoji.isEmpty {
                            Text(statusEmoji)
                                .font(.system(size: 11))
                                .frame(width: 20, height: 20)
                                .background(Circle().fill(palette.rail))
                                .overlay(Circle().strokeBorder(palette.bottom, lineWidth: 2))
                                .offset(x: 6, y: 6)
                        }
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 5) {
                            Text(app.currentUser?.displayName ?? "You")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Circle()
                                .fill(app.connection == .connected ? MC.online : .orange)
                                .frame(width: 6, height: 6)
                        }
                        Text(statusText.isEmpty ? "Set a status" : statusText)
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.up")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.55))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("sidebar.statusFooter")
        }
        .sheet(isPresented: $showAccount) { AccountSheet() }
    }
}

/// iOS workspace onboarding sheet: create a new workspace, or join one by
/// pasting an invite link/token. The macOS clients split these into two sheets;
/// on a phone they share one form reached from the rail's "+".
struct AddWorkspaceSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var slug = ""
    @State private var inviteToken = ""
    @State private var busy = false
    @State private var error: String?

    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }
    private var trimmedToken: String { inviteToken.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section("Join with an invite") {
                    TextField("flow://invite/… or token", text: $inviteToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("addWorkspace.inviteToken")
                    Button("Accept Invite") {
                        app.acceptInvite(trimmedToken)
                        dismiss()
                    }
                    .disabled(trimmedToken.isEmpty)
                    .accessibilityIdentifier("addWorkspace.accept")
                }

                Section("Create a workspace") {
                    TextField("Name (e.g. Acme Inc)", text: $name)
                        .accessibilityIdentifier("addWorkspace.name")
                        .onChange(of: name) { _, new in slug = Self.slugify(new) }
                    TextField("Slug (url-safe)", text: $slug)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("addWorkspace.slug")
                    Button("Create Workspace") { create() }
                        .disabled(busy || trimmedName.isEmpty || slug.isEmpty)
                        .accessibilityIdentifier("addWorkspace.create")
                }

                if let error {
                    Section { Text(error).font(.callout).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Add Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
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
                let ws = try await app.engine.createWorkspace(name: trimmedName, slug: slug)
                dismiss()
                app.selectWorkspace(ws.id)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// Mirror of macOS `CreateWorkspaceSheet.slugify`.
    static func slugify(_ s: String) -> String {
        s.lowercased()
            .map { $0.isLetter || $0.isNumber ? String($0) : "-" }
            .joined()
            .replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
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

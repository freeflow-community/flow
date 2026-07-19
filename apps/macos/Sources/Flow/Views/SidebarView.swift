import GRDB
import SwiftUI

/// Row model for the members section (member ⋈ user).
struct MemberInfo: Decodable, FetchableRecord, Equatable, Sendable, Identifiable {
    var userId: String
    var displayName: String
    var role: String
    var statusEmoji: String?
    var statusText: String?
    var id: String { userId }
}

/// Design 3a column 2: violet gradient channel/DM list with the profile footer.
struct SidebarView: View {
    @EnvironmentObject private var app: AppState
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])
    @StateObject private var channels = DBObserved<[Channel]>(initial: [])
    @StateObject private var members = DBObserved<[MemberInfo]>(initial: [])
    @StateObject private var userNames = DBObserved<[String: String]>(initial: [:])

    @State private var showCreateChannel = false
    @State private var showInvite = false
    @State private var showCreateWorkspace = false
    @State private var showAcceptInvite = false
    @State private var showNewDM = false
    @State private var showColorPicker = false
    @State private var addMemberChannel: Channel?
    @State private var profileUserId: String?
    @State private var ensuredSelfDmWs: String?

    private var currentWorkspace: Workspace? {
        workspaces.value.first { $0.id == app.selectedWorkspaceId }
    }

    private var palette: SidebarPalette {
        SidebarPalette.palette(for: currentWorkspace?.sidebarColor)
    }

    private var canEditWorkspace: Bool {
        currentWorkspace.map { $0.role == "owner" || $0.role == "admin" } ?? false
    }

    private var joinedChannels: [Channel] {
        channels.value.filter { $0.isMember && !$0.isDM }
    }

    private var dmChannels: [Channel] {
        channels.value.filter { $0.isMember && $0.isDM }
    }

    private var browsableChannels: [Channel] {
        channels.value.filter { !$0.isMember && !$0.isPrivate && !$0.isDM }
    }

    private var memberById: [String: MemberInfo] {
        Dictionary(uniqueKeysWithValues: members.value.map { ($0.userId, $0) })
    }

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 14)
                .padding(.top, 18)
                .padding(.bottom, 6)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    sectionHeader("Channels") {
                        Button {
                            showCreateChannel = true
                        } label: {
                            Image(systemName: "plus")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.55))
                        }
                        .buttonStyle(.plain)
                        .help("Create a channel")
                    }
                    ForEach(joinedChannels) { channel in
                        channelRow(channel)
                    }

                    sectionHeader("Direct messages") {
                        Button {
                            showNewDM = true
                        } label: {
                            Image(systemName: "square.and.pencil")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.55))
                        }
                        .buttonStyle(.plain)
                        .help("New direct message")
                        .accessibilityIdentifier("sidebar.newDM")
                    }
                    ForEach(dmChannels) { channel in
                        dmRow(channel)
                    }

                    if !browsableChannels.isEmpty {
                        sectionHeader("Browse") {}
                        ForEach(browsableChannels) { channel in
                            browseRow(channel)
                        }
                    }

                }
                .padding(.horizontal, 14)
                .padding(.bottom, 10)
            }

            StatusFooterView(palette: palette)
        }
        .background(palette.gradient)
        // Default channel + persistent self-DM (phase 3.5 fixes): a workspace
        // opened with nothing selected lands on #general; every workspace gets
        // a "<Name> (you)" DM (idempotent server upsert).
        .onChange(of: channels.value) { _, chans in
            guard let wsId = app.selectedWorkspaceId, !chans.isEmpty else { return }
            if app.selectedChannelId == nil {
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
        .task {
            workspaces.start(db: app.db) { db in
                try Workspace.order(Column("name").collating(.nocase)).fetchAll(db)
            }
            userNames.start(db: app.db, reset: [:]) { db in
                try Dictionary(
                    uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayName) }
                )
            }
        }
        .task(id: app.selectedWorkspaceId) {
            guard let wsId = app.selectedWorkspaceId else { return }
            channels.start(db: app.db, reset: []) { db in
                try Channel
                    .filter(Column("workspaceId") == wsId && Column("archivedAt") == nil)
                    .order(Column("name").collating(.nocase))
                    .fetchAll(db)
            }
            members.start(db: app.db, reset: []) { db in
                try MemberInfo.fetchAll(
                    db,
                    sql: """
                        SELECT m.userId AS userId, u.displayName AS displayName, m.role AS role,
                               u.statusEmoji AS statusEmoji, u.statusText AS statusText
                        FROM member m JOIN user u ON u.id = m.userId
                        WHERE m.workspaceId = ?
                        ORDER BY u.displayName COLLATE NOCASE
                        """,
                    arguments: [wsId]
                )
            }
        }
        .sheet(isPresented: $showCreateChannel) {
            if let wsId = app.selectedWorkspaceId {
                CreateChannelSheet(workspaceId: wsId)
            }
        }
        .sheet(isPresented: $showInvite) {
            if let wsId = app.selectedWorkspaceId {
                InviteSheetView(workspaceId: wsId)
            }
        }
        .sheet(isPresented: $showCreateWorkspace) { CreateWorkspaceSheet() }
        .sheet(isPresented: $showAcceptInvite) { AcceptInviteSheet() }
        .sheet(isPresented: $showNewDM) {
            if let wsId = app.selectedWorkspaceId {
                NewDMSheet(workspaceId: wsId, members: members.value)
            }
        }
        .sheet(isPresented: $showColorPicker) {
            if let ws = currentWorkspace {
                WorkspaceColorSheet(workspace: ws)
            }
        }
        .sheet(item: $addMemberChannel) { channel in
            AddMemberSheet(channel: channel, members: members.value)
        }
        .sheet(item: Binding(
            get: { profileUserId.map { ProfileTarget(userId: $0) } },
            set: { profileUserId = $0?.userId }
        )) { target in
            MemberProfileSheet(userId: target.userId)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            workspaceMenu
            Spacer()
        }
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

    private func channelRow(_ channel: Channel) -> some View {
        let active = app.selectedChannelId == channel.id
        return Button {
            app.selectChannel(channel.id)
        } label: {
            HStack(spacing: 9) {
                Group {
                    if channel.isPrivate {
                        Image(systemName: "lock")
                    } else {
                        Text("#")
                    }
                }
                .font(.system(size: 14))
                .foregroundStyle(active ? MC.accentDeep.opacity(0.6) : .white.opacity(0.6))
                .frame(width: 14)
                Text(channel.name ?? "")
                    .font(.system(size: 14, weight: active || channel.unreadCount > 0 ? .semibold : .regular))
                    .foregroundStyle(active ? MC.accentDeep : .white.opacity(channel.unreadCount > 0 ? 1 : 0.82))
                if channel.notifyLevel == 0 {
                    Image(systemName: "bell.slash")
                        .font(.caption2)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.5) : .white.opacity(0.5))
                }
                Spacer(minLength: 0)
                if channel.unreadCount > 0 {
                    unreadBadge(channel.unreadCount)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(rowBackground(active))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.channel.\(channel.name ?? channel.id)")
        .accessibilityValue(channel.unreadCount > 0 ? "\(channel.unreadCount) unread" : "read")
        .accessibilityAddTraits(active ? [.isSelected] : [])
        .contextMenu { channelMenu(channel) }
    }

    private func dmRow(_ channel: Channel) -> some View {
        let title = channel.displayTitle(
            userNames: userNames.value, currentUserId: app.currentUser?.id
        )
        let active = app.selectedChannelId == channel.id
        let otherId = (channel.memberIds ?? []).first { $0 != app.currentUser?.id }
        let otherStatus = otherId.flatMap { memberById[$0] }
        return Button {
            app.selectChannel(channel.id)
        } label: {
            HStack(spacing: 9) {
                if channel.kind == "dm" {
                    // self-DM (no other member): online by definition
                    presenceDot(online: otherId.map { app.presence[$0] == true } ?? true)
                        .frame(width: 14)
                } else {
                    Image(systemName: "person.2")
                        .font(.caption)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.6) : .white.opacity(0.6))
                        .frame(width: 14)
                }
                Text(title)
                    .font(.system(size: 14, weight: active || channel.unreadCount > 0 ? .semibold : .regular))
                    .foregroundStyle(active ? MC.accentDeep : .white.opacity(channel.unreadCount > 0 ? 1 : 0.82))
                    .lineLimit(1)
                if channel.kind == "dm", let emoji = otherStatus?.statusEmoji, !emoji.isEmpty {
                    Text(emoji)
                        .font(.system(size: 14))
                        .help(otherStatus?.statusText ?? "")
                }
                if channel.notifyLevel == 0 {
                    Image(systemName: "bell.slash")
                        .font(.caption2)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.5) : .white.opacity(0.5))
                }
                Spacer(minLength: 0)
                if channel.unreadCount > 0 {
                    unreadBadge(channel.unreadCount)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(rowBackground(active))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.dm.\(title)")
        .accessibilityValue(channel.unreadCount > 0 ? "\(channel.unreadCount) unread" : "read")
        .accessibilityAddTraits(active ? [.isSelected] : [])
        .contextMenu {
            if channel.kind == "dm" {
                Button("View Profile") {
                    profileUserId = otherId ?? app.currentUser?.id
                }
            }
            notifyMenu(channel)
            if channel.kind == "group_dm" {
                Button("Leave Conversation", role: .destructive) { leave(channel) }
            }
        }
    }

    private func browseRow(_ channel: Channel) -> some View {
        HStack(spacing: 9) {
            Text("#")
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.6))
                .frame(width: 14)
            Text(channel.name ?? "")
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.7))
            Spacer(minLength: 0)
            Button("Join") {
                Task {
                    do {
                        let ch = try await app.engine.joinChannel(channel.id)
                        app.selectChannel(ch.id)
                    } catch {
                        app.showError(error.localizedDescription)
                    }
                }
            }
            .buttonStyle(.plain)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.8))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
    }

    private func memberRow(_ member: MemberInfo) -> some View {
        Button {
            openDm(with: member.userId)
        } label: {
            HStack(spacing: 9) {
                presenceDot(online: app.presence[member.userId] == true)
                Text(member.displayName)
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.82))
                    .lineLimit(1)
                if let emoji = member.statusEmoji, !emoji.isEmpty {
                    Text(emoji)
                        .font(.system(size: 14))
                        .help(member.statusText ?? "")
                }
                if member.userId == app.currentUser?.id {
                    Text("(you)").font(.caption2).foregroundStyle(.white.opacity(0.55))
                }
                Spacer(minLength: 0)
                if member.role != "member" {
                    Text(member.role)
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.55))
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.member.\(member.displayName)")
        .accessibilityValue(app.presence[member.userId] == true ? "online" : "offline")
        .contextMenu {
            Button("View Profile") { profileUserId = member.userId }
        }
    }

    /// Member click (ruling 4): open (or create) the 1:1 DM with that user.
    /// Clicking yourself opens your self-DM.
    private func openDm(with userId: String) {
        guard let wsId = app.selectedWorkspaceId else { return }
        Task {
            do {
                let dm = try await app.engine.createDm(workspaceId: wsId, userIds: [userId])
                app.selectChannel(dm.id)
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }

    private func presenceDot(online: Bool) -> some View {
        Circle()
            .fill(online ? MC.online : Color.clear)
            .overlay(
                Circle().strokeBorder(online ? Color.clear : .white.opacity(0.4), lineWidth: 1.5)
            )
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

    // MARK: - Menus

    @ViewBuilder
    private func channelMenu(_ channel: Channel) -> some View {
        notifyMenu(channel)
        Divider()
        Button("Invite to Channel…") { addMemberChannel = channel }
        if channel.name != "general" {
            Button("Leave Channel", role: .destructive) { leave(channel) }
            Button("Archive Channel", role: .destructive) {
                Task {
                    do { try await app.engine.archiveChannel(channel.id) }
                    catch { app.showError(error.localizedDescription) }
                }
            }
        }
    }

    private func notifyMenu(_ channel: Channel) -> some View {
        Menu("Notifications") {
            notifyOption(channel, level: 1, label: "Mentions only (default)")
            notifyOption(channel, level: 2, label: "All messages")
            notifyOption(channel, level: 0, label: "Mute")
        }
    }

    private func notifyOption(_ channel: Channel, level: Int, label: String) -> some View {
        Button {
            Task { await app.engine.setNotifyLevel(channelId: channel.id, level: level) }
        } label: {
            if channel.notifyLevel == level {
                Label(label, systemImage: "checkmark")
            } else {
                Text(label)
            }
        }
    }

    private func leave(_ channel: Channel) {
        Task {
            do { try await app.engine.leaveChannel(channel.id) }
            catch { app.showError(error.localizedDescription) }
        }
    }

    private var workspaceMenu: some View {
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
            if canEditWorkspace {
                Button("Workspace Color…") { showColorPicker = true }
            }
            Button("Create Workspace…") { showCreateWorkspace = true }
            Button("Accept Invite…") { showAcceptInvite = true }
            Button("Invite People…") { showInvite = true }
            Divider()
            Button("All Workspaces") { app.selectWorkspace(nil) }
        } label: {
            HStack(spacing: 4) {
                Text(currentWorkspace?.name ?? "Workspace")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.55))
            }
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityIdentifier("sidebar.workspaceMenu")
    }
}

/// Profile footer pinned to the sidebar bottom; opens the status picker
/// (design 3a's core interaction).
struct StatusFooterView: View {
    /// Active workspace palette (badge ring matches the gradient bottom).
    var palette: SidebarPalette = SidebarPalette.palette(for: nil)
    @EnvironmentObject private var app: AppState
    @State private var showPicker = false
    @State private var showAvatarMenu = false
    @State private var showMyProfile = false
    @State private var busy = false

    private var statusEmoji: String { app.currentUser?.statusEmoji ?? "" }
    private var statusText: String { app.currentUser?.statusText ?? "" }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(.white.opacity(0.14)).frame(height: 1)
            HStack(spacing: 10) {
                // Ruling 1: the avatar is its own button — user-scoped menu
                // (profile / sign-out); the rest still opens the status picker.
                Button {
                    showAvatarMenu.toggle()
                } label: {
                    avatarWithBadge
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sidebar.avatarMenu")
                .popover(isPresented: $showAvatarMenu, arrowEdge: .top) {
                    avatarMenu
                }

                Button {
                    showPicker.toggle()
                } label: {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 5) {
                                Text(app.currentUser?.displayName ?? "You")
                                    .font(.system(size: 13.5, weight: .bold))
                                    .foregroundStyle(.white)
                                    .lineLimit(1)
                                Circle()
                                    .fill(app.connection == .connected ? MC.online : .orange)
                                    .frame(width: 6, height: 6)
                                    .help(app.connection.label)
                            }
                            Text(statusText.isEmpty ? "Set a status" : statusText)
                                .font(.system(size: 12))
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.down")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("sidebar.statusFooter")
                .accessibilityValue(
                    "\(app.connection.label); \(statusText.isEmpty ? "no status" : statusText)"
                )
                .popover(isPresented: $showPicker, arrowEdge: .top) {
                    statusPicker
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .sheet(isPresented: $showMyProfile) { MyProfileSheet() }
    }

    private var avatarMenu: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                showAvatarMenu = false
                showMyProfile = true
            } label: {
                Text("My Profile…")
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(MC.ink)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("avatarMenu.profile")
            Divider()
            Button {
                showAvatarMenu = false
                Task { await app.engine.logout() }
            } label: {
                Text("Sign Out")
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(MC.ink)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("avatarMenu.signOut")
        }
        .padding(8)
        .frame(width: 180)
        // .contain keeps the per-item ids visible in the AX tree (same
        // shadowing pattern as status.picker below).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("avatarMenu")
    }

    private var avatarWithBadge: some View {
        AvatarChip(
            userId: app.currentUser?.id ?? "",
            name: app.currentUser?.displayName ?? "?",
            avatarPath: app.currentUser.flatMap { app.avatarPaths[$0.id] },
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
    }

    private var statusPicker: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("SET YOUR STATUS")
                .font(.system(size: 11, weight: .bold))
                .tracking(0.55)
                .foregroundStyle(MC.muted)
                .padding(.horizontal, 8)
                .padding(.bottom, 4)
            ForEach(Array(MC.statusOptions.enumerated()), id: \.offset) { index, option in
                Button {
                    setStatus(option.emoji, option.text)
                } label: {
                    HStack(spacing: 8) {
                        Text(option.emoji)
                            .font(.system(size: 17))
                            .frame(width: 22)
                        Text(option.text)
                            .font(.system(size: 13.5, weight: .semibold))
                            .foregroundStyle(MC.ink)
                        Spacer(minLength: 0)
                        if option.emoji == statusEmoji, option.text == statusText {
                            Image(systemName: "checkmark")
                                .font(.caption)
                                .foregroundStyle(MC.accentSoft)
                        }
                    }
                    .padding(8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .accessibilityIdentifier("status.option.\(index + 1)")
            }
            Divider().padding(.vertical, 4)
            Button {
                setStatus("", "")
            } label: {
                Text("Clear status")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(MC.faint)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityIdentifier("status.clear")
        }
        .padding(12)
        .frame(width: 240)
        // .contain keeps the container id from shadowing the per-row
        // status.option.N / status.clear ids in the AX tree (QA run s143239
        // saw every row exposed as "status.picker" without this)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("status.picker")
    }

    private func setStatus(_ emoji: String, _ text: String) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await app.engine.setStatus(emoji: emoji, text: text)
                showPicker = false
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }
}

/// Identifiable wrapper so a user id can drive a sheet.
struct ProfileTarget: Identifiable {
    let userId: String
    var id: String { userId }
}

/// Owner/admin picker for the workspace's sidebar color preset (ruling 3).
/// Selecting a swatch PATCHes the workspace; the saved row + broadcast
/// restyle every client live.
struct WorkspaceColorSheet: View {
    let workspace: Workspace
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false

    private var currentId: String {
        SidebarPalette.palette(for: workspace.sidebarColor).id
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Workspace Color").font(.headline)
            Text("Applies to everyone in \(workspace.name).")
                .font(.caption)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(SidebarPalette.all) { palette in
                    swatch(palette)
                }
            }
            HStack {
                Spacer()
                Button("Close") { dismiss() }
            }
        }
        .padding(20)
        .frame(width: 340)
        // .contain so this container id doesn't shadow the color.swatch.<id>
        // ids in the AX tree (see status.picker).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.colorSheet")
    }

    private func swatch(_ palette: SidebarPalette) -> some View {
        let selected = palette.id == currentId
        return Button {
            pick(palette)
        } label: {
            VStack(spacing: 4) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(palette.gradient)
                    .frame(height: 44)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(
                                selected ? MC.accent : Color.black.opacity(0.1),
                                lineWidth: selected ? 2 : 1
                            )
                    )
                    .overlay {
                        if selected {
                            Image(systemName: "checkmark")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                Text(palette.name)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier("color.swatch.\(palette.id)")
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private func pick(_ palette: SidebarPalette) {
        guard palette.id != currentId else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                _ = try await app.engine.updateWorkspaceColor(
                    workspaceId: workspace.id, colorId: palette.id
                )
                dismiss()
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }
}

struct CreateChannelSheet: View {
    let workspaceId: String
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var topic = ""
    @State private var isPrivate = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Create Channel").font(.headline)
            TextField("Name (lowercase, a-z 0-9 - _)", text: $name)
                .textFieldStyle(.roundedBorder)
            TextField("Topic (optional)", text: $topic)
                .textFieldStyle(.roundedBorder)
            Toggle("Private channel", isOn: $isPrivate)
            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Create") {
                    busy = true
                    error = nil
                    Task {
                        defer { busy = false }
                        do {
                            let normalized = name.lowercased()
                                .replacingOccurrences(of: " ", with: "-")
                            let ch = try await app.engine.createChannel(
                                workspaceId: workspaceId,
                                name: normalized,
                                topic: topic.isEmpty ? nil : topic,
                                isPrivate: isPrivate
                            )
                            dismiss()
                            app.selectChannel(ch.id)
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 360)
    }
}

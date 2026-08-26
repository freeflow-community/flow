import AppKit
import GRDB
import SwiftUI

/// Row model for the members section (member ⋈ user).
struct MemberInfo: Decodable, FetchableRecord, Equatable, Sendable, Identifiable, WorkspaceRosterMember {
    var userId: String
    var displayName: String
    var role: String
    var statusEmoji: String?
    var statusText: String?
    var isAgent: Bool? // first-class AI agent → 🤖 badge
    var isBot: Bool? // app/integration bot — like an agent, not a person (#340)
    var id: String { userId }
}

extension MemberInfo: SidebarAgentMemberInfo {}

/// Design 3a column 2: violet gradient channel/DM list with the profile footer.
struct SidebarView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.textZoom) private var textZoom
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
    @State private var showFeatures = false
    @State private var showInviteAgent = false
    @State private var confirmLeaveWorkspace = false
    @State private var confirmDeleteWorkspace = false
    @State private var addMemberChannel: Channel?
    @State private var profileUserId: String?
    @State private var ensuredSelfDmWs: String?
    /// Agents section collapsed? Remembered per device, like the web sidebar's.
    @AppStorage("flow.sidebarAgentsCollapsed") private var agentsCollapsed = false

    private var currentWorkspace: Workspace? {
        workspaces.value.first { $0.id == win.selectedWorkspaceId }
    }

    private var palette: SidebarPalette {
        SidebarPalette.palette(for: currentWorkspace?.sidebarColor)
    }

    private var canEditWorkspace: Bool {
        currentWorkspace.map { $0.role == "owner" || $0.role == "admin" } ?? false
    }


    /// Which way out this workspace offers — see `WorkspaceExit`, which is
    /// shared with iOS and holds the "empty roster means don't know" rule.
    private var workspaceExit: WorkspaceExit {
        WorkspaceExit.offered(
            role: currentWorkspace?.role,
            roster: members.value,
            me: app.currentUser?.id
        )
    }

    /// Ids of the DMs I'm in — a sub-channel of one of these belongs to that
    /// conversation, so it renders under the DM row and never in Channels.
    private var joinedDmIds: Set<String> {
        Set(channels.value.filter { $0.isMember && $0.isDM }.map(\.id))
    }

    /// Joined standard channels in sidebar order — sub-channels (#118) follow
    /// their parent and render indented.
    private var joinedChannels: [(channel: Channel, isNested: Bool)] {
        let dmIds = joinedDmIds
        return Channel.nested(
            channels.value.filter { $0.isMember && !$0.isDM && !($0.parentId.map(dmIds.contains) ?? false) }
        )
    }

    /// Sub-channels hanging off a DM, keyed by that DM's id.
    private var dmChildren: [String: [Channel]] {
        let dmIds = joinedDmIds
        return Dictionary(
            grouping: channels.value.filter {
                $0.isMember && !$0.isDM && ($0.parentId.map(dmIds.contains) ?? false)
            },
            by: { $0.parentId! }
        )
    }

    /// Agents (#361) and the DMs left over once their 1:1s move up with them.
    private var agentSplit: (agents: [AgentSection.Entry<MemberInfo>], rest: [Channel]) {
        AgentSection.split(
            dms: channels.value.filter { $0.isMember && $0.isDM },
            members: members.value,
            currentUserId: app.currentUser?.id
        )
    }

    private var dmChannels: [Channel] {
        // Direct messages sort alphabetically by display title, case-insensitive
        // (ui_nits — matches web). The channels query orders by `name`, which is
        // null for DMs, so sort here by the resolved member-name title instead.
        // The self-DM ("<you> (you)") is a scratchpad, not a conversation — it's
        // always pinned to the bottom regardless of name.
        let me = app.currentUser?.id
        let names = userNames.value
        func isSelf(_ c: Channel) -> Bool {
            c.kind == "dm" && (c.memberIds ?? []).allSatisfy { $0 == me }
        }
        return agentSplit.rest
            .sorted {
                if isSelf($0) != isSelf($1) { return !isSelf($0) }
                return $0.displayTitle(userNames: names, currentUserId: me)
                    .localizedCaseInsensitiveCompare(
                        $1.displayTitle(userNames: names, currentUserId: me)
                    ) == .orderedAscending
            }
    }

    private var browsableChannels: [Channel] {
        channels.value.filter { !$0.isMember && !$0.isPrivate && !$0.isDM }
    }

    private var memberById: [String: MemberInfo] {
        Dictionary(uniqueKeysWithValues: members.value.map { ($0.userId, $0) })
    }

    /// The scrolling channel list. Extracted from `body` so the `ScrollViewReader`
    /// that wraps it (#319) doesn't re-indent the whole thing, and so the body
    /// stays cheap to type-check.
    private var channelList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
                activityRow

                sectionHeader("Channels") {
                    Button {
                        showCreateChannel = true
                    } label: {
                        Image(systemName: "plus")
                            .flowFont(.caption)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                    .buttonStyle(.plain)
                    .help("Create a channel")
                }
                ForEach(joinedChannels, id: \.channel.id) { row in
                    channelWithArtifacts(row.channel) {
                        channelRow(row.channel, isNested: row.isNested)
                    }
                }

                // Agents (#361): one row per workspace agent, between Channels
                // and Direct messages, whether or not a DM exists yet. An agent
                // with a DM brings it up here, so it is never listed twice.
                let agents = agentSplit.agents
                if !agents.isEmpty {
                    sectionHeader("Agents", collapsed: agentsCollapsed) {
                        agentsCollapsed.toggle()
                    } action: {
                        EmptyView()
                    }
                    if !agentsCollapsed {
                        ForEach(agents) { entry in
                            if let dm = entry.channel {
                                // The agent's own DM, rendered as the agent: same
                                // row as any DM, so unread badges, the
                                // working-here spinner and sub-channels come too.
                                channelWithArtifacts(dm) {
                                    dmRow(dm, label: entry.member.displayName)
                                }
                                ForEach(dmChildren[dm.id] ?? []) { child in
                                    channelWithArtifacts(child) { channelRow(child, isNested: true) }
                                }
                            } else {
                                agentRow(entry.member)
                            }
                        }
                    }
                }

                sectionHeader("Direct messages") {
                    Button {
                        showNewDM = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                            .flowFont(.caption)
                            .foregroundStyle(.white.opacity(0.55))
                    }
                    .buttonStyle(.plain)
                    .help("New direct message")
                    .accessibilityIdentifier("sidebar.newDM")
                }
                ForEach(dmChannels) { channel in
                    channelWithArtifacts(channel) { dmRow(channel) }
                    ForEach(dmChildren[channel.id] ?? []) { child in
                        channelWithArtifacts(child) { channelRow(child, isNested: true) }
                    }
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
    }

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 14)
                .padding(.top, 18)
                .padding(.bottom, 6)

            ScrollViewReader { scroll in
                channelList
                    // Arriving at a channel by any route other than clicking it
                    // here — a notification, a deep link, being added to a
                    // channel — left the sidebar wherever it was, so the row you
                    // just landed on could sit below the fold (#319). A nil
                    // anchor is SwiftUI's minimal scroll: a row already on
                    // screen does not move, which is why a plain sidebar click
                    // still never jumps.
                    //
                    // The hop to the next runloop is for the invite case: the
                    // new row and the new selection arrive in the same update,
                    // and the row has to exist in the lazy stack before it can
                    // be scrolled to.
                    .onChange(of: win.selectedChannelId) { _, id in
                        guard let id else { return }
                        DispatchQueue.main.async {
                            withAnimation(.easeOut(duration: 0.15)) {
                                scroll.scrollTo(AppState.sidebarRowID(id))
                            }
                        }
                    }
            }

            inviteAgentButton

            StatusFooterView(palette: palette)
        }
        .background(palette.gradient)
        // Default channel + persistent self-DM (phase 3.5 fixes): a workspace
        // opened with nothing selected lands on #general; every workspace gets
        // a "<Name> (you)" DM (idempotent server upsert).
        .onChange(of: channels.value) { _, chans in
            guard let wsId = win.selectedWorkspaceId, !chans.isEmpty else { return }
            if win.selectedChannelId == nil {
                let target = chans.first { $0.isMember && $0.name == "general" }
                    ?? chans.first { $0.isMember && !$0.isDM }
                if let target { win.selectChannel(target.id) }
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
                    uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayNameWithBadge) }
                )
            }
        }
        .task(id: win.selectedWorkspaceId) {
            guard let wsId = win.selectedWorkspaceId else { return }
            channels.start(db: app.db, reset: []) { db in
                try Channel
                    .filter(Column("workspaceId") == wsId && Column("archivedAt") == nil)
                    .order(Column("name").collating(.nocase))
                    .fetchAll(db)
            }
            // Fetch the roster directly rather than waiting for
            // `selectWorkspace`'s channels → members → artifacts chain to reach
            // it: the workspace menu decides between Leave and Delete from this
            // list, and an NSMenu snapshots its contents when it opens
            // (#340 follow-up).
            Task { await app.engine.refreshMembers(workspaceId: wsId) }
            members.start(db: app.db, reset: []) { db in
                try MemberInfo.fetchAll(
                    db,
                    sql: """
                        SELECT m.userId AS userId, u.displayName AS displayName, m.role AS role,
                               u.statusEmoji AS statusEmoji, u.statusText AS statusText,
                               u.isAgent AS isAgent, u.isBot AS isBot
                        FROM member m JOIN user u ON u.id = m.userId
                        WHERE m.workspaceId = ?
                        ORDER BY u.displayName COLLATE NOCASE
                        """,
                    arguments: [wsId]
                )
            }
        }
        .sheet(isPresented: $showCreateChannel) {
            if let wsId = win.selectedWorkspaceId {
                CreateChannelSheet(workspaceId: wsId)
            }
        }
        .sheet(isPresented: $showInvite) {
            if let wsId = win.selectedWorkspaceId {
                InviteSheetView(workspaceId: wsId)
            }
        }
        .sheet(isPresented: $showCreateWorkspace) { CreateWorkspaceSheet() }
        .sheet(isPresented: $showAcceptInvite) { AcceptInviteSheet() }
        .sheet(isPresented: $showNewDM) {
            if let wsId = win.selectedWorkspaceId {
                NewDMSheet(workspaceId: wsId, members: members.value)
            }
        }
        .sheet(isPresented: $showColorPicker) {
            if let ws = currentWorkspace {
                WorkspaceColorSheet(workspace: ws)
            }
        }
        .sheet(isPresented: $showFeatures) { FeaturesView() }
        .confirmationDialog(
            "Leave \(currentWorkspace?.name ?? "workspace")?",
            isPresented: $confirmLeaveWorkspace,
            titleVisibility: .visible
        ) {
            Button("Leave Workspace", role: .destructive) { leaveWorkspace() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll lose access to all its channels. Your past messages will remain.")
        }
        .confirmationDialog(
            "Delete \(currentWorkspace?.name ?? "workspace")?",
            isPresented: $confirmDeleteWorkspace,
            titleVisibility: .visible
        ) {
            Button("Delete Workspace", role: .destructive) { deleteWorkspace() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "You're the only one left, so there's nobody to hand it to. "
                    + "Deleting removes the workspace and every channel, message and file in it, "
                    + "for good. This cannot be undone."
            )
        }
        .sheet(isPresented: $showInviteAgent) {
            if let wsId = win.selectedWorkspaceId {
                InviteAgentSheetView(workspaceId: wsId)
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

    /// Invite your Agent (phase 15, web parity): pinned above the profile
    /// footer — a slightly raised translucent CTA, noticeable without shouting.
    private var inviteAgentButton: some View {
        Button {
            showInviteAgent = true
        } label: {
            HStack(spacing: 7) {
                Text("🤖")
                Text("Invite your Agent")
                    .flowFont(size: 13, weight: .semibold)
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(.white.opacity(0.18))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(.white.opacity(0.35)))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(win.selectedWorkspaceId == nil)
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .accessibilityIdentifier("sidebar.inviteAgent")
    }

    /// A section title, optionally a collapse toggle (#361): pass `collapsed`
    /// and `onToggle` and the label becomes a button with a disclosure chevron.
    private func sectionHeader(
        _ label: String,
        collapsed: Bool? = nil,
        onToggle: (() -> Void)? = nil,
        @ViewBuilder action: () -> some View
    ) -> some View {
        HStack {
            if let collapsed, let onToggle {
                Button(action: onToggle) {
                    HStack(spacing: 3) {
                        Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                            .flowFont(size: 8, weight: .semibold)
                        Text(label.uppercased())
                            .flowFont(size: 11, weight: .semibold)
                            .tracking(0.7)
                    }
                    .foregroundStyle(.white.opacity(0.55))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(collapsed ? "Show \(label)" : "Hide \(label)")
                .accessibilityIdentifier("sidebar.section.\(label.lowercased())")
                .accessibilityValue(collapsed ? "collapsed" : "expanded")
            } else {
                Text(label.uppercased())
                    .flowFont(size: 11, weight: .semibold)
                    .tracking(0.7)
                    .foregroundStyle(.white.opacity(0.55))
            }
            Spacer()
            action()
        }
        .padding(.horizontal, 8)
        .padding(.top, 14)
        .padding(.bottom, 3)
    }

    // MARK: - Rows

    /// "Someone is working in here" (#137) — a small ring after the channel
    /// label while an agent has this channel's indicator set. Quiet on purpose:
    /// no colour of its own, and it stops turning when the system is set to
    /// reduce motion (the ring alone still reads as busy).
    private struct ActivitySpinner: View {
        let active: Bool
        @Environment(\.accessibilityReduceMotion) private var reduceMotion
        @State private var spinning = false

        var body: some View {
            Circle()
                .trim(from: 0, to: 0.7)
                .stroke(
                    (active ? MC.accentDeep : Color.white).opacity(0.55),
                    style: StrokeStyle(lineWidth: 1.5, lineCap: .round)
                )
                .frame(width: 11, height: 11)
                .rotationEffect(.degrees(spinning ? 360 : 0))
                .animation(
                    reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false),
                    value: spinning
                )
                .onAppear { spinning = true }
                .help("an agent is working in this channel")
                .accessibilityHidden(true) // the row's own label already says enough
        }
    }

    private func rowBackground(_ active: Bool) -> some View {
        RoundedRectangle(cornerRadius: 8).fill(active ? Color.white : Color.clear)
    }

    /// The always-present Activity feed row (phase 12) — a virtual, client-only
    /// entry (no real channel). Carries the notification unread badge that used
    /// to live on the toolbar bell.
    private var activityRow: some View {
        let active = win.showActivity
        let unread = app.notificationUnread(workspaceId: win.selectedWorkspaceId)
        return Button {
            win.showActivityFeed()
        } label: {
            HStack(spacing: 9) {
                Image(systemName: unread > 0 ? "bell.badge" : "bell")
                    .flowFont(size: 13)
                    .foregroundStyle(active ? MC.accentDeep.opacity(0.7) : .white.opacity(0.6))
                    .frame(width: 14)
                Text("Activity")
                    .flowFont(size: 14, weight: active || unread > 0 ? .semibold : .regular)
                    .foregroundStyle(active ? MC.accentDeep : .white.opacity(unread > 0 ? 1 : 0.82))
                Spacer(minLength: 0)
                if unread > 0 {
                    unreadBadge(min(unread, 99))
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(rowBackground(active))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.activity")
        .accessibilityValue(unread > 0 ? "\(unread) unread" : "read")
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }

    private func channelRow(_ channel: Channel, isNested: Bool = false) -> some View {
        let active = AppState.channelRowHighlighted(
            rowId: channel.id, selectedChannelId: win.selectedChannelId,
            selectedArtifactId: win.selectedArtifactId, showActivity: win.showActivity
        )
        return Button {
            win.selectChannel(channel.id)
        } label: {
            HStack(spacing: 9) {
                Group {
                    if channel.isPrivate {
                        Image(systemName: "lock")
                    } else {
                        Text("#")
                    }
                }
                .flowFont(size: 14)
                .foregroundStyle(active ? MC.accentDeep.opacity(0.6) : .white.opacity(0.6))
                .frame(width: 14)
                Text(channel.name ?? "")
                    .flowFont(size: 14, weight: active || channel.unreadCount > 0 ? .semibold : .regular)
                    .foregroundStyle(active ? MC.accentDeep : .white.opacity(channel.unreadCount > 0 ? 1 : 0.82))
                // An agent working here (#137) — DMs included: talking to an
                // agent one-to-one is the common case.
                if app.busyChannelIds.contains(channel.id) {
                    ActivitySpinner(active: active)
                }
                if channel.notifyLevel == 0 {
                    Image(systemName: "bell.slash")
                        .flowFont(.caption2)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.5) : .white.opacity(0.5))
                }
                Spacer(minLength: 0)
                // A number means "this needs you" — unread notifications, not
                // unread messages (operator ruling 2026-07-26). Messages only
                // embolden the row, above.
                if channel.unreadNotifications > 0 {
                    unreadBadge(channel.unreadNotifications)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(rowBackground(active))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Indent outside the background so the pill insets with the row rather
        // than the label sliding around inside a full-width pill.
        .padding(.leading, isNested ? 12 : 0)
        .id(AppState.sidebarRowID(channel.id))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.channel.\(channel.name ?? channel.id)")
        .accessibilityValue(channel.unreadCount > 0 ? "\(channel.unreadCount) unread" : "read")
        .accessibilityAddTraits(active ? [.isSelected] : [])
        .contextMenu { channelMenu(channel) }
    }

    /// `label` overrides the resolved DM title — the Agents section (#361)
    /// passes the agent's plain name, since a 🤖 badge under a header that
    /// already says AGENTS is noise.
    private func dmRow(_ channel: Channel, label: String? = nil) -> some View {
        let title = label ?? channel.displayTitle(
            userNames: userNames.value, currentUserId: app.currentUser?.id
        )
        let active = AppState.channelRowHighlighted(
            rowId: channel.id, selectedChannelId: win.selectedChannelId,
            selectedArtifactId: win.selectedArtifactId, showActivity: win.showActivity
        )
        let otherId = (channel.memberIds ?? []).first { $0 != app.currentUser?.id }
        let otherStatus = otherId.flatMap { memberById[$0] }
        return Button {
            win.selectChannel(channel.id)
        } label: {
            HStack(spacing: 9) {
                if channel.kind == "dm" {
                    // self-DM (no other member): online by definition
                    presenceDot(online: otherId.map { app.presence[$0] == true } ?? true)
                        .frame(width: 14)
                } else {
                    Image(systemName: "person.2")
                        .flowFont(.caption)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.6) : .white.opacity(0.6))
                        .frame(width: 14)
                }
                Text(title)
                    .flowFont(size: 14, weight: active || channel.unreadCount > 0 ? .semibold : .regular)
                    .foregroundStyle(active ? MC.accentDeep : .white.opacity(channel.unreadCount > 0 ? 1 : 0.82))
                    .lineLimit(1)
                if channel.kind == "dm", let emoji = otherStatus?.statusEmoji, !emoji.isEmpty {
                    Text(emoji)
                        .flowFont(size: 14)
                        .help(otherStatus?.statusText ?? "")
                }
                // An agent working here (#137) — DMs included: talking to an
                // agent one-to-one is the common case.
                if app.busyChannelIds.contains(channel.id) {
                    ActivitySpinner(active: active)
                }
                if channel.notifyLevel == 0 {
                    Image(systemName: "bell.slash")
                        .flowFont(.caption2)
                        .foregroundStyle(active ? MC.accentDeep.opacity(0.5) : .white.opacity(0.5))
                }
                Spacer(minLength: 0)
                // A number means "this needs you" — unread notifications, not
                // unread messages (operator ruling 2026-07-26). Messages only
                // embolden the row, above.
                if channel.unreadNotifications > 0 {
                    unreadBadge(channel.unreadNotifications)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(rowBackground(active))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .id(AppState.sidebarRowID(channel.id))
        .accessibilityElement(children: .combine)
        // badge-free id: QA targets DMs by plain member names
        .accessibilityIdentifier("sidebar.dm.\(title.replacingOccurrences(of: " 🤖", with: ""))")
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

    /// An artifact tab row (phase 9): selectable like a channel, type glyph +
    /// name; remove via the context menu (never deletes the underlying file).
    /// A channel/DM row followed by its pinned artifacts, nested beneath it
    /// (phase 13). Kept as a helper so the sidebar body stays cheap to type-check.
    @ViewBuilder
    private func channelWithArtifacts(_ channel: Channel, @ViewBuilder row: () -> some View) -> some View {
        row()
        ForEach(win.artifacts(inChannel: channel.id)) { artifact in
            ArtifactSidebarRow(artifact: artifact)
        }
    }

    private func browseRow(_ channel: Channel) -> some View {
        HStack(spacing: 9) {
            Text("#")
                .flowFont(size: 14)
                .foregroundStyle(.white.opacity(0.6))
                .frame(width: 14)
            Text(channel.name ?? "")
                .flowFont(size: 14)
                .foregroundStyle(.white.opacity(0.7))
            Spacer(minLength: 0)
            Button("Join") {
                Task {
                    do {
                        let ch = try await app.engine.joinChannel(channel.id)
                        win.selectChannel(ch.id)
                    } catch {
                        app.showError(error.localizedDescription)
                    }
                }
            }
            .buttonStyle(.plain)
            .flowFont(.caption, weight: .semibold)
            .foregroundStyle(.white.opacity(0.8))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
    }

    /// An agent with no DM yet (#361) — clicking creates one. Same shape as a
    /// DM row minus the unread badge, which needs a channel to count.
    private func agentRow(_ member: MemberInfo) -> some View {
        let online = app.presence[member.userId] == true
        return Button {
            openDm(with: member.userId)
        } label: {
            HStack(spacing: 9) {
                presenceDot(online: online)
                    .frame(width: 14)
                Text(member.displayName)
                    .flowFont(size: 14)
                    .foregroundStyle(.white.opacity(0.82))
                    .lineLimit(1)
                if let emoji = member.statusEmoji, !emoji.isEmpty {
                    Text(emoji)
                        .flowFont(size: 14)
                        .help(member.statusText ?? "")
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Start a direct message")
        .accessibilityElement(children: .combine)
        // Same id shape as a real DM row, so QA targets an agent by name
        // whether or not the conversation exists yet.
        .accessibilityIdentifier("sidebar.dm.\(member.displayName)")
        .accessibilityValue(online ? "online" : "offline")
        .contextMenu {
            Button("View Profile") { profileUserId = member.userId }
        }
    }

    private func memberRow(_ member: MemberInfo) -> some View {
        Button {
            openDm(with: member.userId)
        } label: {
            HStack(spacing: 9) {
                presenceDot(online: app.presence[member.userId] == true)
                Text(member.displayName)
                    .flowFont(size: 14)
                    .foregroundStyle(.white.opacity(0.82))
                    .lineLimit(1)
                if member.isAgent == true {
                    Text("🤖")
                        .flowFont(size: 14)
                        .help("AI agent")
                }
                if let emoji = member.statusEmoji, !emoji.isEmpty {
                    Text(emoji)
                        .flowFont(size: 14)
                        .help(member.statusText ?? "")
                }
                if member.userId == app.currentUser?.id {
                    Text("(you)").flowFont(.caption2).foregroundStyle(.white.opacity(0.55))
                }
                Spacer(minLength: 0)
                if member.role != "member" {
                    Text(member.role)
                        .flowFont(.caption2)
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
        guard let wsId = win.selectedWorkspaceId else { return }
        Task {
            do {
                let dm = try await app.engine.createDm(workspaceId: wsId, userIds: [userId])
                win.selectChannel(dm.id)
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
            .flowFont(size: 11, weight: .bold)
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

    /// Confirmed departure (#340): the engine calls the endpoint, clears the
    /// local mirror and reports where to land; `workspaceBecameUnavailable`
    /// moves every window showing it, including this one.
    private func leaveWorkspace() {
        guard let ws = currentWorkspace else { return }
        Task {
            do {
                let next = try await app.engine.leaveWorkspace(ws.id)
                await app.workspaceBecameUnavailable(ws.id, landOn: next)
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }

    /// Confirmed deletion (#340 follow-up). Same landing as leaving — the
    /// workspace is gone for us either way.
    private func deleteWorkspace() {
        guard let ws = currentWorkspace else { return }
        Task {
            do {
                let next = try await app.engine.deleteWorkspace(ws.id)
                await app.workspaceBecameUnavailable(ws.id, landOn: next)
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }

    private var workspaceMenu: some View {
        Menu {
            ForEach(workspaces.value) { ws in
                Button {
                    win.selectWorkspace(ws.id)
                } label: {
                    if ws.id == win.selectedWorkspaceId {
                        Label(ws.name, systemImage: "checkmark")
                    } else {
                        Text(ws.name)
                    }
                }
            }
            Divider()
            if canEditWorkspace {
                Button("Workspace Appearance…") { showColorPicker = true }
            }
            Button("Create Workspace…") { showCreateWorkspace = true }
            Button("Accept Invite…") { showAcceptInvite = true }
            Button("Invite People…") { showInvite = true }
            Divider()
            Button("All Workspaces") { win.selectWorkspace(nil) }
            if currentWorkspace != nil {
                switch workspaceExit {
                case .delete:
                    Button("Delete Workspace…", role: .destructive) { confirmDeleteWorkspace = true }
                        .accessibilityIdentifier("sidebar.deleteWorkspace")
                case .leave, .transferFirst:
                    // Destructive, and disabled for the owner with the reason in
                    // the label — a macOS menu item has nowhere else to say it.
                    let blocked = workspaceExit == .transferFirst
                    Button(
                        blocked ? "Leave Workspace — transfer ownership first" : "Leave Workspace…",
                        role: .destructive
                    ) { confirmLeaveWorkspace = true }
                        .disabled(blocked)
                        .accessibilityIdentifier("sidebar.leaveWorkspace")
                }
            }
            Divider()
            // Version tag (web parity): clicking it opens the "What's new" sheet.
            Button { showFeatures = true } label: {
                Text(BuildInfo.label).italic()
            }
            .accessibilityIdentifier("sidebar.buildNumber")
        } label: {
            HStack(spacing: 4) {
                // Native .font here, not .flowFont: the borderless Menu label is
                // rendered by AppKit, which only understands built-in modifiers —
                // a custom ViewModifier makes it drop the white foregroundStyle.
                Text(currentWorkspace?.name ?? "Workspace")
                    .font(ZoomedFont.system(size: 16, weight: .bold, scale: textZoom))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(ZoomedFont.system(.caption, scale: textZoom))
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
    @EnvironmentObject private var win: WindowState
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
                                    .flowFont(size: 13.5, weight: .bold)
                                    .foregroundStyle(.white)
                                    .lineLimit(1)
                                Circle()
                                    .fill(app.connection == .connected ? MC.online : .orange)
                                    .frame(width: 6, height: 6)
                                    .help(app.connection.label)
                            }
                            Text(statusText.isEmpty ? "Set a status" : statusText)
                                .flowFont(size: 12)
                                .foregroundStyle(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.down")
                            .flowFont(.caption)
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
                    .flowFont(size: 13.5, weight: .semibold)
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
                    .flowFont(size: 13.5, weight: .semibold)
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
                    .flowFont(size: 11)
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
                .flowFont(size: 11, weight: .bold)
                .tracking(0.55)
                .foregroundStyle(MC.muted)
                .padding(.horizontal, 8)
                .padding(.bottom, 4)
            ForEach(Array(MC.statusOptions.enumerated()), id: \.offset) { index, option in
                Button {
                    setStatus(option.emoji, option.text, option.suppresses)
                } label: {
                    HStack(spacing: 8) {
                        Text(option.emoji)
                            .flowFont(size: 17)
                            .frame(width: 22)
                        Text(option.text)
                            .flowFont(size: 13.5, weight: .semibold)
                            .foregroundStyle(MC.ink)
                        Spacer(minLength: 0)
                        if option.emoji == statusEmoji, option.text == statusText {
                            Image(systemName: "checkmark")
                                .flowFont(.caption)
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
                setStatus("", "", false)
            } label: {
                Text("Clear status")
                    .flowFont(size: 13, weight: .semibold)
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

    /// `suppresses` is always sent, never left to default: the server only
    /// touches the column when the field is present, so omitting it strands
    /// the previous value — picking "Available" after "Do not disturb" would
    /// leave alerts paused. Web does the same (STATUS_OPTIONS, default false).
    private func setStatus(_ emoji: String, _ text: String, _ suppresses: Bool) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await app.engine.setStatus(
                    emoji: emoji, text: text, suppressAlerts: suppresses
                )
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

/// Owner/admin workspace branding: the sidebar color preset (ruling 3) and the
/// optional avatar image (#336). Either write PATCHes the workspace; the saved
/// row + broadcast restyle every client live.
struct WorkspaceColorSheet: View {
    let workspace: Workspace
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    /// Local mirror of the workspace's avatar so the preview updates in place —
    /// the sheet holds a snapshot row, not a live query.
    @State private var avatarUrl: String?

    private var currentId: String {
        SidebarPalette.palette(for: workspace.sidebarColor).id
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 4)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Workspace Appearance").flowFont(.headline)
            Text("Applies to everyone in \(workspace.name).")
                .flowFont(.caption)
                .foregroundStyle(.secondary)
            avatarSection
            Divider()
            Text("Color").flowFont(.caption).foregroundStyle(.secondary)
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
        .onAppear { avatarUrl = workspace.avatarUrl }
    }

    private var avatarSection: some View {
        HStack(spacing: 12) {
            WorkspaceMark(
                workspace: Workspace(
                    id: workspace.id, slug: workspace.slug, name: workspace.name,
                    createdBy: workspace.createdBy, createdAt: workspace.createdAt,
                    role: workspace.role, sidebarColor: workspace.sidebarColor,
                    avatarUrl: avatarUrl
                ),
                size: 48,
                cornerRadius: 10
            )
            .background(RoundedRectangle(cornerRadius: 10).fill(MC.accent))
            .id(avatarUrl ?? "none") // repaint when the key changes
            VStack(alignment: .leading, spacing: 2) {
                Button(avatarUrl == nil ? "Upload Image…" : "Replace Image…") { pickAvatar() }
                    .buttonStyle(.link)
                    .disabled(busy)
                    .accessibilityIdentifier("workspace.avatar.upload")
                if avatarUrl == nil {
                    Text("PNG, JPEG, GIF or WebP — under 1MB.")
                        .flowFont(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Button("Remove") { clearAvatar() }
                        .buttonStyle(.link)
                        .disabled(busy)
                        .accessibilityIdentifier("workspace.avatar.remove")
                }
            }
            Spacer()
        }
    }

    private func pickAvatar() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.png, .jpeg, .gif, .webP]
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            busy = true
            Task { @MainActor in
                defer { busy = false }
                do {
                    let ws = try await app.engine.uploadWorkspaceAvatar(
                        workspaceId: workspace.id, fileURL: url
                    )
                    avatarUrl = ws.avatarUrl
                } catch {
                    app.showError(error.localizedDescription)
                }
            }
        }
    }

    private func clearAvatar() {
        busy = true
        Task { @MainActor in
            defer { busy = false }
            do {
                _ = try await app.engine.clearWorkspaceAvatar(workspaceId: workspace.id)
                avatarUrl = nil
            } catch {
                app.showError(error.localizedDescription)
            }
        }
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
                                .flowFont(size: 13, weight: .bold)
                                .foregroundStyle(.white)
                        }
                    }
                Text(palette.name)
                    .flowFont(.caption2)
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
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var topic = ""
    @State private var isPrivate = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Create Channel").flowFont(.headline)
            TextField("Name (lowercase, a-z 0-9 - _)", text: $name)
                .textFieldStyle(.roundedBorder)
            TextField("Topic (optional)", text: $topic)
                .textFieldStyle(.roundedBorder)
            Toggle("Private channel", isOn: $isPrivate)
            if let error {
                Text(error).flowFont(.callout).foregroundStyle(.red)
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
                            win.selectChannel(ch.id)
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

/// An artifact row nested under its channel (phase 13): the whole row selects
/// the artifact (bold, no pill when active — see the foreground styling); a ✕
/// revealed on hover deletes the shared artifact (also in the context menu).
private struct ArtifactSidebarRow: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    let artifact: Artifact
    @State private var hovering = false

    private var active: Bool { win.selectedArtifactId == artifact.id }

    var body: some View {
        HStack(spacing: 0) {
            Button {
                win.selectArtifact(artifact.id)
            } label: {
                HStack(spacing: 9) {
                    Text(artifact.glyph)
                        .flowFont(size: 12)
                        .opacity(active ? 1 : 0.85)
                        .frame(width: 14)
                    // Bold white text marks the selection — no white pill, which
                    // would stack under the active channel's pill.
                    Text(artifact.name)
                        .flowFont(size: 14, weight: active ? .bold : .regular)
                        .foregroundStyle(.white.opacity(active ? 1 : 0.82))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if hovering {
                Button(action: remove) {
                    Image(systemName: "xmark").flowFont(size: 10, weight: .semibold)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.white.opacity(0.6))
                .help("Delete artifact")
                .accessibilityIdentifier("sidebar.artifact.remove.\(artifact.name)")
            }
        }
        .padding(.leading, 20) // nested under its channel
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sidebar.artifact.\(artifact.name)")
        .accessibilityAddTraits(active ? [.isSelected] : [])
        .contextMenu {
            Button("Delete Artifact", role: .destructive, action: remove)
        }
    }

    private func remove() {
        Task {
            do { try await app.engine.deleteArtifact(artifact) }
            catch { app.showError(error.localizedDescription) }
        }
    }
}

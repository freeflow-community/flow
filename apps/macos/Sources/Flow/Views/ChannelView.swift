import GRDB
import SwiftUI

struct ChannelView: View {
    let channelId: String
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @StateObject private var messages = DBObserved<[Message]>(initial: [])
    @StateObject private var pinnedMessages = DBObserved<[Message]>(initial: [])
    /// One roster observer for the whole header + list: names, status and the
    /// agent flag all come off the same User records (#70 needs status *text*,
    /// which the old name/emoji maps dropped).
    @StateObject private var users = DBObserved<[String: User]>(initial: [:])
    @State private var editingMessage: Message?
    @State private var profileUserId: String?
    @State private var showChannelEdit = false
    /// This channel's real membership (#70) — fetched, since the DTO only
    /// carries memberIds for DMs.
    @State private var channelMemberIds: [String] = []
    @State private var showMembers = false
    @State private var showPins = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            SyncBar(syncing: app.isSyncing)

            MessageListView(
                messages: messages.value,
                userNames: userNames,
                userStatuses: userStatuses,
                currentUserId: app.currentUser?.id,
                hasMore: app.hasMore[channelId] ?? false,
                isLoadingHistory: app.loadingHistory.contains(channelId),
                showThreadAffordances: true,
                unreadThreadRootIds: Set(channel.value?.unreadThreadRootIds ?? []),
                onLoadOlder: {
                    Task { await app.engine.loadOlder(channelId: channelId) }
                },
                onOpenThread: { rootId in
                    win.openThread(rootId)
                },
                onEdit: { message in
                    editingMessage = message
                },
                onDelete: { message in
                    Task { await app.engine.deleteMessage(id: message.id) }
                },
                onOpenProfile: { userId in
                    profileUserId = userId
                },
                scrollKey: channelId,
                // Jump-to-message (phase 12): the main list owns the target
                // unless it's a thread reply (ThreadPanelView handles those).
                focusMessageId: win.openThreadRootId == nil ? win.focusMessageId : nil,
                onFocused: { win.focusMessageId = nil }
            )

            TypingIndicatorView(channelId: channelId, userNames: userNames)

            if channel.value?.archivedAt != nil {
                Text("This channel is archived and read-only.")
                    .flowFont(.callout)
                    .foregroundStyle(.secondary)
                    .padding(12)
            } else {
                ComposerView(
                    channelId: channelId,
                    workspaceId: channel.value?.workspaceId,
                    threadRootId: nil,
                    placeholder: "Message \(headerTitle)",
                    onEditLast: { startEditingLastMessage() }
                )
            }
        }
        .task(id: channelId) {
            channel.start(db: app.db, reset: nil) { db in
                try Channel.fetchOne(db, key: channelId)
            }
            messages.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("channelId") == channelId && Column("threadRootId") == nil)
                    .order(Column("id"))
                    .fetchAll(db)
            }
            pinnedMessages.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("channelId") == channelId && Column("pinnedAt") != nil)
                    .order(Column("pinnedAt").desc)
                    .fetchAll(db)
            }
            users.start(db: app.db, reset: [:]) { db in
                try Dictionary(uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0) })
            }
            await loadChannelMembers()
            // A transcript on screen must have been asked for at least once —
            // the selection-driven fetch alone can leave this one blank (#269).
            await app.engine.ensureHistory(channelId: channelId)
            await app.engine.loadPinnedMessages(channelId: channelId)
        }
        // Jump-to-message (phase 12): a target from the Activity feed may sit
        // beyond the loaded page — page older history until it's in the list,
        // then MessageListView scrolls to it. Give up once history is exhausted.
        .onChange(of: win.focusMessageId) { _, _ in pageToFocusIfNeeded() }
        .onChange(of: messages.value.count) { _, _ in pageToFocusIfNeeded() }
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
        .sheet(item: Binding(
            get: { profileUserId.map { ProfileTarget(userId: $0) } },
            set: { profileUserId = $0?.userId }
        )) { target in
            MemberProfileSheet(userId: target.userId)
        }
        .sheet(isPresented: $showChannelEdit) {
            if let c = channel.value {
                ChannelEditSheet(channel: c)
            }
        }
        .sheet(isPresented: $showPins) {
            PinnedMessagesSheet(
                messages: pinnedMessages.value,
                userNames: userNames,
                onSelect: { message in
                    guard let workspaceId = channel.value?.workspaceId else { return }
                    win.openNotification(
                        workspaceId: workspaceId,
                        channelId: message.channelId,
                        messageId: message.id,
                        threadRootId: message.threadRootId
                    )
                    showPins = false
                }
            )
        }
    }

    /// Display names (agents badged) for the message list, typing line and header.
    private var userNames: [String: String] {
        users.value.mapValues { $0.displayNameWithBadge }
    }

    /// Status emoji only where one is set — the message list skips empties.
    private var userStatuses: [String: String] {
        users.value.compactMapValues { ($0.statusEmoji?.isEmpty == false) ? $0.statusEmoji : nil }
    }

    /// Refresh this channel's membership. Falls back to the DTO's DM-only
    /// memberIds if the request fails, so the header never empties out.
    private func loadChannelMembers() async {
        let ids = await app.engine.channelMemberIds(channelId: channelId)
        channelMemberIds = ids.isEmpty ? (channel.value?.memberIds ?? []) : ids
    }

    /// Page older history toward a jump-to-message target until it's loaded
    /// (thread-reply targets are handled by ThreadPanelView, not here).
    private func pageToFocusIfNeeded() {
        guard win.openThreadRootId == nil, let fid = win.focusMessageId else { return }
        if messages.value.contains(where: { $0.id == fid }) { return } // loaded — list scrolls to it
        if app.hasMore[channelId] ?? false {
            Task { await app.engine.loadOlder(channelId: channelId) }
        } else {
            win.focusMessageId = nil // not in this channel's history
        }
    }

    /// ↑-to-edit (ui_nits item 4): only when my message is the newest.
    private func startEditingLastMessage() -> Bool {
        guard let last = messages.value.last,
              last.userId == app.currentUser?.id,
              !last.isDeleted, !last.pending else { return false }
        editingMessage = last
        return true
    }

    /// The non-me member of a 1:1 DM (falls back to me for a self-DM).
    private var dmOtherUserId: String? {
        guard channel.value?.kind == "dm" else { return nil }
        let ids = channel.value?.memberIds ?? []
        return ids.first { $0 != app.currentUser?.id } ?? ids.first
    }

    private var headerTitle: String {
        guard let c = channel.value else { return "" }
        return c.isDM
            ? c.displayTitle(userNames: userNames, currentUserId: app.currentUser?.id)
            : "#\(c.name ?? "")"
    }

    /// The header topic, run through the same inline renderer as a message body
    /// (#194) so a URL in it is a real link that opens in the system browser
    /// instead of inert grey text.
    ///
    /// The colours are set per run rather than with a view-level
    /// `.foregroundStyle`, which would paint the link muted grey too and leave
    /// it looking exactly as unclickable as before. Runs that already carry a
    /// colour are mention pills — `MentionRendering` owns those.
    private var headerTopic: AttributedString? {
        guard let raw = channel.value?.topic, !raw.isEmpty else { return nil }
        var topic = MentionRendering.attributed(
            raw, names: userNames, currentUserId: app.currentUser?.id
        )
        let uncoloured = topic.runs.filter { $0.foregroundColor == nil }.map { ($0.range, $0.link) }
        for (range, link) in uncoloured {
            topic[range].foregroundColor = link == nil ? MC.muted : MC.accent
        }
        return topic
    }

    private var header: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Image(systemName: headerIcon)
                        .flowFont(size: 13)
                        .foregroundStyle(MC.muted)
                    // Ruling 4: a 1:1 DM's header title opens the other
                    // member's profile card.
                    if let otherId = dmOtherUserId {
                        Button {
                            profileUserId = otherId
                        } label: {
                            Text(headerTitle)
                                .flowFont(size: 15, weight: .bold)
                                .foregroundStyle(MC.ink)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("View profile")
                    } else if channel.value?.kind == "standard" {
                        // Clicking a channel's name opens the name/topic editor
                        // (ui_nits item 5).
                        Button {
                            showChannelEdit = true
                        } label: {
                            Text(channel.value?.name ?? "")
                                .flowFont(size: 15, weight: .bold)
                                .foregroundStyle(MC.ink)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Edit name & topic")
                        .accessibilityIdentifier("channel.editHeader")
                    } else {
                        Text(headerTitle)
                            .flowFont(size: 15, weight: .bold)
                            .foregroundStyle(MC.ink)
                    }
                }
                if let topic = headerTopic {
                    Text(topic)
                        .flowFont(size: 12)
                        .lineLimit(1)
                        .accessibilityIdentifier("channel.topic")
                }
            }
            Spacer()
            headerAvatars
            channelMenu
        }
        .padding(.horizontal, 22)
        .frame(height: 60)
        .background(MC.base)
    }

    /// The header's "⋯" menu (#188): pinned messages, this channel's artifacts
    /// and channel options in one place, matching web and iOS. Replaces the
    /// standalone pin button that used to sit next to the avatars.
    private var channelMenu: some View {
        Menu {
            Button {
                showPins = true
            } label: {
                Label(
                    pinnedMessages.value.isEmpty
                        ? "Pinned Messages"
                        : "Pinned Messages (\(pinnedMessages.value.count))",
                    systemImage: pinnedMessages.value.isEmpty ? "pin" : "pin.fill"
                )
            }
            .accessibilityIdentifier("channel.pins")

            let artifacts = win.artifacts(inChannel: channelId)
            Menu {
                if artifacts.isEmpty {
                    Text("No artifacts yet")
                } else {
                    ForEach(artifacts) { artifact in
                        Button {
                            win.selectArtifact(artifact.id)
                        } label: {
                            Text("\(artifact.glyph)  \(artifact.name)")
                        }
                        .accessibilityIdentifier("artifact.row.\(artifact.name)")
                    }
                }
            } label: {
                Label(artifacts.isEmpty ? "Artifacts" : "Artifacts (\(artifacts.count))",
                      systemImage: "doc.text")
            }
            .accessibilityIdentifier("channel.artifacts")

            if channel.value?.kind == "standard" {
                Divider()
                Button {
                    showChannelEdit = true
                } label: {
                    Label("Channel Options…", systemImage: "gearshape")
                }
                .accessibilityIdentifier("channel.options")
            }
        } label: {
            Image(systemName: "ellipsis")
                .flowFont(size: 13)
                .foregroundStyle(MC.muted)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .frame(width: 20)
        .help("Channel menu")
        .accessibilityIdentifier("channel.menu")
    }

    /// Design 3a: overlapping member avatars + "+N" at the header's right edge —
    /// this channel's members for every kind (#70; it used to show the whole
    /// workspace roster for standard channels). Clicking opens the member list.
    private var headerAvatars: some View {
        let ids = orderedMembers.map(\.id)
        let shown = Array(ids.prefix(3))
        let extra = ids.count - shown.count
        return Button {
            showMembers.toggle()
        } label: {
            HStack(spacing: 4) {
                HStack(spacing: -10) {
                    ForEach(shown, id: \.self) { id in
                        AvatarChip(
                            userId: id,
                            name: users.value[id]?.displayName ?? "?",
                            avatarPath: app.avatarPaths[id],
                            size: 26,
                            radius: 13
                        )
                        .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(MC.base, lineWidth: 2))
                    }
                }
                if extra > 0 {
                    Text("+\(extra)")
                        .flowFont(size: 12)
                        .foregroundStyle(MC.muted)
                }
                // Nothing to stack yet (fetch in flight) — keep a click target.
                if shown.isEmpty {
                    Image(systemName: "person.2")
                        .flowFont(size: 13)
                        .foregroundStyle(MC.muted)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("View members")
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("channel.memberAvatars")
        .accessibilityValue("\(ids.count) members")
        .popover(isPresented: $showMembers, arrowEdge: .bottom) {
            membersPopover
        }
        .onChange(of: showMembers) { _, opening in
            if opening { Task { await loadChannelMembers() } } // catch joins/leaves
        }
    }

    /// This channel's members, online first then alphabetical (web parity).
    private var orderedMembers: [User] {
        let ids = channelMemberIds.isEmpty ? (channel.value?.memberIds ?? []) : channelMemberIds
        return ids
            .map { id in
                users.value[id]
                    ?? User(id: id, email: "", displayName: "Unknown", avatarUrl: nil, timezone: nil)
            }
            .sorted { a, b in
                let aOn = isOnline(a.id), bOn = isOnline(b.id)
                if aOn != bOn { return aOn }
                return a.displayName.localizedCaseInsensitiveCompare(b.displayName) == .orderedAscending
            }
    }

    /// You're online by definition — this client is the one connected.
    private func isOnline(_ userId: String) -> Bool {
        userId == app.currentUser?.id || app.presence[userId] == true
    }

    private var membersPopover: some View {
        let rows = orderedMembers
        return VStack(alignment: .leading, spacing: 0) {
            Text(rows.count == 1 ? "1 MEMBER" : "\(rows.count) MEMBERS")
                .flowFont(size: 11, weight: .bold)
                .kerning(0.5)
                .foregroundStyle(MC.muted)
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            if rows.isEmpty {
                Text("No members.")
                    .flowFont(size: 13)
                    .foregroundStyle(MC.faint)
                    .padding(.horizontal, 10)
            }
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(rows) { user in
                        memberRow(user)
                    }
                }
            }
            .frame(maxHeight: 320)
        }
        .padding(.vertical, 10)
        .frame(width: 260)
        // Without this the popover uses the system vibrant material, which
        // samples whatever is behind it — gray over the message list, violet
        // over the sidebar — and washes out the ink-on-paper row text.
        .presentationBackground(MC.base)
        .accessibilityIdentifier("channel.membersPopover")
    }

    private func memberRow(_ user: User) -> some View {
        Button {
            showMembers = false
            profileUserId = user.id
        } label: {
            HStack(spacing: 9) {
                AvatarChip(
                    userId: user.id,
                    name: user.displayName,
                    avatarPath: app.avatarPaths[user.id],
                    size: 26,
                    radius: 9
                )
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 5) {
                        Text(user.displayName)
                            .flowFont(size: 13.5, weight: .semibold)
                            .foregroundStyle(MC.ink)
                            .lineLimit(1)
                        if user.id == app.currentUser?.id {
                            Text("(you)")
                                .flowFont(size: 13.5)
                                .foregroundStyle(MC.faint)
                        }
                        if user.isAgent == true { Text("🤖").flowFont(size: 12) }
                        if let emoji = user.statusEmoji, !emoji.isEmpty {
                            Text(emoji).flowFont(size: 12)
                        }
                    }
                    if let status = user.statusText, !status.isEmpty {
                        Text(status)
                            .flowFont(size: 11)
                            .foregroundStyle(MC.faint)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                Circle()
                    .fill(isOnline(user.id) ? MC.online : Color.clear)
                    .overlay(
                        Circle().strokeBorder(
                            isOnline(user.id) ? Color.clear : MC.hairline2, lineWidth: 1.5
                        )
                    )
                    .frame(width: 8, height: 8)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("channel.member.\(user.displayName)")
        .accessibilityValue(isOnline(user.id) ? "online" : "offline")
    }

    private var headerIcon: String {
        guard let c = channel.value else { return "number" }
        if c.kind == "dm" { return "person" }
        if c.kind == "group_dm" { return "person.2" }
        return c.isPrivate ? "lock" : "number"
    }
}

struct PinnedMessagesSheet: View {
    let messages: [Message]
    let userNames: [String: String]
    let onSelect: (Message) -> Void
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Pinned Messages").font(.headline)
                Spacer()
                Button("Done") { dismiss() }
            }

            if messages.isEmpty {
                ContentUnavailableView(
                    "No Pinned Messages",
                    systemImage: "pin",
                    description: Text("Pin an important message to keep it easy to find.")
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(messages) { message in
                            HStack(alignment: .top, spacing: 8) {
                                Button {
                                    onSelect(message)
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack {
                                            Text(userNames[message.userId] ?? "Unknown")
                                                .font(.system(size: 12, weight: .bold))
                                            Spacer()
                                            if let at = message.pinnedAt {
                                                Text(ISO8601.parse(at)?.formatted(date: .abbreviated, time: .shortened) ?? "")
                                                    .font(.system(size: 10))
                                                    .foregroundStyle(MC.faint)
                                            }
                                        }
                                        Text(message.body.isEmpty ? (message.files.first?.name ?? "Message") : message.body)
                                            .font(.system(size: 13))
                                            .foregroundStyle(MC.inkSoft)
                                            .lineLimit(3)
                                        if message.threadRootId != nil {
                                            Text("Reply in thread")
                                                .font(.system(size: 10, weight: .semibold))
                                                .foregroundStyle(MC.accentSoft)
                                        }
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)

                                Button {
                                    Task { await app.engine.togglePin(message) }
                                } label: {
                                    Image(systemName: "pin.slash")
                                        .foregroundStyle(MC.accentSoft)
                                }
                                .buttonStyle(.plain)
                                .help("Unpin message")
                            }
                            .padding(10)
                            .background(RoundedRectangle(cornerRadius: 10).fill(MC.daypill.opacity(0.45)))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(MC.hairline, lineWidth: 1))
                        }
                    }
                }
            }
        }
        .padding(18)
        .frame(width: 480, height: 440)
    }
}

struct TypingIndicatorView: View {
    let channelId: String
    /// nil = the channel's main composer; set = that thread's composer, so the
    /// two never show each other's typists.
    var threadRootId: String? = nil
    let userNames: [String: String]
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    var body: some View {
        let ids = app.typingUserIds(channelId: channelId, threadRootId: threadRootId)
        HStack {
            if !ids.isEmpty {
                Text(typingText(ids))
                    .flowFont(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("typing.indicator")
            }
            Spacer()
        }
        .frame(height: 16)
        .padding(.horizontal, 16)
    }

    /// An agent at work "thinks" rather than "types" (ui_nits).
    private func typingText(_ ids: [String]) -> String {
        let names = ids.map { userNames[$0] ?? "Someone" }
        switch ids.count {
        case 1:
            let verb = app.agentIds.contains(ids[0]) ? "thinking" : "typing"
            return "\(names[0]) is \(verb)…"
        case 2: return "\(names[0]) and \(names[1]) are typing…"
        default: return "Several people are typing…"
        }
    }
}

struct EditMessageSheet: View {
    let message: Message
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss
    @State private var text: String

    init(message: Message) {
        self.message = message
        _text = State(initialValue: message.body)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Edit Message").flowFont(.headline)
            TextField("Message", text: $text, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...10)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction) // Esc cancels (ui_nits item 4)
                Button("Save") {
                    Task { await app.engine.editMessage(id: message.id, body: text) }
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}

/// Channel options (#188): name, topic and delete, reached from the header's
/// "⋯" menu — the same three on every client. Empty topic clears the
/// sub-headline; #general can be neither renamed nor deleted. "Delete" is the
/// server's archive (soft: the channel leaves the sidebar and goes read-only).
struct ChannelEditSheet: View {
    let channel: Channel
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var topic: String
    @State private var error: String?
    @State private var saving = false
    @State private var confirmDelete = false

    init(channel: Channel) {
        self.channel = channel
        _name = State(initialValue: channel.name ?? "")
        _topic = State(initialValue: channel.topic ?? "")
    }

    private var isGeneral: Bool { channel.name == "general" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Channel options").flowFont(.headline)
            VStack(alignment: .leading, spacing: 4) {
                Text("Name").flowFont(.caption).foregroundStyle(.secondary)
                TextField("name (lowercase, a-z 0-9 - _)", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isGeneral)
                    .help(isGeneral ? "#general cannot be renamed" : "")
                    .accessibilityIdentifier("channel.edit.name")
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Topic").flowFont(.caption).foregroundStyle(.secondary)
                TextField("What's this channel about?", text: $topic)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("channel.edit.topic")
            }
            if let error {
                Text(error).flowFont(.caption).foregroundStyle(.red)
            }
            HStack {
                if !isGeneral {
                    Button("Delete Channel…", role: .destructive) { confirmDelete = true }
                        .disabled(saving)
                        .accessibilityIdentifier("channel.edit.delete")
                }
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") { save() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(saving || (!isGeneral && name.trimmingCharacters(in: .whitespaces).isEmpty))
                    .accessibilityIdentifier("channel.edit.save")
            }
        }
        .padding(20)
        .frame(width: 420)
        .confirmationDialog(
            "Delete #\(channel.name ?? "")?",
            isPresented: $confirmDelete,
            titleVisibility: .visible
        ) {
            Button("Delete Channel", role: .destructive) { remove() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It leaves everyone's sidebar and becomes read-only. Its history is kept.")
        }
    }

    /// Archive — the server's delete for a channel (see the type comment).
    private func remove() {
        saving = true
        Task {
            defer { saving = false }
            do {
                try await app.engine.archiveChannel(channel.id)
                if win.selectedChannelId == channel.id { win.selectChannel(nil) }
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func save() {
        saving = true
        let newName = name.lowercased().replacingOccurrences(of: " ", with: "-")
        Task {
            defer { saving = false }
            do {
                try await app.engine.updateChannel(
                    channelId: channel.id,
                    name: isGeneral ? nil : newName,
                    topic: topic // "" clears
                )
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

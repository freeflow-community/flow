import SwiftUI
import GRDB

/// A single channel: message list + composer. Selecting the channel triggers
/// the SyncEngine to load history; GRDB observation feeds the list live.
struct ChannelScreen: View {
    let channelId: String
    /// Opens the channel drawer. The header pill owns the hamburger now that
    /// the system bar is hidden, and the drawer state lives in `MainView`.
    var onOpenDrawer: () -> Void = {}
    @EnvironmentObject var app: AppState
    @StateObject private var messages = DBObserved<[Message]>(initial: [])
    @StateObject private var pinnedMessages = DBObserved<[Message]>(initial: [])
    @StateObject private var users = DBObserved<[User]>(initial: [])
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @State private var editingMessage: Message?
    @State private var threadRoute: ThreadRoute?
    /// The parked-thread restore (#89) must run only on the *first* appearance
    /// of this screen — entering the channel. `.task` re-runs every time a
    /// popped thread reveals this screen again, and re-pushing there races the
    /// pop itself: with slow fetches the stale `openThreadRootId` pushes a
    /// destination mid-pop, which corrupts the NavigationStack and leaves the
    /// whole content pane unable to push, pop, or even hit-test (nav "stuck").
    @State private var restoredParkedThread = false
    @State private var showPins = false
    /// How many of the newest cached messages the transcript shows (see the
    /// macOS twin in ChannelView: one window keeps every ordinary open on the
    /// exact, eager path; "Load earlier" widens it). The fetch grabs one row
    /// beyond the window as the has-more probe.
    @State private var transcriptWindow = ChannelScreen.windowStep

    static let windowStep = 100
    @State private var showChannelOptions = false
    /// Invite to Channel… (web + macOS parity): add workspace members here.
    @State private var showInviteToChannel = false
    /// The member whose profile card is open (#223). One sheet for the whole
    /// transcript, driven by whichever row was tapped.
    @State private var profileRoute: ProfileRoute?

    /// The open artifact (#157), presented as a sheet over the conversation.
    /// Driven by `AppState.selectedArtifactId` — the same selection macOS uses
    /// for its side panel — so an agent-created artifact auto-opens here too
    /// (`maybeAutoOpenArtifact`), and switching channel closes it for free.
    private var artifactRoute: Binding<ArtifactRoute?> {
        Binding(
            get: { app.selectedArtifactId.map(ArtifactRoute.init) },
            set: { if $0 == nil { app.selectArtifact(nil) } }
        )
    }

    private var usersById: [String: User] {
        Dictionary(users.value.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private var statusesById: [String: String] {
        Dictionary(uniqueKeysWithValues: users.value.compactMap { u in
            (u.statusEmoji?.isEmpty == false) ? (u.id, u.statusEmoji!) : nil
        })
    }

    private var title: String {
        guard let ch = channel.value else { return "" }
        if ch.isDM {
            return ch.displayTitle(userNames: usersById.mapValues { $0.displayNameWithBadge },
                                   currentUserId: app.currentUser?.id)
        }
        return "# \(ch.name ?? "channel")"
    }

    /// The topic, when there is one worth a line. DMs have none, and an empty
    /// or whitespace topic means "cleared" — not "blank second line".
    private var topic: String? {
        guard let ch = channel.value, !ch.isDM else { return nil }
        let text = ch.topic?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }

    /// Voice huddle (Phase 1): channels only (standard, not DM/group DM), and
    /// not while archived. "Join Huddle" doubles as start — see CONTEXT.md
    /// (Huddle). The participant count is the ambient indicator for a huddle
    /// that's live but not yet joined. Sits in the pill's trailing slot
    /// alongside the "⋯" menu (#298 moved the whole header into the pill).
    private var huddleButton: some View {
        Group {
            if channel.value?.kind == "standard", channel.value?.archivedAt == nil {
                let inThisHuddle = app.activeHuddleChannelId == channelId
                let roster = app.huddleRosters[channelId] ?? []
                Button {
                    if inThisHuddle {
                        app.leaveHuddle()
                    } else if let workspaceId = channel.value?.workspaceId {
                        app.joinHuddle(channelId: channelId, workspaceId: workspaceId)
                    }
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 15, weight: .semibold))
                        if !inThisHuddle, !roster.isEmpty {
                            Text("\(roster.count)")
                                .font(.system(size: 12, weight: .bold))
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(minWidth: 32, minHeight: 32)
                    .padding(.horizontal, 6)
                    .background(Capsule().fill(.white.opacity(inThisHuddle ? 0.35 : 0.2)))
                }
                .buttonStyle(.plain)
                .disabled(app.huddleConnecting)
                .accessibilityLabel(inThisHuddle ? "Leave huddle" : "Join huddle")
                .accessibilityIdentifier(inThisHuddle ? "huddle.leave" : "huddle.join")
            }
        }
    }

    /// The floating header (#298). The topic rides in the pill as a subtitle —
    /// the macOS header shape (`ChannelView.swift:227`) as a phone allows, and
    /// no longer a strip under the bar. The system navigation bar is hidden on this
    /// screen, so the hamburger comes from `MainView` as a closure and the "⋯"
    /// menu moves out of `.toolbar` and into the pill — the huddle button
    /// joins it there (Phase 1: voice huddle).
    private var headerPill: some View {
        FloatingHeaderPill(
            title: title,
            subtitle: topic,
            leadingSystemImage: "line.3.horizontal",
            leadingAction: onOpenDrawer,
            leadingAccessibilityIdentifier: "nav.menu",
            leadingAccessibilityLabel: "Channels",
            subtitleAccessibilityIdentifier: "channel.header.topic",
            trailing: {
                HStack(spacing: 6) {
                    huddleButton
                    channelMenu
                }
            }
        )
    }

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

            ArtifactsMenu(channelId: channelId)

            if channel.value?.kind == "standard" {
                Divider()
                Button {
                    showInviteToChannel = true
                } label: {
                    Label("Invite to Channel…", systemImage: "person.badge.plus")
                }
                .accessibilityIdentifier("channel.invite")
                Button {
                    showChannelOptions = true
                } label: {
                    Label("Channel Options…", systemImage: "gearshape")
                }
                .accessibilityIdentifier("channel.options")
            }
        } label: {
            PillGlyph(systemImage: "ellipsis")
        }
        .accessibilityIdentifier("channel.menu")
        .accessibilityLabel("Channel menu")
    }

    private var hasMoreCached: Bool { messages.value.count > transcriptWindow }
    private var transcript: [Message] {
        hasMoreCached ? Array(messages.value.dropFirst()) : messages.value
    }

    var body: some View {
        ZStack(alignment: .top) {
            chatStack
                // The transcript runs behind the pill and up to the very top of
                // the viewport. The pill is the only thing left in the safe
                // area, so it lands just under the status bar for free.
                .ignoresSafeArea(.container, edges: .top)
                .fadesAboveFloatingHeader(floatingHeaderTopInset)
            headerPill
        }
        // No system bar on this screen any more — the pill replaces it.
        .toolbar(.hidden, for: .navigationBar)
    }

    /// Everything the channel screen scrolls or types into, plus the sheets and
    /// observations that hang off it. Split out of `body` so the pill can float
    /// over it (#298).
    private var chatStack: some View {
        VStack(spacing: 0) {
            SyncBar(syncing: app.isSyncing)
            // The chat area — everything above the composer. Tapping or
            // scrolling any of it puts the keyboard away (#139); the composer
            // is deliberately outside, since tapping it means "type".
            VStack(spacing: 0) {
                MessageListView(
                    messages: transcript,
                    userNames: usersById.mapValues { $0.displayNameWithBadge },
                    userStatuses: statusesById,
                    currentUserId: app.currentUser?.id,
                    context: TranscriptContext(
                        engine: app.engine,
                        avatarPaths: app.avatarPaths,
                        agentIds: app.agentIds
                    ),
                    hasMore: hasMoreCached || (app.hasMore[channelId] ?? false),
                    isLoadingHistory: app.loadingHistory.contains(channelId),
                    showThreadAffordances: true,
                    unreadThreadRootIds: Set(channel.value?.unreadThreadRootIds ?? []),
                    onLoadOlder: {
                        // Widen the window first (instant, from cache); go to
                        // the server only once the cache is exhausted.
                        let cacheHadMore = hasMoreCached
                        transcriptWindow += Self.windowStep
                        if !cacheHadMore {
                            Task { await app.engine.loadOlder(channelId: channelId) }
                        }
                    },
                    onOpenThread: { rootId in
                        threadRoute = ThreadRoute(rootId: rootId)
                    },
                    onEdit: { editingMessage = $0 },
                    onDelete: { msg in
                        Task { await app.engine.deleteMessage(id: msg.id) }
                    },
                    // Jump-to-message (phase 12): the main list owns the target
                    // unless a thread is open, in which case the reply is
                    // ThreadScreen's to land on. The Activity feed only ever
                    // sets a top-level target on iOS, but the pins sheet jumps
                    // straight into a thread — so the condition, not the
                    // caller, is what keeps the two lists from both claiming it.
                    focusMessageId: app.openThreadRootId == nil ? app.focusMessageId : nil,
                    onFocused: { app.focusMessageId = nil },
                    onOpenProfile: { profileRoute = ProfileRoute(userId: $0) }
                )
                TypingIndicatorView(channelId: channelId, userNames: usersById.mapValues { $0.displayNameWithBadge })
            }
            .dismissesKeyboardOnChatInteraction()
            Divider()
            ComposerView(channelId: channelId)
        }
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
        .sheet(item: artifactRoute) { route in
            ArtifactSheet(artifactId: route.id)
        }
        .sheet(item: $profileRoute) { route in
            MemberProfileSheet(userId: route.userId)
        }
        .sheet(isPresented: $showChannelOptions) {
            if let c = channel.value {
                ChannelOptionsSheet(channel: c)
            }
        }
        .sheet(isPresented: $showInviteToChannel) {
            if let c = channel.value {
                InviteToChannelSheet(channel: c)
            }
        }
        .sheet(isPresented: $showPins) {
            PinnedMessagesSheet(
                messages: pinnedMessages.value,
                userNames: usersById.mapValues { $0.displayNameWithBadge },
                onSelect: { message in
                    showPins = false
                    if let rootId = message.threadRootId {
                        app.openThread(rootId)
                        threadRoute = ThreadRoute(rootId: rootId)
                    } else {
                        app.openThread(nil)
                        threadRoute = nil
                    }
                    app.focusMessageId = message.id
                }
            )
        }
        .navigationDestination(item: $threadRoute) { route in
            ThreadScreen(rootId: route.rootId)
        }
        // This binding is the single owner of the app-level thread state: a
        // set pushes and records the open thread, a pop clears it. It used to
        // be split — ThreadScreen recorded the open on *its* appearance — and
        // the two halves raced around a pop (see `restoredParkedThread`).
        //
        // Popping the thread (Back/swipe) closes it for real — issue #89 parks
        // an open thread per channel, and only this screen knows the difference
        // between "the user went back" and "the whole channel screen was
        // replaced by a channel switch", which must leave the parked thread be.
        .onChange(of: threadRoute) { _, route in
            if let route {
                app.openThread(route.rootId)
            } else if app.selectedChannelId == channelId {
                app.openThread(nil)
            }
        }
        // Jump-to-message (phase 12): page older history until the target is
        // loaded, then MessageListView scrolls to it; give up when exhausted.
        .onChange(of: transcriptWindow) { _, _ in startMessages() }
        .onChange(of: app.focusMessageId) { _, _ in pageToFocusIfNeeded() }
        .onChange(of: messages.value.count) { _, _ in pageToFocusIfNeeded() }
        .modifier(DebugTestSend(channelId: channelId, app: app))
        .modifier(DebugMessageActions(channelId: channelId, app: app) { threadRoute = ThreadRoute(rootId: $0) })
        .modifier(DebugOpenProfile(app: app) { profileRoute = ProfileRoute(userId: $0) })
        .background(MC.base)
        // No `.navigationTitle` / `.toolbar` here any more: the pill in `body`
        // carries the name, the topic, the hamburger and the "⋯" menu (#188's
        // three items are unchanged, they just moved) — the huddle button
        // (Phase 1: voice huddle) joins them in the pill's trailing slot.
        .task {
            app.selectChannel(channelId)
            // Re-push the thread this channel had open before we left it (#89)
            // — first appearance only; see `restoredParkedThread`.
            if !restoredParkedThread {
                restoredParkedThread = true
                if let rootId = app.openThreadRootId {
                    threadRoute = ThreadRoute(rootId: rootId)
                }
            }
            users.start(db: app.db) { try User.fetchAll($0) }
            channel.start(db: app.db) { try Channel.filter(key: channelId).fetchOne($0) }
            // No `reset:` — this screen's identity is the channel id (MainView
            // keys it), so anything already rendered belongs to *this* channel
            // and must survive the observation restarting. Clearing it first
            // was a self-inflicted blank (#191).
            startMessages()
            pinnedMessages.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("channelId") == channelId && Column("pinnedAt") != nil)
                    .order(Column("pinnedAt").desc)
                    .fetchAll(db)
            }
            // A transcript on screen must have been asked for at least once —
            // the selection-driven fetch alone can leave this one blank (#269).
            await app.engine.ensureHistory(channelId: channelId)
            await app.engine.loadPinnedMessages(channelId: channelId)
        }
    }

    /// (Re)start the windowed transcript observation: the newest
    /// `transcriptWindow` + 1 rows, ascending. No `reset:` — see the note at
    /// the old call site (#191): anything rendered belongs to this channel.
    private func startMessages() {
        let channelId = channelId
        let limit = transcriptWindow + 1
        messages.start(db: app.db) { db in
            try Array(
                Message
                    .filter(Column("channelId") == channelId && Column("threadRootId") == nil)
                    .order(Column("id").desc)
                    .limit(limit)
                    .fetchAll(db)
                    .reversed()
            )
        }
    }

    /// Page older history toward a jump-to-message target until it's loaded
    /// (thread-reply targets are handled by ThreadScreen, not here).
    private func pageToFocusIfNeeded() {
        guard app.openThreadRootId == nil, let fid = app.focusMessageId else { return }
        if transcript.contains(where: { $0.id == fid }) { return } // loaded — list scrolls to it
        if hasMoreCached {
            transcriptWindow += Self.windowStep // cached but outside the window
        } else if app.hasMore[channelId] ?? false {
            transcriptWindow += Self.windowStep
            Task { await app.engine.loadOlder(channelId: channelId) }
        } else {
            app.focusMessageId = nil // not in this channel's loaded history
        }
    }
}

private struct PinnedMessagesSheet: View {
    let messages: [Message]
    let userNames: [String: String]
    let onSelect: (Message) -> Void
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if messages.isEmpty {
                    ContentUnavailableView(
                        "No Pinned Messages",
                        systemImage: "pin",
                        description: Text("Pin an important message to keep it easy to find.")
                    )
                } else {
                    List(messages) { message in
                        HStack(alignment: .top, spacing: 10) {
                            Button {
                                onSelect(message)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(userNames[message.userId] ?? "Unknown")
                                            .font(.caption.weight(.bold))
                                        Spacer()
                                        if let at = message.pinnedAt {
                                            Text(ISO8601.parse(at)?.formatted(date: .abbreviated, time: .shortened) ?? "")
                                                .font(.caption2)
                                                .foregroundStyle(MC.faint)
                                        }
                                    }
                                    Text(message.body.isEmpty ? (message.files.first?.name ?? "Message") : message.body)
                                        .font(.callout)
                                        .foregroundStyle(MC.inkSoft)
                                        .lineLimit(3)
                                    if message.threadRootId != nil {
                                        Text("Reply in thread")
                                            .font(.caption2.weight(.semibold))
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
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Unpin message")
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Pinned Messages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

/// Channel options (#188): name, topic and delete, reached from the header's
/// "⋯" menu — the same three on every client, and the first time iOS could
/// rename a channel or set its topic at all. "Delete" is the server's archive
/// (soft: the channel leaves the sidebar and goes read-only); #general can be
/// neither renamed nor deleted.
struct ChannelOptionsSheet: View {
    let channel: Channel
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var topic: String
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var error: String?

    init(channel: Channel) {
        self.channel = channel
        _name = State(initialValue: channel.name ?? "")
        _topic = State(initialValue: channel.topic ?? "")
    }

    private var isGeneral: Bool { channel.name == "general" }

    private var normalized: String {
        name.trimmingCharacters(in: .whitespaces)
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("name (lowercase, a-z 0-9 - _)", text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(isGeneral)
                        .accessibilityIdentifier("channel.edit.name")
                    if isGeneral {
                        Text("#general cannot be renamed.")
                            .font(.caption)
                            .foregroundStyle(MC.faint)
                    }
                }
                Section("Topic") {
                    TextField("What's this channel about?", text: $topic)
                        .accessibilityIdentifier("channel.edit.topic")
                }
                if !isGeneral {
                    Section {
                        Button("Delete Channel", role: .destructive) { confirmDelete = true }
                            .disabled(busy)
                            .accessibilityIdentifier("channel.edit.delete")
                    } footer: {
                        Text("It leaves everyone's sidebar and becomes read-only. Its history is kept.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Channel Options")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { save() }
                        .disabled(busy || (!isGeneral && normalized.isEmpty))
                        .accessibilityIdentifier("channel.edit.save")
                }
            }
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
    }

    private func save() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.engine.updateChannel(
                    channelId: channel.id,
                    name: isGeneral ? nil : normalized,
                    topic: topic // "" clears
                )
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func remove() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.engine.archiveChannel(channel.id)
                if app.selectedChannelId == channel.id { app.selectChannel(nil) }
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

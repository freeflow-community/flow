import SwiftUI
import GRDB

/// A single channel: message list + composer. Selecting the channel triggers
/// the SyncEngine to load history; GRDB observation feeds the list live.
struct ChannelScreen: View {
    let channelId: String
    @EnvironmentObject var app: AppState
    @StateObject private var messages = DBObserved<[Message]>(initial: [])
    @StateObject private var users = DBObserved<[User]>(initial: [])
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @State private var editingMessage: Message?
    @State private var threadRoute: ThreadRoute?

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

    var body: some View {
        VStack(spacing: 0) {
            MessageListView(
                messages: messages.value,
                userNames: usersById.mapValues { $0.displayNameWithBadge },
                userStatuses: statusesById,
                currentUserId: app.currentUser?.id,
                hasMore: app.hasMore[channelId] ?? false,
                showThreadAffordances: true,
                onLoadOlder: {
                    Task { await app.engine.loadOlder(channelId: channelId) }
                },
                onOpenThread: { rootId in
                    threadRoute = ThreadRoute(rootId: rootId)
                },
                onEdit: { editingMessage = $0 },
                onDelete: { msg in
                    Task { await app.engine.deleteMessage(id: msg.id) }
                },
                // Jump-to-message (phase 12): the Activity feed only sets a
                // target for top-level messages on iOS (thread replies live in
                // a separate pushed screen — see CHANGELOG Parity).
                focusMessageId: app.focusMessageId,
                onFocused: { app.focusMessageId = nil }
            )
            .dismissesKeyboardOnTap()
            TypingIndicatorView(channelId: channelId, userNames: usersById.mapValues { $0.displayNameWithBadge })
            Divider()
            ComposerView(channelId: channelId)
        }
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
        .navigationDestination(item: $threadRoute) { route in
            ThreadScreen(rootId: route.rootId)
        }
        // Jump-to-message (phase 12): page older history until the target is
        // loaded, then MessageListView scrolls to it; give up when exhausted.
        .onChange(of: app.focusMessageId) { _, _ in pageToFocusIfNeeded() }
        .onChange(of: messages.value.count) { _, _ in pageToFocusIfNeeded() }
        .modifier(DebugTestSend(channelId: channelId, app: app))
        .modifier(DebugMessageActions(channelId: channelId, app: app) { threadRoute = ThreadRoute(rootId: $0) })
        .background(MC.base)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        // Account/status live in the drawer's profile footer now (web/macOS
        // parity — the sidebar owns that affordance), reached from the header
        // hamburger. The channel bar keeps just the title + that hamburger,
        // which MainView supplies as the content pane's leading toolbar item.
        .task {
            app.selectChannel(channelId)
            users.start(db: app.db) { try User.fetchAll($0) }
            channel.start(db: app.db) { try Channel.filter(key: channelId).fetchOne($0) }
            messages.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("channelId") == channelId && Column("threadRootId") == nil)
                    .order(Column("id"))
                    .fetchAll(db)
            }
        }
    }

    /// Page older history toward a jump-to-message target until it's loaded.
    private func pageToFocusIfNeeded() {
        guard let fid = app.focusMessageId else { return }
        if messages.value.contains(where: { $0.id == fid }) { return } // loaded — list scrolls to it
        if app.hasMore[channelId] ?? false {
            Task { await app.engine.loadOlder(channelId: channelId) }
        } else {
            app.focusMessageId = nil // not in this channel's loaded history
        }
    }
}

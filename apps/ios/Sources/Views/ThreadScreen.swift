import GRDB
import SwiftUI

/// Navigation payload for pushing a thread (phones push a screen; the macOS
/// side panel doesn't translate to this form factor).
struct ThreadRoute: Hashable, Identifiable {
    let rootId: String
    var id: String { rootId }
}

/// A thread: root message, reply divider, replies, and a reply composer.
/// Pushed from the channel screen; GRDB observation feeds it live, and
/// engine.openThread keeps the reply backfill running across reconnects.
struct ThreadScreen: View {
    let rootId: String
    @EnvironmentObject var app: AppState

    @StateObject private var thread = DBObserved<[Message]>(initial: [])
    @StateObject private var users = DBObserved<[User]>(initial: [])
    @StateObject private var channelId = DBObserved<String?>(initial: nil)
    @State private var editingMessage: Message?
    @State private var flashId: String?
    /// Viewport height, watched so the keyboard's resize can re-stick the list
    /// to the newest reply (#191).
    @State private var viewportHeight: CGFloat = 0

    private var userNames: [String: String] {
        Dictionary(users.value.map { ($0.id, $0.displayNameWithBadge) }, uniquingKeysWith: { a, _ in a })
    }

    private var statusesById: [String: String] {
        Dictionary(uniqueKeysWithValues: users.value.compactMap { u in
            (u.statusEmoji?.isEmpty == false) ? (u.id, u.statusEmoji!) : nil
        })
    }

    private var replies: [Message] {
        thread.value.filter { $0.id != rootId }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(thread.value) { message in
                            MessageRow(
                                message: message,
                                userNames: userNames,
                                userStatuses: statusesById,
                                currentUserId: app.currentUser?.id,
                                showHeader: true,
                                showThreadAffordances: false,
                                highlighted: message.id == flashId,
                                onOpenThread: { _ in },
                                onEdit: { editingMessage = $0 },
                                onDelete: { msg in
                                    Task { await app.engine.deleteMessage(id: msg.id) }
                                }
                            )
                            .id(message.id)
                            if message.id == rootId {
                                HStack {
                                    Text(replies.isEmpty
                                         ? "No replies yet"
                                         : "\(replies.count) \(replies.count == 1 ? "reply" : "replies")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    VStack { Divider() }
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 6)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }
                .background(
                    GeometryReader { geo in
                        Color.clear
                            .onAppear { viewportHeight = geo.size.height }
                            .onChange(of: geo.size.height) { _, new in
                                viewportHeight = new
                                // Same glue as the channel transcript (#191):
                                // the keyboard resizes the viewport without
                                // changing the content, and a position worked
                                // out from a LazyVStack's estimates lands past
                                // the end of everything laid out.
                                if let lastId = thread.value.last?.id {
                                    proxy.scrollTo(lastId, anchor: .bottom)
                                }
                            }
                    }
                )
                .onChange(of: thread.value.last?.id) { _, newId in
                    guard let newId else { return }
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(newId, anchor: .bottom)
                    }
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: app.focusMessageId) { _, _ in focusPinnedMessage(proxy) }
                .onChange(of: thread.value.count) { _, _ in focusPinnedMessage(proxy) }
                .onAppear { focusPinnedMessage(proxy) }
            }
            .dismissesKeyboardOnChatInteraction()
            if let chId = channelId.value {
                TypingIndicatorView(channelId: chId, threadRootId: rootId, userNames: userNames)
                Divider()
                ComposerView(channelId: chId, threadRootId: rootId, placeholder: "Reply in thread")
            }
        }
        .background(MC.base)
        .navigationTitle("Thread")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: rootId) {
            // No app.openThread here: ChannelScreen's threadRoute onChange owns
            // that record. Writing it from this screen's appearance raced the
            // pop — a Back tap landing before this task ran left a stale
            // openThreadRootId behind, which the channel screen then re-pushed
            // mid-pop, corrupting the NavigationStack (nav "stuck").
            thread.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("id") == rootId || Column("threadRootId") == rootId)
                    .order(Column("id"))
                    .fetchAll(db)
            }
            users.start(db: app.db) { try User.fetchAll($0) }
            channelId.start(db: app.db, reset: nil) { db in
                try String.fetchOne(
                    db,
                    sql: "SELECT channelId FROM message WHERE id = ?",
                    arguments: [rootId]
                )
            }
        }
        // No onDisappear close: this screen also disappears when a channel
        // switch replaces the stack root, which must *park* the thread rather
        // than close it (issue #89). ChannelScreen owns the close instead — it
        // can tell a Back tap from a channel switch.
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
    }

    private func focusPinnedMessage(_ proxy: ScrollViewProxy) {
        guard let messageId = app.focusMessageId,
              thread.value.contains(where: { $0.id == messageId }) else { return }
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(messageId, anchor: .center)
        }
        flashId = messageId
        app.focusMessageId = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            withAnimation(.easeOut(duration: 0.6)) {
                if flashId == messageId { flashId = nil }
            }
        }
    }
}

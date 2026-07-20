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

    private var userNames: [String: String] {
        Dictionary(users.value.map { ($0.id, $0.displayName) }, uniquingKeysWith: { a, _ in a })
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
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.vertical, 8)
                }
                .onChange(of: thread.value.last?.id) { _, newId in
                    if newId != nil {
                        withAnimation(.easeOut(duration: 0.15)) {
                            proxy.scrollTo("bottom", anchor: .bottom)
                        }
                    }
                }
                .task(id: thread.value.count) {
                    try? await Task.sleep(for: .milliseconds(350))
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
                .defaultScrollAnchor(.bottom)
            }
            if let chId = channelId.value {
                TypingIndicatorView(channelId: chId, userNames: userNames)
                Divider()
                ComposerView(channelId: chId, threadRootId: rootId, placeholder: "Reply in thread")
            }
        }
        .background(MC.base)
        .navigationTitle("Thread")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: rootId) {
            app.openThread(rootId)
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
        .onDisappear {
            if app.openThreadRootId == rootId { app.openThread(nil) }
        }
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
    }
}

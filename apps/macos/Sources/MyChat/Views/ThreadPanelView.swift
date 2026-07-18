import GRDB
import SwiftUI

struct ThreadPanelView: View {
    let rootId: String
    @EnvironmentObject private var app: AppState

    @StateObject private var thread = DBObserved<[Message]>(initial: [])
    @StateObject private var userNames = DBObserved<[String: String]>(initial: [:])
    @State private var editingMessage: Message?

    private var root: Message? {
        thread.value.first { $0.id == rootId }
    }

    private var replies: [Message] {
        thread.value.filter { $0.id != rootId }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Thread").font(.headline)
                if let root {
                    Text("#\(root.channelId.suffix(4))").hidden() // keep layout stable
                }
                Spacer()
                Button {
                    app.openThread(nil)
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .help("Close thread")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(thread.value) { message in
                            MessageRow(
                                message: message,
                                senderName: userNames.value[message.userId] ?? "Unknown",
                                isMine: message.userId == app.currentUser?.id,
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
                    }
                    .padding(.vertical, 8)
                }
                .onChange(of: thread.value.last?.id) { _, newId in
                    if let newId {
                        proxy.scrollTo(newId, anchor: .bottom)
                    }
                }
            }

            if let root {
                TypingIndicatorView(channelId: root.channelId, userNames: userNames.value)
                ComposerView(
                    channelId: root.channelId,
                    threadRootId: rootId,
                    placeholder: "Reply in thread"
                )
            }
        }
        .background(.background.secondary)
        .task(id: rootId) {
            thread.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("id") == rootId || Column("threadRootId") == rootId)
                    .order(Column("id"))
                    .fetchAll(db)
            }
            userNames.start(db: app.db, reset: [:]) { db in
                try Dictionary(
                    uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayName) }
                )
            }
        }
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
    }
}

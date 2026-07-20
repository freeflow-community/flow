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
            return ch.displayTitle(userNames: usersById.mapValues { $0.displayName },
                                   currentUserId: app.currentUser?.id)
        }
        return "# \(ch.name ?? "channel")"
    }

    var body: some View {
        VStack(spacing: 0) {
            MessageListView(
                messages: messages.value,
                userNames: usersById.mapValues { $0.displayName },
                userStatuses: statusesById,
                currentUserId: app.currentUser?.id,
                hasMore: app.hasMore[channelId] ?? false,
                showThreadAffordances: false,
                onLoadOlder: {
                    Task { await app.engine.loadOlder(channelId: channelId) }
                },
                onOpenThread: { _ in },
                onEdit: { _ in },
                onDelete: { _ in }
            )
            Divider()
            ComposerView(channelId: channelId)
        }
        .modifier(DebugTestSend(channelId: channelId, app: app))
        .background(MC.base)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
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

}

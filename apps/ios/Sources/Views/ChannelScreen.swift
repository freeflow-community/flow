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
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(messages.value.enumerated()), id: \.element.id) { idx, msg in
                            MessageRow(
                                message: msg,
                                sender: usersById[msg.userId],
                                avatarPath: app.avatarPaths[msg.userId],
                                showHeader: showHeader(at: idx),
                                names: usersById.mapValues { $0.displayName })
                            .id(msg.id)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.vertical, 8)
                }
                .onChange(of: messages.value) { _, list in
                    if let last = list.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
                .task(id: messages.value.count) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
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

    /// Group consecutive messages by the same author (Slack-style): only the
    /// first of a run shows the avatar + name + timestamp header.
    private func showHeader(at idx: Int) -> Bool {
        guard idx > 0 else { return true }
        return messages.value[idx].userId != messages.value[idx - 1].userId
    }
}

private struct MessageRow: View {
    let message: Message
    let sender: User?
    let avatarPath: String?
    let showHeader: Bool
    let names: [String: String]

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Group {
                if showHeader {
                    avatar
                } else {
                    Color.clear.frame(width: 38, height: 1)
                }
            }
            .frame(width: 38)

            VStack(alignment: .leading, spacing: 1) {
                if showHeader {
                    HStack(spacing: 6) {
                        Text(sender?.displayName ?? "Unknown").font(.subheadline.bold()).foregroundStyle(MC.ink)
                        Text(ISO8601.displayTime(message.createdAt)).font(.caption2).foregroundStyle(MC.muted)
                    }
                }
                if message.isDeleted {
                    Text("(deleted)").italic().foregroundStyle(MC.muted).font(.callout)
                } else {
                    // Render @-mentions and group tokens as readable text
                    // (shared with macOS). Rich markdown is a later increment.
                    Text(MentionRendering.plainText(message.body, names: names)).font(.callout).foregroundStyle(MC.ink)
                        .textSelection(.enabled)
                        .opacity(message.pending ? 0.5 : 1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.top, showHeader ? 8 : 1)
    }

    @ViewBuilder private var avatar: some View {
        let initials = String((sender?.displayName ?? "?").split(separator: " ").prefix(2).compactMap { $0.first }).uppercased()
        let colors = MC.avatarColors(for: message.userId)
        ZStack {
            RoundedRectangle(cornerRadius: 11).fill(colors.0)
            Text(initials.isEmpty ? "?" : initials).font(.caption.bold()).foregroundStyle(colors.1)
            if let avatarPath {
                AuthImage(path: avatarPath) { Color.clear }
                    .aspectRatio(contentMode: .fill)
                    .clipShape(RoundedRectangle(cornerRadius: 11))
            }
        }
        .frame(width: 38, height: 38)
    }
}

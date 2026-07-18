import GRDB
import SwiftUI

struct ChannelView: View {
    let channelId: String
    @EnvironmentObject private var app: AppState

    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @StateObject private var messages = DBObserved<[Message]>(initial: [])
    @StateObject private var userNames = DBObserved<[String: String]>(initial: [:])
    @State private var editingMessage: Message?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            MessageListView(
                messages: messages.value,
                userNames: userNames.value,
                currentUserId: app.currentUser?.id,
                hasMore: app.hasMore[channelId] ?? false,
                showThreadAffordances: true,
                onLoadOlder: {
                    Task { await app.engine.loadOlder(channelId: channelId) }
                },
                onOpenThread: { rootId in
                    app.openThread(rootId)
                },
                onEdit: { message in
                    editingMessage = message
                },
                onDelete: { message in
                    Task { await app.engine.deleteMessage(id: message.id) }
                }
            )

            TypingIndicatorView(channelId: channelId, userNames: userNames.value)

            ComposerView(
                channelId: channelId,
                threadRootId: nil,
                placeholder: "Message #\(channel.value?.name ?? "channel")"
            )
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

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: channel.value?.isPrivate == true ? "lock" : "number")
                .foregroundStyle(.secondary)
            Text(channel.value?.name ?? "")
                .font(.headline)
            if let topic = channel.value?.topic, !topic.isEmpty {
                Text(topic)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

struct TypingIndicatorView: View {
    let channelId: String
    let userNames: [String: String]
    @EnvironmentObject private var app: AppState

    var body: some View {
        let ids = app.typingUserIds(channelId: channelId)
        HStack {
            if !ids.isEmpty {
                let names = ids.map { userNames[$0] ?? "Someone" }
                Text(typingText(names))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("typing.indicator")
            }
            Spacer()
        }
        .frame(height: 16)
        .padding(.horizontal, 16)
    }

    private func typingText(_ names: [String]) -> String {
        switch names.count {
        case 1: "\(names[0]) is typing…"
        case 2: "\(names[0]) and \(names[1]) are typing…"
        default: "Several people are typing…"
        }
    }
}

struct EditMessageSheet: View {
    let message: Message
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var text: String

    init(message: Message) {
        self.message = message
        _text = State(initialValue: message.body)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Edit Message").font(.headline)
            TextField("Message", text: $text, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...10)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
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

import SwiftUI

struct MessageListView: View {
    let messages: [Message] // ascending by id
    let userNames: [String: String]
    let currentUserId: String?
    let hasMore: Bool
    let showThreadAffordances: Bool
    let onLoadOlder: () -> Void
    let onOpenThread: (String) -> Void
    let onEdit: (Message) -> Void
    let onDelete: (Message) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if hasMore {
                        HStack {
                            Spacer()
                            Button("Load earlier messages", action: onLoadOlder)
                                .buttonStyle(.link)
                                .font(.callout)
                            Spacer()
                        }
                        .padding(.vertical, 8)
                    }
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        MessageRow(
                            message: message,
                            senderName: userNames[message.userId] ?? "Unknown",
                            isMine: message.userId == currentUserId,
                            showHeader: showsHeader(at: index),
                            showThreadAffordances: showThreadAffordances,
                            onOpenThread: onOpenThread,
                            onEdit: onEdit,
                            onDelete: onDelete
                        )
                        .id(message.id)
                    }
                }
                .padding(.vertical, 8)
            }
            .onChange(of: messages.last?.id) { _, newId in
                if let newId {
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(newId, anchor: .bottom)
                    }
                }
            }
            .onAppear {
                if let last = messages.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    /// Slack-style grouping: show the author header when the sender changes
    /// or more than 5 minutes passed since the previous message.
    private func showsHeader(at index: Int) -> Bool {
        guard index > 0 else { return true }
        let prev = messages[index - 1]
        let cur = messages[index]
        if prev.userId != cur.userId { return true }
        guard let prevDate = ISO8601.parse(prev.createdAt),
              let curDate = ISO8601.parse(cur.createdAt) else { return true }
        return curDate.timeIntervalSince(prevDate) > 300
    }
}

struct MessageRow: View {
    let message: Message
    let senderName: String
    let isMine: Bool
    let showHeader: Bool
    let showThreadAffordances: Bool
    let onOpenThread: (String) -> Void
    let onEdit: (Message) -> Void
    let onDelete: (Message) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if showHeader {
                avatar
            } else {
                Color.clear.frame(width: 30, height: 1)
            }

            VStack(alignment: .leading, spacing: 2) {
                if showHeader {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(senderName).font(.callout.bold())
                        Text(ISO8601.displayTime(message.createdAt))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }

                if message.isDeleted {
                    Text("This message was deleted")
                        .font(.callout)
                        .italic()
                        .foregroundStyle(.tertiary)
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(renderMarkdown(message.body))
                            .font(.callout)
                            .textSelection(.enabled)
                        if message.editedAt != nil {
                            Text("(edited)")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        if message.pending {
                            ProgressView()
                                .controlSize(.mini)
                        }
                    }
                }

                if showThreadAffordances, message.replyCount > 0 {
                    Button {
                        onOpenThread(message.id)
                    } label: {
                        Label(
                            "\(message.replyCount) \(message.replyCount == 1 ? "reply" : "replies")",
                            systemImage: "bubble.left.and.bubble.right"
                        )
                        .font(.caption)
                    }
                    .buttonStyle(.link)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.top, showHeader ? 8 : 1)
        .padding(.bottom, 1)
        .opacity(message.pending ? 0.55 : 1)
        .contentShape(Rectangle())
        .contextMenu {
            if showThreadAffordances {
                Button("Reply in Thread") {
                    onOpenThread(message.threadRootId ?? message.id)
                }
            }
            if isMine, !message.isDeleted, !message.pending {
                Button("Edit…") { onEdit(message) }
                Button("Delete", role: .destructive) { onDelete(message) }
            }
        }
    }

    private var avatar: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(avatarColor)
            .frame(width: 30, height: 30)
            .overlay(
                Text(initials)
                    .font(.caption.bold())
                    .foregroundStyle(.white)
            )
    }

    private var initials: String {
        let parts = senderName.split(separator: " ")
        let chars = parts.prefix(2).compactMap(\.first)
        return chars.isEmpty ? "?" : String(chars).uppercased()
    }

    private var avatarColor: Color {
        let palette: [Color] = [.blue, .purple, .pink, .orange, .teal, .indigo, .mint, .brown]
        var hash = 0
        for scalar in message.userId.unicodeScalars {
            hash = (hash &* 31 &+ Int(scalar.value)) & 0x7fffffff
        }
        return palette[hash % palette.count]
    }

    private func renderMarkdown(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        )) ?? AttributedString(text)
    }
}

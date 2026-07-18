import SwiftUI

/// Bell popover: recent notifications, newest first; opening navigates to the
/// channel/thread; "Mark all read" clears the badge.
struct NotificationsPopover: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var items: [NotificationItem] = []
    @State private var userNames: [String: String] = [:]
    @State private var loading = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Notifications").font(.headline)
                Spacer()
                if let newest = items.first {
                    Button("Mark all read") {
                        Task {
                            await app.engine.markNotificationsRead(upToId: newest.id)
                            for i in items.indices where items[i].readAt == nil {
                                items[i] = withRead(items[i])
                            }
                        }
                    }
                    .font(.caption)
                    .accessibilityIdentifier("notifications.markAllRead")
                }
            }
            .padding(12)
            Divider()

            if loading {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else if items.isEmpty {
                Text("No notifications yet")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(items) { n in
                            row(n)
                            Divider()
                        }
                    }
                }
                .frame(maxHeight: 360)
            }
        }
        .frame(width: 360)
        .task {
            defer { loading = false }
            if let resp = try? await app.engine.fetchNotifications() {
                items = resp.notifications
            }
            userNames = (try? await app.db.reader.read { db in
                try Dictionary(
                    uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayName) }
                )
            }) ?? [:]
        }
    }

    private func row(_ n: NotificationItem) -> some View {
        Button {
            dismiss()
            app.openNotification(n)
            Task { await app.engine.markNotificationsRead(upToId: n.id) }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: icon(for: n.kind))
                    .foregroundStyle(n.readAt == nil ? Color.accentColor : Color.secondary)
                    .frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline(n))
                        .font(.callout.weight(n.readAt == nil ? .semibold : .regular))
                    Text(MentionRendering.plainText(n.message.body, names: userNames))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Text(ISO8601.displayTime(n.createdAt))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Spacer()
                if n.readAt == nil {
                    Circle().fill(Color.accentColor).frame(width: 7, height: 7)
                        .padding(.top, 5)
                }
            }
            .padding(10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("notifications.item.\(n.id)")
    }

    private func headline(_ n: NotificationItem) -> String {
        let sender = userNames[n.message.userId] ?? "Someone"
        return switch n.kind {
        case 1: "\(sender) sent you a direct message"
        case 2: "\(sender) replied in a thread"
        case 3: "\(sender) posted"
        default: "\(sender) mentioned you"
        }
    }

    private func icon(for kind: Int) -> String {
        switch kind {
        case 1: "envelope"
        case 2: "bubble.left.and.bubble.right"
        case 3: "message"
        default: "at"
        }
    }

    private func withRead(_ n: NotificationItem) -> NotificationItem {
        NotificationItem(
            id: n.id, userId: n.userId, messageId: n.messageId, channelId: n.channelId,
            workspaceId: n.workspaceId, kind: n.kind, createdAt: n.createdAt,
            readAt: ISO8601.now(), message: n.message
        )
    }
}

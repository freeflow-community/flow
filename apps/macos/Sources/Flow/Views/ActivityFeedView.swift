import SwiftUI

/// Activity feed (phase 12) — the always-present virtual "channel" that replaced
/// the notifications bell. It surfaces this user's notification rows (mentions,
/// DMs, thread replies, notify-all activity) as a full-pane, message-like list.
/// Not a real channel: no server row — the data is the same /v1/me/notifications
/// feed the bell popover used.
///
/// Opening it behaves like opening a channel: everything up to the newest row is
/// marked read and the sidebar badge clears. Clicking a row jumps to the
/// originating message (switching workspace / opening the thread as needed).
struct ActivityFeedView: View {
    @EnvironmentObject private var app: AppState
    @State private var items: [NotificationItem] = []
    @State private var userNames: [String: String] = [:]
    @State private var loading = true
    /// Newest row we've already marked read, so a re-fetch doesn't re-POST.
    @State private var markedNewestId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()

            if loading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if items.isEmpty {
                Text("No activity yet")
                    .foregroundStyle(MC.faint)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(items) { n in
                            row(n)
                            Divider()
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(MC.base)
        // task(id:) → refetches whenever a new notification arrives while we're
        // open; marking read below bumps the count to 0, which settles here.
        .task(id: app.notificationUnread) {
            defer { loading = false }
            if let resp = try? await app.engine.fetchNotifications() {
                items = resp.notifications
            }
            userNames = (try? await app.db.reader.read { db in
                try Dictionary(
                    uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayNameWithBadge) }
                )
            }) ?? [:]
            // Opening the feed marks everything up to the newest row read
            // (channel semantics), clearing the sidebar badge.
            if let newest = items.first, markedNewestId != newest.id {
                markedNewestId = newest.id
                await app.engine.markNotificationsRead(upToId: newest.id)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text("#").foregroundStyle(MC.muted)
                Text("Activity")
            }
            .font(.system(size: 15, weight: .bold))
            .accessibilityIdentifier("activity.header")
            Text("Mentions, direct messages & replies")
                .font(.caption)
                .foregroundStyle(MC.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 22)
        .frame(height: 60)
    }

    private func row(_ n: NotificationItem) -> some View {
        let sender = userNames[n.message.userId] ?? "Someone"
        return Button {
            app.openNotification(n)
            Task { await app.engine.markNotificationsRead(upToId: n.id) }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                AvatarChip(
                    userId: n.message.userId,
                    name: sender,
                    avatarPath: app.avatarPaths[n.message.userId],
                    size: 34,
                    radius: 9
                )
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(headline(n, sender: sender))
                            .font(.callout.weight(n.readAt == nil ? .semibold : .regular))
                        Spacer(minLength: 8)
                        Text(ISO8601.displayTime(n.createdAt))
                            .font(.caption2)
                            .foregroundStyle(MC.faint)
                    }
                    Text(MentionRendering.plainText(n.message.body, names: userNames))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if n.readAt == nil {
                    Circle().fill(MC.unread).frame(width: 7, height: 7).padding(.top, 6)
                }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("activity.item.\(n.id)")
    }

    private func headline(_ n: NotificationItem, sender: String) -> String {
        switch n.kind {
        case 1: "\(sender) sent you a direct message"
        case 2: "\(sender) replied in a thread"
        case 3: "\(sender) posted"
        default: "\(sender) mentioned you"
        }
    }
}

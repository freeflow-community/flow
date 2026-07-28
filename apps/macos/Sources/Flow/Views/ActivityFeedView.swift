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
        // open, or the workspace changes; marking read below bumps the count to
        // 0, which settles here.
        .task(id: FeedKey(unread: app.notificationUnread, workspaceId: app.selectedWorkspaceId)) {
            defer { loading = false }
            if let resp = try? await app.engine.fetchNotifications(
                workspaceId: app.selectedWorkspaceId
            ) {
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
                await app.engine.markNotificationsRead(
                    upToId: newest.id, workspaceId: app.selectedWorkspaceId
                )
            }
        }
    }

    /// Refetch trigger: a new notification, or a workspace switch (a different
    /// workspace is a different feed).
    private struct FeedKey: Equatable {
        let unread: Int
        let workspaceId: String?
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
        // Who to show: the reactor on a reaction row, the author otherwise.
        let actorId = n.actorUserId
        let sender = userNames[actorId] ?? "Someone"
        return Button {
            app.openNotification(n)
            Task { await app.engine.markNotificationRead(id: n.id) }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                AvatarChip(
                    userId: actorId,
                    name: sender,
                    avatarPath: app.avatarPaths[actorId],
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
        case 4: "\(sender) reacted \(n.reactionEmoji ?? "") to your message"
            .replacingOccurrences(of: "  ", with: " ")
        default: "\(sender) mentioned you"
        }
    }
}

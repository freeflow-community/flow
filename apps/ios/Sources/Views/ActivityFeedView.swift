import SwiftUI
import GRDB

/// Activity feed (phase 12) — the always-present virtual "channel" that gives
/// iOS the alerted-message view the other clients show. It surfaces this user's
/// notification rows (mentions, DMs, thread replies, notify-all activity) as a
/// list. Not a real channel: no server row — it reads the same
/// /v1/me/notifications feed the web/macOS Activity views use.
///
/// Opening it marks everything up to the newest row read (clearing the app-icon
/// badge). Tapping a row jumps to the originating channel (switching workspace
/// if needed) via the stack `MainView` owns.
struct ActivityFeedView: View {
    /// Replaces the nav stack with the tapped notification's channel — pops the
    /// feed and lands in the conversation (the way the sidebar clients select).
    var onOpenChannel: (String) -> Void = { _ in }

    @EnvironmentObject private var app: AppState
    @State private var items: [NotificationItem] = []
    @State private var userNames: [String: String] = [:]
    /// channelId → name, for the "in #bugs" suffix on a row (#267). DMs have no
    /// name and never get one.
    @State private var channelNames: [String: String] = [:]
    @State private var loading = true
    /// Newest row we've already marked read, so a re-fetch doesn't re-POST.
    @State private var markedNewestId: String?

    var body: some View {
        Group {
            if loading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if items.isEmpty {
                Text("No activity yet")
                    .foregroundStyle(MC.faint)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(items) { n in
                    row(n)
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.inline)
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
            channelNames = (try? await app.db.reader.read { db in
                try Dictionary(
                    uniqueKeysWithValues: Channel.fetchAll(db).compactMap { c in
                        c.name.map { (c.id, $0) }
                    }
                )
            }) ?? [:]
            // Opening the feed marks everything up to the newest row read
            // (channel semantics), clearing the app badge.
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

    private func row(_ n: NotificationItem) -> some View {
        // Who to show: the reactor on a reaction row, the author otherwise.
        let actorId = n.actorUserId
        let sender = userNames[actorId] ?? "Someone"
        return Button {
            if app.selectedWorkspaceId != n.workspaceId {
                app.selectWorkspace(n.workspaceId)
            }
            // Scroll to + flash the exact message on arrival (phase 12). Only
            // top-level messages: thread replies live in a separate pushed
            // screen on iOS (CHANGELOG Parity).
            app.focusMessageId = n.message.threadRootId == nil ? n.messageId : nil
            Task { await app.engine.markNotificationRead(id: n.id) }
            onOpenChannel(n.channelId)
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
                        Text(n.headline(sender: sender, channelName: channelNames[n.channelId]))
                            .font(.callout.weight(n.readAt == nil ? .semibold : .regular))
                            .foregroundStyle(MC.ink)
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
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("activity.item.\(n.id)")
    }
}

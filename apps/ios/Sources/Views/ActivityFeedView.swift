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
            // (channel semantics), clearing the app badge.
            if let newest = items.first, markedNewestId != newest.id {
                markedNewestId = newest.id
                await app.engine.markNotificationsRead(upToId: newest.id)
            }
        }
    }

    private func row(_ n: NotificationItem) -> some View {
        let sender = userNames[n.message.userId] ?? "Someone"
        return Button {
            if app.selectedWorkspaceId != n.workspaceId {
                app.selectWorkspace(n.workspaceId)
            }
            // Scroll to + flash the exact message on arrival (phase 12). Only
            // top-level messages: thread replies live in a separate pushed
            // screen on iOS (CHANGELOG Parity).
            app.focusMessageId = n.message.threadRootId == nil ? n.messageId : nil
            Task { await app.engine.markNotificationsRead(upToId: n.id) }
            onOpenChannel(n.channelId)
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

    private func headline(_ n: NotificationItem, sender: String) -> String {
        switch n.kind {
        case 1: "\(sender) sent you a direct message"
        case 2: "\(sender) replied in a thread"
        case 3: "\(sender) posted"
        default: "\(sender) mentioned you"
        }
    }
}

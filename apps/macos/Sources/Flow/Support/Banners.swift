import Foundation
import UserNotifications
import AppKit

/// Local OS notification banners (phase2.md §4 — UNUserNotificationCenter,
/// no APNs). UserNotifications requires a real .app bundle; when running as a
/// bare SwiftPM executable (dev/QA path) `Bundle.main.bundleIdentifier` is nil
/// and every call here becomes a no-op — in-app notification UI still works.
enum Banners {
    static var available: Bool { Bundle.main.bundleIdentifier != nil }

    @MainActor private static var permissionRequested = false

    @MainActor
    static func requestPermissionIfNeeded() {
        guard available, !permissionRequested else { return }
        permissionRequested = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    /// Post a banner for `n`. The navigation fields ride along in `userInfo` so
    /// tapping the banner can jump to the message (see `AppDelegate`'s
    /// notification-center delegate).
    static func show(_ n: NotificationItem, title: String, body: String) {
        guard available else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        var userInfo: [AnyHashable: Any] = [
            "workspaceId": n.workspaceId,
            "channelId": n.channelId,
            "messageId": n.messageId,
        ]
        if let root = n.message.threadRootId { userInfo["threadRootId"] = root }
        content.userInfo = userInfo
        let request = UNNotificationRequest(identifier: n.id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// Dock badge with the unread notification count (works bundled or bare).
    @MainActor
    static func setBadge(_ count: Int) {
        NSApplication.shared.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
    }
}

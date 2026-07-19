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

    static func show(title: String, body: String, id: String) {
        guard available else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// Dock badge with the unread notification count (works bundled or bare).
    @MainActor
    static func setBadge(_ count: Int) {
        NSApplication.shared.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
    }
}

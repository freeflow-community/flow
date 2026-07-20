import Foundation
import UserNotifications

/// iOS implementation of the Banners helper the shared AppState/SyncEngine
/// call into. App-icon badge is live (unread notification count — mentions,
/// DMs, thread replies — matching the macOS dock badge). Local banner
/// notifications stay no-ops until the push-notification phase: the socket
/// is suspended in the background, and foreground banners would just
/// double-notify the visible app.
enum Banners {
    @MainActor private static var permissionRequested = false

    @MainActor
    static func requestPermissionIfNeeded() {
        #if DEBUG
        // Headless QA drives the simulator via FLOW_DEBUG_* hooks; a system
        // permission alert would wedge those runs (simctl cannot tap), so
        // skip the prompt whenever debug hooks are in play.
        let env = ProcessInfo.processInfo.environment
        if env.keys.contains(where: { $0.hasPrefix("FLOW_DEBUG_") }) { return }
        #endif
        guard !permissionRequested else { return }
        permissionRequested = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.badge]) { _, _ in }
    }

    /// No local banners yet (push phase); in-app notification UI still works.
    static func show(title: String, body: String, id: String) {}

    /// App-icon badge with the unread notification count.
    @MainActor
    static func setBadge(_ count: Int) {
        UNUserNotificationCenter.current().setBadgeCount(count)
    }
}

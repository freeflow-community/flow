import Foundation
import UserNotifications
import AppKit

/// Local OS notification banners (phase2.md §4 — UNUserNotificationCenter,
/// no APNs). UserNotifications requires a real .app bundle; when running as a
/// bare SwiftPM executable (dev/QA path) or inside `swift test` every call
/// here becomes a no-op — in-app notification UI still works. The identifier
/// check alone is not enough: the xctest runner *has* a bundle identifier but
/// no app bundle, and `UNUserNotificationCenter.current()` throws there,
/// killing whichever test is running when a signed-in bootstrap reaches it.
enum Banners {
    static var available: Bool {
        Bundle.main.bundleIdentifier != nil && Bundle.main.bundleURL.pathExtension == "app"
    }

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
    ///
    /// `sound: false` is the `sound` pref (#251, #464) off: the banner still
    /// appears, it just doesn't make a noise. The content carries no sound at
    /// all rather than a silent one, which is also what the delegate reads to
    /// decide whether to ask for `.sound` when the app is frontmost.
    static func show(_ n: NotificationItem, title: String, body: String, sound: Bool = true) {
        guard available else { return }
        // Log instead of silently dropping: "banner didn't appear" has too many
        // OS-level causes (denied permission, Focus, alert style None) to stay
        // undiagnosable. Console.app / `log stream` filtered on "Flow banners".
        // The request is built inside the callback so the @Sendable closure
        // only captures value types (n/title/body).
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized else {
                NSLog("Flow banners: not posted — authorizationStatus=%d (2=denied, 0=never asked)",
                      settings.authorizationStatus.rawValue)
                return
            }
            if settings.alertStyle == .none {
                NSLog("Flow banners: authorized but alert style is None (System Settings > Notifications > Flow)")
            }
            var userInfo: [AnyHashable: Any] = [
                "workspaceId": n.workspaceId,
                "channelId": n.channelId,
                "messageId": n.messageId,
            ]
            if let root = n.message.threadRootId { userInfo["threadRootId"] = root }
            let content = makeContent(title: title, body: body, userInfo: userInfo, sound: sound)
            let request = UNNotificationRequest(identifier: n.id, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request) { error in
                if let error { NSLog("Flow banners: add failed: %@", error.localizedDescription) }
            }
        }
    }

    /// The banner's content. Split out from `show` so the one branch that has
    /// no OS-level observable — a silenced alert looks exactly like a noisy one
    /// in a screenshot — is testable.
    static func makeContent(
        title: String, body: String, userInfo: [AnyHashable: Any], sound: Bool
    ) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        // No sound at all, rather than a silent one: `UNNotificationSound` has
        // no "none" case, and a nil sound is also what the foreground delegate
        // reads to decide whether to ask for `.sound`.
        content.sound = sound ? .default : nil
        content.userInfo = userInfo
        return content
    }

    /// What the app asks for when a banner arrives while Flow is frontmost.
    /// Requesting `.sound` for a request that carries none is how a "silenced"
    /// alert still chimes on the foreground path, so this follows the content.
    static func presentationOptions(hasSound: Bool) -> UNNotificationPresentationOptions {
        hasSound ? [.banner, .sound] : [.banner]
    }

    /// Dock badge with the unread notification count (works bundled or bare).
    @MainActor
    static func setBadge(_ count: Int) {
        NSApplication.shared.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
    }
}

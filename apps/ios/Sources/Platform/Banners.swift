import Foundation
import UIKit
import UserNotifications

/// iOS implementation of the Banners helper the shared AppState/SyncEngine
/// call into. Since the APNs phase (#249) this is the local half of push:
/// permission, remote registration, and the app-icon badge. Alerts themselves
/// arrive from the server over APNs — `show` stays a no-op, because posting a
/// *second*, local notification for a message whose push already landed would
/// double-notify, and the socket is suspended in the background anyway.
enum Banners {
    @MainActor private static var permissionRequested = false

    /// Which APNs environment this build's `aps-environment` entitlement names
    /// (`project.yml` sets `APS_ENVIRONMENT` per configuration). The server
    /// stores it per device and picks the matching APNs host, so getting it
    /// wrong is a token that answers every send with BadDeviceToken.
    static var apnsEnvironment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    /// The APNs topic — the app's own bundle id.
    static var apnsTopic: String { Bundle.main.bundleIdentifier ?? "im.freeflow.app" }

    /// Ask for alerts and register with APNs. Called from `SyncEngine.didSignIn`,
    /// so it runs on every cold start of a signed-in app — which is the policy
    /// the registry wants: APNs rotates tokens silently on restore-from-backup
    /// and reinstall, and re-registering every launch is cheaper than detecting
    /// that.
    @MainActor
    static func requestPermissionIfNeeded() {
        // Registration first, and unconditionally: it puts nothing on screen,
        // and a token is what silent badge-sync pushes need even when the user
        // has said no to alerts. The delegate POSTs it to /v1/me/devices when
        // APNs answers.
        UIApplication.shared.registerForRemoteNotifications()
        #if DEBUG
        // Headless QA drives the simulator via FLOW_DEBUG_* hooks; a system
        // permission alert would wedge those runs (simctl cannot tap), so
        // skip the prompt whenever debug hooks are in play. Only the prompt —
        // registering above and `simctl push` below both work regardless.
        let env = ProcessInfo.processInfo.environment
        if env.keys.contains(where: { $0.hasPrefix("FLOW_DEBUG_") }) { return }
        #endif
        guard !permissionRequested else { return }
        permissionRequested = true
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    /// No local banners: an alert for this message is already on its way from
    /// the server (#248), and the foreground rule lives in the push delegate.
    /// Signature mirrors the macOS `Banners.show` the shared `SyncEngine` calls.
    ///
    /// `sound` is accepted and ignored on purpose (#464). macOS builds its own
    /// banner, so it is the client that has to honour the pref; here the alert
    /// is built server-side, and `pushOutbox` already omits the APNs `sound`
    /// key when the pref is off. Taking the argument anyway keeps one shared
    /// call site in `SyncEngine` — the drift that broke this build was the
    /// signature diverging, not the behaviour.
    static func show(_ n: NotificationItem, title: String, body: String, sound: Bool = true) {}

    /// App-icon badge with the unread notification count.
    @MainActor
    static func setBadge(_ count: Int) {
        UNUserNotificationCenter.current().setBadgeCount(count)
    }

    /// Sign-out: pushes in Notification Center belong to the session that just
    /// ended, and tapping one afterwards would route into a wiped cache.
    @MainActor
    static func clearDelivered() {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }
}

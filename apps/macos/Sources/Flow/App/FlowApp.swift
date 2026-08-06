import AppKit
import SwiftUI
import UserNotifications

@main
struct FlowApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var app = AppState()
    @StateObject private var updater = AppUpdater()
    @StateObject private var zoom = TextZoom()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup(Profile.windowTitle) {
            // Each window gets its own RootView instance, which owns that
            // window's WindowState — so ⌘N windows navigate independently.
            RootView(app: app)
                .environmentObject(app)
                // One scale for the whole app (#105) — every font is drawn
                // through `flowFont`, which reads this on the way past.
                .environment(\.textZoom, zoom.scale)
                .onAppear { TextZoomShortcuts.install(zoom) }
                .frame(minWidth: 900, minHeight: 560)
                // "Is the user actually looking at us?" — the native answer to
                // the web client's `document.hidden`. A selected channel in a
                // hidden window must not mark its mail read (issue #63).
                .onChange(of: scenePhase) { _, phase in app.setAppActive(phase == .active) }
                // Hand the app state to the notification-center delegate so a
                // tapped banner can jump to its message (and flush any tap that
                // arrived before the UI was ready, e.g. a cold launch).
                .onAppear { appDelegate.attach(app) }
                // Claim flow:// deep links for the window that is already open.
                // Without this, a URL arriving at a running app makes SwiftUI
                // spawn a *second* window to service it — which the Google
                // sign-in handoff hit every time, since you press that button
                // from inside a running app (RootView.onOpenURL then fires in
                // the new window, so the sign-in worked but you got a duplicate).
                .handlesExternalEvents(preferring: ["*"], allowing: ["*"])
        }
        .handlesExternalEvents(matching: ["*"])
        // Standard placement: right under "About Flow" in the app menu.
        .commands {
            CommandGroup(after: .appInfo) {
                CheckForUpdatesCommand(updater: updater)
            }
            // `.sidebar` anchors the top of the View menu — where Mac apps
            // keep zoom.
            CommandGroup(after: .sidebar) {
                TextZoomCommands(zoom: zoom)
                Divider()
            }
        }
    }
}

/// Brings the window to front when launched as a bare SwiftPM executable, and
/// routes OS notification-banner taps to the message they came from.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private weak var appState: AppState?
    /// A banner tapped before `appState` was wired up (cold launch) — replayed
    /// once it arrives.
    private var pendingTap: NotificationTap?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Flow's palette (`MC`) is a single fixed *light* theme — the same
        // tokens the web client hard-codes in index.css, which has no dark
        // theme either. Nothing in the UI repaints for a dark appearance, but
        // anything drawn in a system colour does: on a Mac set to Dark, every
        // view that doesn't name its own colour resolves `.primary`/`.label`
        // to white and lands on MC.base, which is near-white. Message bodies
        // and the avatar menu became unreadable that way.
        //
        // Pinning the process to Aqua fixes all of them at once, and covers
        // the AppKit surfaces SwiftUI's `preferredColorScheme` doesn't reach
        // (menus, alerts, the composer's NSTextView). This is the app opting
        // out of dark mode, not a workaround — supporting it properly means a
        // second palette on all three clients.
        NSApp.appearance = NSAppearance(named: .aqua)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        // Same bundle guard every other UserNotifications call site uses (see
        // `Banners.available`): `current()` traps outright when the process has
        // no bundle identifier, so a bare `swift run Flow` aborted in
        // `applicationDidFinishLaunching` before the window ever appeared.
        // Nothing is lost when unbundled — banners can't be delivered there, so
        // there is no tap for this delegate to route.
        if Banners.available { UNUserNotificationCenter.current().delegate = self }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func attach(_ state: AppState) {
        appState = state
        if let tap = pendingTap {
            pendingTap = nil
            state.openNotification(
                workspaceId: tap.workspaceId,
                channelId: tap.channelId,
                messageId: tap.messageId,
                threadRootId: tap.threadRootId
            )
        }
    }

    // Show the banner even when Flow is frontmost — SyncEngine only posts one
    // when the user isn't already looking at that channel, so it's never noise.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    // Banner tapped: bring the app forward and jump to the message.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        let workspaceId = info["workspaceId"] as? String
        let channelId = info["channelId"] as? String
        let messageId = info["messageId"] as? String
        let threadRootId = info["threadRootId"] as? String
        if let workspaceId, let channelId, let messageId {
            let tap = NotificationTap(
                workspaceId: workspaceId, channelId: channelId,
                messageId: messageId, threadRootId: threadRootId
            )
            Task { @MainActor in self.route(tap) }
        }
        completionHandler()
    }

    @MainActor
    private func route(_ tap: NotificationTap) {
        NSApp.activate(ignoringOtherApps: true)
        guard let appState else {
            pendingTap = tap
            return
        }
        appState.openNotification(
            workspaceId: tap.workspaceId,
            channelId: tap.channelId,
            messageId: tap.messageId,
            threadRootId: tap.threadRootId
        )
    }
}

/// The navigation fields lifted out of a tapped banner's `userInfo` — a small
/// Sendable value so it can cross the delegate's actor hop.
private struct NotificationTap: Sendable {
    let workspaceId: String
    let channelId: String
    let messageId: String
    let threadRootId: String?
}

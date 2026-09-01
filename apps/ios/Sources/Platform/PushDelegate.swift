import UIKit
import UserNotifications

/// The APNs half of the iOS client (#249, PUSH_APNS.md § *Client: iOS*):
/// device-token registration, the foreground rule, and tap routing.
///
/// It is an app delegate rather than SwiftUI plumbing because all three
/// entry points are UIKit callbacks that fire before — and outside — any view:
/// a token can arrive during launch, and a tap on a push that launched the app
/// is delivered before `RootView` exists. Hence `attach`, and the two "pending"
/// fields it replays: the same cold-launch handling the macOS delegate does.
@MainActor
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    private weak var appState: AppState?
    /// A token APNs handed over before the app state existed.
    private var pendingToken: String?
    /// A push tapped before the app state existed (cold launch from a banner).
    private var pendingTap: PushPayload?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    /// Wired from `FlowApp`'s `onAppear`, once the state the callbacks need
    /// exists.
    func attach(_ state: AppState) {
        appState = state
        if let token = pendingToken {
            pendingToken = nil
            register(token: token, with: state)
        }
        if let tap = pendingTap {
            pendingTap = nil
            route(tap, with: state)
        }
    }

    // MARK: - Registration

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        // Hex, lowercase — the shape `DeviceTokenParam` validates and the
        // server stores.
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        guard let appState else {
            pendingToken = token
            return
        }
        register(token: token, with: appState)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Expected on a simulator with no Apple ID, and survivable everywhere
        // else: without a token the phone simply gets nothing while it is
        // asleep. Logged rather than surfaced, because there is nothing the
        // person using the app can do about it.
        NSLog("Flow push: registration failed: %@", error.localizedDescription)
    }

    private func register(token: String, with state: AppState) {
        let environment = Banners.apnsEnvironment
        let bundleId = Banners.apnsTopic
        Task {
            await state.engine.registerPushDevice(
                token: token, environment: environment, bundleId: bundleId
            )
        }
    }

    // MARK: - Silent badge-sync pushes (#248)

    /// `content-available: 1` with just a count. iOS applies `aps.badge`
    /// itself; this exists so the *in-app* counters (the Activity badge, the
    /// sidebar) converge too — reading a mention on the laptop should settle
    /// the phone completely, not only its icon.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        guard let badge = PushPayload.badge(from: userInfo) else { return .noData }
        Banners.setBadge(badge)
        guard let appState else { return .newData }
        await appState.engine.refreshNotificationBadge()
        return .newData
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// The foreground rule. "Don't banner what I'm already reading" is a client
    /// decision by design — the server stays dumb about what is on screen — and
    /// the decision itself lives in `PushPayload.shouldPresentBanner`, where it
    /// is testable without a device.
    /// `nonisolated` (and the hop below) because `UNNotification` is not
    /// Sendable: the delegate callbacks can't be witnessed by main-actor
    /// methods, so the payload is read here and only the parsed value crosses.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let info = notification.request.content.userInfo
        let badge = PushPayload.badge(from: info)
        let payload = PushPayload(userInfo: info)
        return await MainActor.run { () -> UNNotificationPresentationOptions in
            if let badge { Banners.setBadge(badge) }
            guard let payload else { return [] }
            let present = PushPayload.shouldPresentBanner(
                payload: payload,
                appActive: self.appState?.isAppActive ?? false,
                visibleChannelId: self.appState?.selectedChannelId,
                openThreadRootId: self.appState?.openThreadRootId
            )
            return present ? [.banner, .sound] : []
        }
    }

    /// Tapped: select the workspace, open the channel, focus the message, and
    /// mark exactly this notification row read.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let payload = PushPayload(userInfo: response.notification.request.content.userInfo)
        else { return }
        await MainActor.run {
            guard let appState = self.appState else {
                // Cold launch from a banner: the tap beat the UI. Replayed by
                // `attach`.
                self.pendingTap = payload
                return
            }
            self.route(payload, with: appState)
        }
    }

    private func route(_ payload: PushPayload, with state: AppState) {
        // Thread routing on iOS waits on the thread-route Parity gap
        // (CHANGELOG.md), so a reply lands in its channel with the message
        // focused rather than inside the thread screen. Passing nil here is
        // that gap, not an oversight: a non-nil root would open a thread panel
        // the phone does not have.
        // Straight at the single window rather than `AppState.openNotification`,
        // whose `routingWindow` is nil until a view has asked for the window —
        // which a tap that launched the app can beat.
        state.window.openNotification(
            workspaceId: payload.workspaceId,
            channelId: payload.channelId,
            messageId: payload.messageId,
            threadRootId: nil
        )
        guard let notificationId = payload.notificationId else { return }
        Task { await state.engine.markNotificationRead(id: notificationId) }
    }
}

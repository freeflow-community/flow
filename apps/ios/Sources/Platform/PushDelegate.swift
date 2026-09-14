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

    /// Wired from `FlowApp` — on `onAppear`, once the state the callbacks need
    /// exists, and again on every change of `AppState.phase`.
    ///
    /// Idempotent, and called more than once on purpose: a tapped push is only
    /// routable once the app is *signed in*, not merely once a view exists.
    /// Routing into `.loading` looked like it worked and wasn't (#458): the
    /// bootstrap that follows publishes `.signedOut` for the moment before the
    /// session resolves, and `AppState.setPhase` answers that with
    /// `clearForSignOut()`, which wipes the selected channel and `lastChannelId`
    /// both — so a cold-launch tap opened the right workspace at "Select a
    /// channel". Waiting for `.signedIn` is what makes the cold-start tap land.
    func attach(_ state: AppState) {
        appState = state
        if let token = pendingToken {
            pendingToken = nil
            register(token: token, with: state)
        }
        deliverPendingTap()
    }

    /// Whether a tapped push can be routed in this app phase.
    ///
    /// Only `.signedIn`. `.loading` looks routable and isn't — the bootstrap
    /// behind it publishes `.signedOut` on its way, and that wipes the window's
    /// selection (#458). Static and pure so the rule is one testable thing.
    nonisolated static func canRoute(phase: AppState.Phase) -> Bool {
        if case .signedIn = phase { return true }
        return false
    }

    /// Route a tap that has been waiting for the app to be ready, if it is now.
    /// A tap held past a sign-out simply stays held: it addresses a channel of
    /// the account the push was sent to, and signing back in is when it becomes
    /// meaningful again.
    private func deliverPendingTap() {
        guard let state = appState, Self.canRoute(phase: state.phase), let tap = pendingTap
        else { return }
        pendingTap = nil
        route(tap, with: state)
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
            for connection in state.connections.registry.connections {
                guard let target = state.connections.appState(connection.connectionId) else { continue }
                await target.engine.registerPushDevice(token: token, environment: environment, bundleId: bundleId)
            }
        }
    }

    // MARK: - Silent badge-sync pushes (#248)

    /// `content-available: 1` with just a count. This exists so the *in-app*
    /// counters (the Activity badge, the sidebar) converge too — reading a
    /// mention on the laptop should settle the phone completely, not only its
    /// icon.
    ///
    /// Which connection it belongs to is decided first (#542). An identifier we
    /// did not issue, or one belonging to a connection that has been removed,
    /// is ignored outright: a stale push must not move a number, and it must
    /// certainly not settle a *different* server's counters.
    ///
    /// The absolute `aps.badge` is applied only for a **legacy** registration —
    /// the one with no routing id, which is still the sole owner of the icon.
    /// A multi-server backend is never sent one (`sendPush` strips it), because
    /// no backend can see the others; that badge is the client's own sum, and
    /// `refreshAggregateBadge` writes it.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        guard let badge = PushPayload.badge(from: userInfo) else { return .noData }
        let routingId = PushPayload.routingId(from: userInfo)
        guard let appState, let owner = appState.connections.notificationApp(routingId: routingId)
        else { return .noData }
        if routingId == nil { Banners.setBadge(badge) }
        await owner.engine.refreshNotificationBadge()
        owner.connections.refreshAggregateBadge()
        return .newData
    }

    // MARK: - UNUserNotificationCenterDelegate

    // Both callbacks below are written in their **completion-handler** form
    // rather than the tidier `async` one, and that is the fix for #458.
    //
    // Swift bridges an `async` delegate method to the ObjC selector by calling
    // the completion handler when the function returns — on whatever
    // cooperative-pool thread it happened to finish on. UIKit does main-thread
    // work inside both handlers (the tap handler snapshots the app for state
    // restoration), so the tap path aborted every single time with
    // `NSInternalInconsistencyException: Call must be made on main thread`,
    // *after* the routing had already been applied. Hopping to the main actor
    // inside the body, as the async version did, is not enough: the handler
    // call itself is the part that has to be on the main thread.
    //
    // Spelling the handler out puts it inside the hop, and makes the other
    // contract visible too — it must be called exactly once on every path,
    // including the ones that decline to do anything.

    /// The foreground rule. "Don't banner what I'm already reading" is a client
    /// decision by design — the server stays dumb about what is on screen — and
    /// the decision itself lives in `PushPayload.shouldPresentBanner`, where it
    /// is testable without a device.
    /// `nonisolated` because `UNNotification` is not Sendable: the delegate
    /// callbacks can't be witnessed by main-actor methods, so the payload is
    /// read here and only the parsed value crosses.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let info = notification.request.content.userInfo
        let badge = PushPayload.badge(from: info)
        let payload = PushPayload(userInfo: info)
        let reply = MainActorHandoff(completionHandler)
        Task { @MainActor in
            guard let payload, let owner = self.appState?.connections.notificationApp(routingId: payload.routingId) else { return reply.value([]) }
            // Badge after routing, never before: a push for a connection that
            // has been removed — or one whose identifier we never issued — is
            // not allowed to move the icon (#542). And only a legacy
            // registration carries an authoritative one at all; multi-server
            // badges are the client's own aggregate.
            if let badge, payload.routingId == nil { Banners.setBadge(badge) }
            let present = PushPayload.shouldPresentBanner(
                payload: payload,
                appActive: owner === self.appState && owner.isAppActive,
                visibleChannelId: owner.selectedChannelId,
                openThreadRootId: owner.openThreadRootId
            )
            // #251: the `sound` pref applies to a foreground banner too. The
            // push the server sent while backgrounded already had `aps.sound`
            // omitted, but a foreground presentation names its own options, so
            // the rule has to be applied on both sides of the same pref.
            let sound = self.appState?.currentUser?.prefs.isOn(\.sound) ?? true
            let options: UNNotificationPresentationOptions = sound ? [.banner, .sound] : [.banner]
            reply.value(present ? options : [])
        }
    }

    /// Tapped: select the workspace, open the channel, focus the message, and
    /// mark exactly this notification row read.
    ///
    /// A payload we can't route — a badge-sync push, or one missing or with an
    /// empty routing key — is not an error here: the tap has already brought
    /// the app to the front, which is the sane thing to do with it. It lands
    /// wherever it was, and nothing navigates (#458 AC3).
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let payload = PushPayload(userInfo: response.notification.request.content.userInfo)
        let reply = MainActorHandoff(completionHandler)
        Task { @MainActor in
            defer { reply.value() }
            guard let payload else { return }
            guard let appState = self.appState, Self.canRoute(phase: appState.phase) else {
                // The tap beat the app: a cold launch from a banner delivers it
                // before any view exists, and even once one does the session may
                // still be resolving. Replayed by `attach` as soon as both are
                // true.
                self.pendingTap = payload
                return
            }
            self.route(payload, with: appState)
        }
    }

    private func route(_ payload: PushPayload, with initial: AppState) {
        guard let state = initial.connections.notificationApp(routingId: payload.routingId) else { return }
        guard Self.canRoute(phase: state.phase) else {
            Task {
                await state.engine.bootstrap()
                if Self.canRoute(phase: state.phase) { self.route(payload, with: state) }
            }
            return
        }
        NotificationCenter.default.post(name: .init("flow.selectConnection"), object: state)
        // The push has carried `threadRootId` since #248; it is passed on now
        // (#476), so a tap on a thread reply opens the thread and scrolls to
        // the reply instead of dropping the reader in the channel to hunt for
        // it. It used to be nil on purpose — the phone had no thread
        // destination to route to — but `ChannelScreen`'s `$threadRoute` (#89)
        // and `ThreadScreen`'s jump target (#332) both landed since, so the two
        // halves the Parity gap was waiting on exist. A top-level message still
        // sends nil, which closes any thread parked in the target channel so it
        // cannot hide the message being jumped to.
        // Straight at the single window rather than `AppState.openNotification`,
        // whose `routingWindow` is nil until a view has asked for the window —
        // which a tap that launched the app can beat.
        state.window.openNotification(
            workspaceId: payload.workspaceId,
            channelId: payload.channelId,
            messageId: payload.messageId,
            threadRootId: payload.threadRootId
        )
        guard let notificationId = payload.notificationId else { return }
        Task { await state.engine.markNotificationRead(id: notificationId) }
    }
}

/// Carries a UIKit completion handler from a `nonisolated` delegate callback to
/// the main actor.
///
/// The handlers `UNUserNotificationCenterDelegate` hands out are not `Sendable`
/// — the SDK predates the annotation — so Swift 6 refuses to let one cross into
/// a `Task`. Unchecked is honest rather than lazy here: the only thing that ever
/// touches the wrapped closure is the main actor, exactly once, which is the
/// property `Sendable` would be asserting anyway (and is what #458 was about —
/// the handler *must* run on the main thread).
private struct MainActorHandoff<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) { self.value = value }
}

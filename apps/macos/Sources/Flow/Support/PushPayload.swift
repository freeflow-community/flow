import Foundation

/// The client half of the APNs payload contract (#249; the server half is
/// `packages/server/src/push/payload.ts`).
///
/// Two payload shapes arrive from `push/payload.ts`, and both land here:
///
///  - an **alert** push — `aps.alert` plus the flat routing keys. Those keys
///    are deliberately the same ones the macOS banner has always put in its
///    `userInfo`, so a tap re-uses `WindowState.openNotification` rather than
///    growing a second navigation path. `notificationId` is the one addition:
///    it lets the tap mark exactly the row that was tapped read.
///  - a **badge-sync** push — `content-available: 1` and `aps.badge`, nothing
///    else. It carries no routing keys at all, which is why `badge(from:)` is
///    a separate lookup rather than a property of a parsed payload.
///
/// Parsing lives in the shared layer (and not in iOS's `Banners`) because it
/// is a wire contract with the server, testable without a device, and macOS
/// will want exactly the same reader when it grows APNs of its own.
struct PushPayload: Equatable, Sendable {
    let workspaceId: String
    let channelId: String
    let messageId: String
    /// Absent for a top-level message — the server omits the key rather than
    /// sending null.
    let threadRootId: String?
    /// The notification row a tap should mark read.
    let notificationId: String?

    /// Parses the routing keys out of a `UNNotification`'s `userInfo`.
    /// Returns nil for anything that isn't a routable alert push — a badge-sync
    /// push, or a malformed payload — so callers can't accidentally navigate on
    /// half a payload.
    ///
    /// "Malformed" includes a key that is present but *empty*: an id that is
    /// the empty string routes to a workspace and a channel that cannot exist,
    /// which on the phone is a blank screen with no way back. Refusing to parse
    /// it is what makes the tap land at home instead (#458).
    init?(userInfo: [AnyHashable: Any]) {
        guard let workspaceId = userInfo["workspaceId"] as? String, !workspaceId.isEmpty,
              let channelId = userInfo["channelId"] as? String, !channelId.isEmpty,
              let messageId = userInfo["messageId"] as? String, !messageId.isEmpty
        else { return nil }
        self.workspaceId = workspaceId
        self.channelId = channelId
        self.messageId = messageId
        // Optional keys get the same treatment: an empty `threadRootId` would
        // read as "open a thread" and an empty `notificationId` would send a
        // mark-read for no row, so both collapse to nil.
        threadRootId = (userInfo["threadRootId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        notificationId = (userInfo["notificationId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// The server-authoritative unread total an alert or badge-sync push
    /// carries in `aps.badge`. Read from either shape: an alert push's badge is
    /// as fresh as a silent one's, so applying it keeps the icon honest even
    /// when Apple has metered the background pushes away.
    static func badge(from userInfo: [AnyHashable: Any]) -> Int? {
        guard let aps = userInfo["aps"] as? [AnyHashable: Any] else { return nil }
        if let badge = aps["badge"] as? Int { return badge }
        return (aps["badge"] as? NSNumber)?.intValue
    }

    /// Whether a push that arrives while the app is in the foreground should
    /// still be bannered.
    ///
    /// The rule is "don't banner what I'm already reading", and it lives on the
    /// client on purpose — the server stays dumb about what is on screen, the
    /// same way web checks `document.hidden` and macOS checks the active
    /// channel (PUSH_APNS.md § *Client: iOS*).
    ///
    /// iOS is not macOS here, which is why this is not `isViewingMessage`: a
    /// thread on the phone is a *pushed screen* that covers the transcript, so
    /// a top-level message in the channel underneath is not on screen and does
    /// deserve a banner. Hence `openThreadRootId` suppresses only its own
    /// thread's replies.
    static func shouldPresentBanner(
        payload: PushPayload,
        appActive: Bool,
        visibleChannelId: String?,
        openThreadRootId: String?
    ) -> Bool {
        // Not frontmost: `willPresent` still fires for a push that lands during
        // the moment between backgrounding and suspension. Banner it.
        guard appActive else { return true }
        guard payload.channelId == visibleChannelId else { return true }
        if let openThreadRootId {
            // A thread screen covers the channel: only its own replies are read.
            return payload.threadRootId != openThreadRootId
        }
        // Channel transcript on screen: top-level messages are read, replies
        // behind an unopened thread are not.
        return payload.threadRootId != nil
    }
}

import Foundation

/// The one piece of state the app and the share extension both touch: which
/// channel was shared into last, so the common case is one tap (issue #214).
///
/// Deliberately *not* the GRDB cache — that lives in the app's own container,
/// is per-profile, and moving it into the App Group is a migration this
/// feature doesn't need. Two strings in `UserDefaults` are enough.
enum SharedDefaults {
    static let appGroup = "group.im.freeflow.app"

    private static var store: UserDefaults? { UserDefaults(suiteName: appGroup) }

    /// Keys carry `Profile.suffix` for the same reason storage identifiers do
    /// everywhere else: a channel id from the local dev server must never be
    /// preselected against production.
    private static var channelKey: String { "share.lastChannelId" + Profile.suffix }
    private static var workspaceKey: String { "share.lastWorkspaceId" + Profile.suffix }

    static var lastChannelId: String? {
        get { store?.string(forKey: channelKey) }
        set { store?.set(newValue, forKey: channelKey) }
    }

    static var lastWorkspaceId: String? {
        get { store?.string(forKey: workspaceKey) }
        set { store?.set(newValue, forKey: workspaceKey) }
    }
}

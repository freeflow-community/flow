import Foundation

/// The Apps sidebar section (#394): every mini app in the workspace this user is
/// allowed to see — including apps in *public* channels they have not joined,
/// which is the point of the section (a Task Board in #factory should be
/// findable from anywhere, not only after you happen to join).
///
/// The server has already applied the visibility rule, so all this does is pair
/// each app with its host channel — the row's muted secondary label, and the
/// channel a click has to join and open. An app whose channel isn't in the local
/// list is dropped rather than rendered channel-less: with no channel there is
/// nothing to join and nowhere to open.
enum AppsSection {
    struct Entry: Identifiable {
        let artifact: Artifact
        let channel: Channel
        /// Prefixed, NOT the bare artifact id: the same app also renders as a
        /// nested `ArtifactSidebarRow` under its channel, and both rows live in
        /// the sidebar's single `LazyVStack`. Two children with the same
        /// identity there make SwiftUI drop one of them — which showed up as an
        /// Apps row that reserved its height and drew nothing.
        var id: String { "app-\(artifact.id)" }
    }

    static func entries(apps: [Artifact], channels: [Channel]) -> [Entry] {
        let byId = Dictionary(channels.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return apps.compactMap { artifact in
            byId[artifact.channelId].map { Entry(artifact: artifact, channel: $0) }
        }
    }

    /// How a row names its host channel: `#name` for a channel, the member names
    /// for a DM (an app can be pinned in one).
    static func channelLabel(_ channel: Channel, userNames: [String: String], currentUserId: String?) -> String {
        channel.isDM
            ? channel.displayTitle(userNames: userNames, currentUserId: currentUserId)
            : "#\(channel.name ?? "")"
    }
}

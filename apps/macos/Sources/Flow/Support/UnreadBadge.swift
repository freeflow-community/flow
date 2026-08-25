import SwiftUI

/// The workspace unread badge (#345) — shared by the macOS rail and the iOS
/// workspace switcher so the two never disagree about what "a lot" looks like.

/// How high the badge counts before it gives up and says "99+".
let unreadBadgeCap = 99

/// The text to draw, or nil when there is nothing to say. Zero is silent: a
/// badge reading "0" is noise, and nil (count not fetched yet) is not zero.
func unreadBadgeLabel(_ count: Int?) -> String? {
    guard let count, count > 0 else { return nil }
    return count > unreadBadgeCap ? "\(unreadBadgeCap)+" : "\(count)"
}

/// Badge for a workspace icon: top-right, overhanging the corner, ringed in the
/// rail's own color so it separates from whatever the icon is underneath — a
/// photo avatar or a colored initial. A circle for one digit, a pill for more.
struct WorkspaceUnreadBadge: View {
    let count: Int?
    /// The rail background, drawn as the ring around the badge.
    let ringColor: Color

    var body: some View {
        if let label = unreadBadgeLabel(count) {
            Text(label)
                .flowFont(size: 10, weight: .bold)
                .foregroundStyle(.white)
                .monospacedDigit()
                .padding(.horizontal, 5)
                .frame(minWidth: 18, minHeight: 18)
                .background(Capsule().fill(MC.unread))
                .overlay(Capsule().strokeBorder(ringColor, lineWidth: 2.5))
                // The badge hangs over the icon's corner; a click there means
                // "open this workspace", so it must not eat the hit.
                .allowsHitTesting(false)
        }
    }
}

import Foundation

/// A main-pane view a window can navigate to (issue #386).
///
/// Not just a channel id: the Activity feed covers the content pane while the
/// channel selection stays put behind it, so "where you are" is a channel *or*
/// the feed, and the visit history has to be able to say which.
enum NavView: Equatable {
    case channel(String)
    case activity
    /// The Scheduled panel (#424) — like the feed, it covers the content pane
    /// while the channel selection stays put behind it.
    case scheduled
    /// The Directory (#432) — the workspace member grid. Same treatment again:
    /// it covers the content pane, the channel stays selected behind it.
    case directory
}

/// Browser-style visit history over `NavView` — what the workspace header's
/// back/forward buttons walk (issue #386).
///
/// A value type with no side effects: `WindowState` owns one, publishes it, and
/// the buttons read `canGoBack`/`canGoForward` for their enabled state.
/// In-memory and per-workspace, cleared on workspace switch and sign-out.
struct NavHistory: Equatable {
    /// Oldest → newest; everything after `index` is the forward branch.
    private(set) var entries: [NavView] = []
    /// Position of the view being shown, or -1 for a fresh session.
    private(set) var index: Int = -1

    /// How many visits we keep. Deep enough that back never runs dry in practice.
    private static let limit = 50

    var canGoBack: Bool { index > 0 }
    var canGoForward: Bool { index >= 0 && index < entries.count - 1 }

    var current: NavView? { entries.indices.contains(index) ? entries[index] : nil }

    /// The view one step in `delta`'s direction, or nil at that end.
    func target(_ delta: Int) -> NavView? {
        let next = index + delta
        return entries.indices.contains(next) ? entries[next] : nil
    }

    /// Record a visit. Re-opening the view you are already on is not a visit,
    /// and going somewhere new after going back discards the forward branch —
    /// both exactly as a browser behaves.
    mutating func record(_ view: NavView) {
        guard current != view else { return }
        entries = Array(entries.prefix(index + 1))
        entries.append(view)
        if entries.count > Self.limit { entries.removeFirst(entries.count - Self.limit) }
        index = entries.count - 1
    }

    /// Move the cursor without touching the entries (what back/forward do).
    mutating func step(_ delta: Int) {
        let next = index + delta
        guard entries.indices.contains(next) else { return }
        index = next
    }

    /// Drop every trace of a view that is gone (channel left, archived,
    /// deleted). Leaving dead entries in would make back land on a blank pane;
    /// removing them keeps the cursor on the visit it was already on.
    mutating func forget(_ view: NavView) {
        guard entries.contains(view) else { return }
        var kept: [NavView] = []
        var newIndex = index
        for (i, e) in entries.enumerated() {
            if e == view {
                if i <= index { newIndex -= 1 }
            } else {
                kept.append(e)
            }
        }
        entries = kept
        index = kept.isEmpty ? -1 : min(max(newIndex, 0), kept.count - 1)
    }
}

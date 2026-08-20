import Foundation

/// Per-channel scroll-position memory (macOS): switching away from a channel
/// and back within the TTL returns you to where you were, rather than
/// snapping to the bottom. After the TTL the entry is dropped, so returning
/// later lands at the newest message — the freshest place to be.
///
/// There is no pixel scroll offset to save in SwiftUI, so what is remembered
/// is the id of the top-most visible message (tracked by a per-row
/// preference in `MessageListView`), re-anchored to the viewport top on
/// return. Only a *back-scrolled* position is recorded — a reader pinned at
/// the bottom clears their entry, because restoring "the newest message at
/// the top of the screen" would push them a viewport up from where they
/// actually were.
///
/// An earlier version of this store shipped with a dead recorder: the
/// `scrollPosition(id:)` modifier that fed it never reported anything (no
/// `scrollTargetLayout()`), and worse, it acted as a second scroll driver
/// that blanked the transcript (see the NOTE in `MessageListView`). The
/// recorder is now a passive preference — it observes geometry and never
/// scrolls — and the restore goes through `TranscriptFollowModel`, so no
/// second driver exists.
///
/// Process-lifetime only (a plain in-memory map); not persisted. macOS-only
/// by ruling — phones switch channels through a full screen change where
/// bottom-on-return is the expected behavior (see the Parity note).
@MainActor
enum MessageScrollMemory {
    static let ttl: TimeInterval = 10 * 60
    private static var store: [String: (id: String, at: Date)] = [:]

    /// Remember the top-visible message id for a channel.
    static func record(_ key: String, topMessageId: String, at now: Date = Date()) {
        store[key] = (topMessageId, now)
    }

    /// Forget a channel's entry (the reader returned to the bottom).
    static func clear(_ key: String) {
        store[key] = nil
    }

    /// The remembered top message id if it's still fresh; nil (and forgotten)
    /// once it has expired.
    static func fresh(_ key: String, at now: Date = Date()) -> String? {
        guard let entry = store[key] else { return nil }
        if now.timeIntervalSince(entry.at) > ttl {
            store[key] = nil
            return nil
        }
        return entry.id
    }

    /// Test support: drop everything.
    static func reset() {
        store = [:]
    }
}

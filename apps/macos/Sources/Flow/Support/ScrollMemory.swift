import Foundation

/// Per-channel scroll-position memory (ui_nits): switching away from a channel
/// and back within a few minutes returns you to where you were, rather than
/// snapping to the bottom. After the TTL the entry is ignored (and dropped), so
/// returning later lands at the bottom — the freshest place to be.
///
/// In SwiftUI there is no pixel scroll offset for a lazy list, so we remember
/// the id of the top-most visible message and re-anchor to it on return.
/// Process-lifetime only (a plain in-memory map); not persisted.
@MainActor
enum MessageScrollMemory {
    private static let ttl: TimeInterval = 5 * 60
    private static var store: [String: (id: String, at: Date)] = [:]

    /// Remember the top-visible message id for a channel.
    static func record(_ key: String, topMessageId: String) {
        store[key] = (topMessageId, Date())
    }

    /// The remembered top message id if it's still fresh; nil (and forgotten)
    /// once it has expired.
    static func fresh(_ key: String) -> String? {
        guard let entry = store[key] else { return nil }
        if Date().timeIntervalSince(entry.at) > ttl {
            store[key] = nil
            return nil
        }
        return entry.id
    }
}

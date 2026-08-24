import Foundation

/// Transcript rows are keyed on `clientMsgId`, not `id` (#312: an optimistic
/// row and its server echo share a `clientMsgId` but not an `id`, so keying on
/// `id` remounted the row — and re-flashed its avatar — the moment the echo
/// landed). Anything that scrolls therefore has to name that key: `scrollTo` a
/// message id and it matches no row and silently does nothing, which is how
/// jump-to-message and scroll-after-reply broke in threads (#329).
///
/// One definition, in one place, so the channel list and the thread panel
/// cannot drift apart on what a row is called.
extension Array where Element == Message {
    /// The row identity for a message id, or nil when that message isn't in
    /// this list — the same "not here (yet)" answer the callers' old
    /// `contains(where:)` guards gave.
    func rowKey(forMessageId id: String) -> String? {
        first(where: { $0.id == id })?.clientMsgId
    }

    /// The row identity of the newest message: the scroll-to-bottom target.
    var lastRowKey: String? { last?.clientMsgId }

    /// The row identity of the oldest message: the top-of-window target.
    var firstRowKey: String? { first?.clientMsgId }
}

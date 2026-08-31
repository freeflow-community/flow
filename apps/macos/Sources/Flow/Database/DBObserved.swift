import Foundation
import GRDB

/// A small @Query-style wrapper: observes a GRDB request via ValueObservation
/// and republishes results to SwiftUI on the main actor.
///
/// Usage:
///     @StateObject private var messages = DBObserved<[Message]>(initial: [])
///     ...
///     .task(id: channelId) {
///         messages.start(db: app.db, reset: []) { db in
///             try Message.filter(...).fetchAll(db)
///         }
///     }
@MainActor
final class DBObserved<Value: Equatable & Sendable>: ObservableObject {
    @Published private(set) var value: Value
    private var task: Task<Void, Never>?
    /// What `value` is currently about — the channel id, thread root, … —
    /// recorded by `start` and compared by `value(for:)`.
    private var key: AnyHashable?
    /// A read done for a key `start` has not run for yet, kept so the several
    /// body evaluations inside one switch cost a single query.
    private var early: (key: AnyHashable, value: Value)?

    init(initial: Value) {
        self.value = initial
    }

    func start(
        db: AppDatabase,
        key: AnyHashable? = nil,
        reset: Value? = nil,
        _ fetch: @escaping @Sendable (Database) throws -> Value
    ) {
        task?.cancel()
        self.key = key
        early = nil
        // Synchronous first fetch: the async observation below delivers its
        // first value only after a hop to a database queue and back, and the
        // frames in between render whatever `value` holds — which was `reset`,
        // i.e. an empty transcript, even for a fully cached channel. Reading
        // the initial value here means the first frame after a channel switch
        // already shows the cache; `reset` is only the fallback when the read
        // itself fails.
        if let initial = try? db.reader.read(fetch) {
            value = initial
        } else if let reset {
            value = reset
        }
        let observation = ValueObservation.tracking(fetch).removeDuplicates()
        let reader = db.reader
        task = Task { [weak self] in
            do {
                for try await v in observation.values(in: reader) {
                    guard let self, !Task.isCancelled else { return }
                    self.value = v
                }
            } catch {
                // Observation cancelled or database error; nothing to surface here.
            }
        }
    }

    /// The value for `key`, read straight from the cache when the observation
    /// has not been restarted for that key yet.
    ///
    /// `.task(id:)` runs *after* the body it belongs to, so between a channel
    /// switch and the task that re-points this observer there is at least one
    /// frame the view would render from the previous key's value — the
    /// previous channel's header and transcript under a sidebar that has
    /// already moved (#447). Reading through here drops the dependence on when
    /// that task gets its turn on the main actor: the first body evaluation
    /// for a new key already sees the new key's rows. `fallback` is what a
    /// failed read shows — never the other key's value.
    func value(
        for key: AnyHashable,
        db: AppDatabase,
        fallback: Value,
        _ fetch: @Sendable (Database) throws -> Value
    ) -> Value {
        if self.key == key { return value }
        if let early, early.key == key { return early.value }
        let fresh = (try? db.reader.read(fetch)) ?? fallback
        early = (key, fresh)
        return fresh
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    deinit {
        task?.cancel()
    }
}

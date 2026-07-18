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

    init(initial: Value) {
        self.value = initial
    }

    func start(
        db: AppDatabase,
        reset: Value? = nil,
        _ fetch: @escaping @Sendable (Database) throws -> Value
    ) {
        task?.cancel()
        if let reset { value = reset }
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

    func stop() {
        task?.cancel()
        task = nil
    }

    deinit {
        task?.cancel()
    }
}

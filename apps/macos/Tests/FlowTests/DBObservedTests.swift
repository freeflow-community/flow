import XCTest

@testable import Flow

// The message list renders whatever `DBObserved.value` holds on the first
// frame after a channel switch. `start` must therefore deliver the cached
// value synchronously — before it returns — not only after the async
// observation's first hop, or every switch paints one blank frame even for a
// fully cached channel.
@MainActor
final class DBObservedTests: XCTestCase {
    private func makeDB(userIds: [String]) throws -> AppDatabase {
        let db = try AppDatabase.inMemory()
        try db.writer.write { dbc in
            for id in userIds {
                try dbc.execute(sql: "INSERT INTO user (id) VALUES (?)", arguments: [id])
            }
        }
        return db
    }

    private func observeUserIds(_ db: AppDatabase) -> DBObserved<[String]> {
        let observed = DBObserved<[String]>(initial: [])
        observed.start(db: db, reset: []) { dbc in
            try String.fetchAll(dbc, sql: "SELECT id FROM user ORDER BY id")
        }
        return observed
    }

    func testStartDeliversTheCachedValueBeforeReturning() throws {
        let db = try makeDB(userIds: ["u1"])
        let observed = observeUserIds(db)
        // No await between start and this assert: the very next frame must
        // already show the cache, not the `reset` placeholder.
        XCTAssertEqual(observed.value, ["u1"])
    }

    func testLaterWritesStillFlowThroughTheObservation() async throws {
        let db = try makeDB(userIds: ["u1"])
        let observed = observeUserIds(db)
        try await db.writer.write { dbc in
            try dbc.execute(sql: "INSERT INTO user (id) VALUES ('u2')")
        }
        let deadline = Date().addingTimeInterval(5)
        while observed.value != ["u1", "u2"], Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(observed.value, ["u1", "u2"])
    }
}

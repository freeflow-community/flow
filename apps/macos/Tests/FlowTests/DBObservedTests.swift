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

    private func observeUserIds(_ db: AppDatabase, key: AnyHashable? = nil) -> DBObserved<[String]> {
        let observed = DBObserved<[String]>(initial: [])
        observed.start(db: db, key: key, reset: []) { dbc in
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

    // #447: `.task(id:)` runs after the body it belongs to, so between a
    // channel switch and the task that re-points the observer, the view asks
    // for a key `start` has not run for yet. That ask must answer with the new
    // key's rows — the previous channel's are what painted the stale pane.
    func testValueForANewKeyReadsThatKeysRowsBeforeStartRuns() throws {
        let db = try makeDB(userIds: ["u1"])
        let observed = DBObserved<[String]>(initial: [])
        observed.start(db: db, key: "only-u1", reset: []) { dbc in
            try String.fetchAll(dbc, sql: "SELECT id FROM user WHERE id = 'u1'")
        }
        XCTAssertEqual(observed.value, ["u1"])

        try db.writer.write { dbc in
            try dbc.execute(sql: "INSERT INTO user (id) VALUES ('u2')")
        }
        // The "switch": a different key, whose `start` has not run yet.
        let value = observed.value(for: "only-u2", db: db, fallback: []) { dbc in
            try String.fetchAll(dbc, sql: "SELECT id FROM user WHERE id = 'u2'")
        }
        XCTAssertEqual(value, ["u2"])
        XCTAssertEqual(observed.value, ["u1"], "the published value is left to the observation")
    }

    func testValueForTheStartedKeyIsTheObservedValue() throws {
        let db = try makeDB(userIds: ["u1"])
        let observed = observeUserIds(db, key: "all")
        // Same key as `start`: no re-read, whatever the fetch would say.
        let value = observed.value(for: "all", db: db, fallback: []) { _ in ["ignored"] }
        XCTAssertEqual(value, ["u1"])
    }

    func testValueFallsBackRatherThanShowingTheOtherKeysRows() throws {
        let db = try makeDB(userIds: ["u1"])
        let observed = observeUserIds(db, key: "all")
        let value = observed.value(for: "boom", db: db, fallback: []) { _ in
            throw NSError(domain: "test", code: 1)
        }
        XCTAssertEqual(value, [], "a failed read shows the fallback, never the previous key")
    }

    func testStartingTheNewKeyTakesOverFromTheEarlyRead() throws {
        let db = try makeDB(userIds: ["u1"])
        let observed = observeUserIds(db, key: "all")
        _ = observed.value(for: "u1-only", db: db, fallback: []) { dbc in
            try String.fetchAll(dbc, sql: "SELECT id FROM user WHERE id = 'u1'")
        }
        try db.writer.write { dbc in
            try dbc.execute(sql: "INSERT INTO user (id) VALUES ('u2')")
        }
        // The task lands: the observation owns the value again, and the early
        // read must not keep answering with what it cached.
        observed.start(db: db, key: "u1-only", reset: []) { dbc in
            try String.fetchAll(dbc, sql: "SELECT id FROM user ORDER BY id")
        }
        let value = observed.value(for: "u1-only", db: db, fallback: []) { _ in ["ignored"] }
        XCTAssertEqual(value, ["u1", "u2"])
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

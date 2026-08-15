import XCTest

@testable import Flow

// The reconnect bar (#234). Two things have to hold: the bar's input counts a
// connected-but-catching-up app as syncing (otherwise it clears while the
// transcript on screen is still stale), and the timing swallows short
// reconnects instead of flashing.
final class SyncBarTests: XCTestCase {
    // MARK: - What counts as syncing

    func testDisconnectedStatesSync() {
        XCTAssertTrue(AppState.isSyncing(connection: .connecting, catchUpCount: 0))
        XCTAssertTrue(AppState.isSyncing(connection: .reconnecting, catchUpCount: 0))
    }

    func testConnectedButCatchingUpStillSyncs() {
        XCTAssertTrue(AppState.isSyncing(connection: .connected, catchUpCount: 1))
    }

    func testConnectedAndCaughtUpDoesNotSync() {
        XCTAssertFalse(AppState.isSyncing(connection: .connected, catchUpCount: 0))
    }

    @MainActor
    func testOverlappingCatchUpsKeepTheBarUpUntilTheLastOneEnds() {
        let app = AppState()
        app.setConnection(.connected)
        app.beginCatchUp()
        app.beginCatchUp()
        app.endCatchUp()
        XCTAssertTrue(app.isSyncing, "the second backfill is still paging")
        app.endCatchUp()
        XCTAssertFalse(app.isSyncing)
    }

    // MARK: - Timing

    /// 40ms/120ms stands in for the shipped 250ms/500ms — the same state
    /// machine, without a slow test.
    @MainActor
    private func indicator() -> SyncIndicator {
        SyncIndicator(showDelay: .milliseconds(40), minimumVisible: .milliseconds(120))
    }

    @MainActor
    func testShortReconnectNeverDrawsAnything() async throws {
        let ind = indicator()
        ind.update(syncing: true)
        try await Task.sleep(for: .milliseconds(15))
        ind.update(syncing: false)
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertFalse(ind.visible, "resolved inside the show delay — no flash")
    }

    @MainActor
    func testLongerReconnectShowsTheBar() async throws {
        let ind = indicator()
        ind.update(syncing: true)
        XCTAssertFalse(ind.visible, "not immediately")
        try await Task.sleep(for: .milliseconds(90))
        XCTAssertTrue(ind.visible)
    }

    @MainActor
    func testShownBarStaysForTheMinimumDuration() async throws {
        let ind = indicator()
        ind.update(syncing: true)
        try await Task.sleep(for: .milliseconds(60))
        XCTAssertTrue(ind.visible)
        ind.update(syncing: false)  // ~20ms after it appeared
        try await Task.sleep(for: .milliseconds(40))
        XCTAssertTrue(ind.visible, "held to the minimum instead of flashing")
        try await Task.sleep(for: .milliseconds(140))
        XCTAssertFalse(ind.visible)
    }

    @MainActor
    func testResyncingWhileVisibleCancelsThePendingHide() async throws {
        let ind = indicator()
        ind.update(syncing: true)
        try await Task.sleep(for: .milliseconds(60))
        ind.update(syncing: false)
        ind.update(syncing: true)  // dropped again straight away
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertTrue(ind.visible, "still syncing — the hide must not land")
    }
}

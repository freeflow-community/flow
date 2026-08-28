import Clocks
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

    // Driven by a TestClock, so these test the SHIPPED 250ms/500ms numbers
    // and cannot flake on a slow runner: time only moves when advanced.

    @MainActor
    private func indicator(_ clock: TestClock<Duration>) -> SyncIndicator<TestClock<Duration>> {
        SyncIndicator(clock: clock)
    }

    @MainActor
    func testShortReconnectNeverDrawsAnything() async throws {
        let clock = TestClock()
        let ind = indicator(clock)
        ind.update(syncing: true)
        await clock.advance(by: .milliseconds(100))
        ind.update(syncing: false)
        await clock.advance(by: .seconds(10))
        XCTAssertFalse(ind.visible, "resolved inside the show delay — no flash")
    }

    @MainActor
    func testLongerReconnectShowsTheBar() async throws {
        let clock = TestClock()
        let ind = indicator(clock)
        ind.update(syncing: true)
        XCTAssertFalse(ind.visible, "not immediately")
        await clock.advance(by: .milliseconds(249))
        XCTAssertFalse(ind.visible, "not before the show delay")
        await clock.advance(by: .milliseconds(1))
        XCTAssertTrue(ind.visible)
    }

    @MainActor
    func testShownBarStaysForTheMinimumDuration() async throws {
        let clock = TestClock()
        let ind = indicator(clock)
        ind.update(syncing: true)
        await clock.advance(by: .milliseconds(250))
        XCTAssertTrue(ind.visible)
        await clock.advance(by: .milliseconds(100))
        ind.update(syncing: false)  // 100ms after it appeared
        await clock.advance(by: .milliseconds(399))
        XCTAssertTrue(ind.visible, "held to the minimum instead of flashing")
        await clock.advance(by: .milliseconds(1))
        XCTAssertFalse(ind.visible, "hidden the moment the minimum is served")
    }

    @MainActor
    func testResyncingWhileVisibleCancelsThePendingHide() async throws {
        let clock = TestClock()
        let ind = indicator(clock)
        ind.update(syncing: true)
        await clock.advance(by: .milliseconds(250))
        XCTAssertTrue(ind.visible)
        ind.update(syncing: false)
        ind.update(syncing: true)  // dropped again straight away
        await clock.advance(by: .seconds(10))
        XCTAssertTrue(ind.visible, "still syncing — the hide must not land")
    }
}

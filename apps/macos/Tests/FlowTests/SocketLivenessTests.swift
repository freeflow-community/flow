import XCTest

@testable import Flow

// The dead-socket watchdog's rule (#271). A laptop that sleeps leaves the
// WebSocket half-open: no error ever reaches the client, so silence is the only
// evidence the connection is gone. These pin the rule that turns silence into a
// reconnect — and therefore into `SyncEngine.backfillAfterReconnect()`.
// `SocketWatchdogTests` proves the same thing over a real socket.
final class SocketLivenessTests: XCTestCase {
    private let liveness = SocketLiveness.standard
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func silent(for seconds: TimeInterval, deadline: TimeInterval? = nil) -> Bool {
        liveness.isDead(
            lastInboundAt: now.addingTimeInterval(-seconds),
            now: now,
            deadline: deadline ?? liveness.deadline
        )
    }

    func testAServerHeartbeatKeepsAnIdleSocketAlive() {
        // Idle but healthy: nothing to say, pinged 30s ago.
        XCTAssertFalse(silent(for: 31))
    }

    func testOneMissedHeartbeatIsNotEnough() {
        // A beat lost to jitter must not cost a reconnect.
        XCTAssertFalse(silent(for: 65))
    }

    func testTwoMissedHeartbeatsAreDead() {
        XCTAssertTrue(silent(for: 71))
    }

    func testWakeIsSuspiciousAfterASingleMissedHeartbeat() {
        // On wake we know unobserved time passed, so the bar is lower.
        XCTAssertTrue(silent(for: 45, deadline: liveness.wakeDeadline))
        XCTAssertFalse(silent(for: 5, deadline: liveness.wakeDeadline))
    }

    func testALaptopThatSleptAnHourIsDeadOnEitherDeadline() {
        XCTAssertTrue(silent(for: 3600))
        XCTAssertTrue(silent(for: 3600, deadline: liveness.wakeDeadline))
    }

    /// The watchdog is what converts the deadline into a bounded wait, so it
    /// has to tick several times inside one — otherwise the sampling interval,
    /// not the deadline, decides how long the sidebar stays stale.
    func testWatchdogSamplesWellInsideTheDeadline() {
        XCTAssertLessThan(liveness.checkInterval, liveness.wakeDeadline / 2)
        XCTAssertLessThan(liveness.checkInterval, liveness.deadline / 4)
    }
}

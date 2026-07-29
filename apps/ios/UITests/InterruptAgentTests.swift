import XCTest

/// #67 — the Interrupt affordance on an agent's live "thinking…" row. Taps
/// happen inside the simulator, so this runs without touching the operator's
/// screen (see UITests/README.md).
///
/// Prerequisites, beyond the usual seeded dev server:
///   * an agent in the workspace with a DM to `alice@qa.local`, and a turn in
///     flight in it — i.e. a live `🤖 *thinking…*` row to interrupt;
///   * `FLOW_TEST_SERVER` / `FLOW_TEST_DM` naming that server and DM channel id
///     (defaults match the standard local setup).
///
/// Tapping Interrupt adds the 🛑 reaction the bridge maps back to the run, so
/// the button flipping to "Stopping…" *is* the proof the signal was sent — and
/// the row disappearing afterwards is the bridge acting on it.
final class InterruptAgentTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var server: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER"] ?? "http://127.0.0.1:8787"
    }

    private var dmChannelId: String? {
        ProcessInfo.processInfo.environment["FLOW_TEST_DM"]
    }

    func testInterruptButtonStopsTheTurn() throws {
        let dm = try XCTUnwrap(dmChannelId, "set FLOW_TEST_DM to the agent DM's channel id")
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": server,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": dm,
        ]
        app.launch()

        let interrupt = app.buttons
            .matching(NSPredicate(format: "identifier BEGINSWITH 'msg.interrupt.'"))
            .firstMatch
        XCTAssertTrue(
            interrupt.waitForExistence(timeout: 90),
            "no Interrupt button — is a turn actually in flight in that DM?"
        )
        XCTAssertEqual(interrupt.label, "Interrupt")

        interrupt.tap()

        // Either state proves the reaction landed: the button says "Stopping…"
        // while the bridge acts, then the whole row goes when it has.
        let stopping = NSPredicate(format: "label == 'Stopping…' OR exists == false")
        wait(for: [expectation(for: stopping, evaluatedWith: interrupt)], timeout: 20)

        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: interrupt)
        wait(for: [gone], timeout: 60)
    }
}

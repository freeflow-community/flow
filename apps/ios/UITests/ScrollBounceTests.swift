import XCTest

/// A short back-pull on the transcript must stay where the finger left it.
/// The content-frame glue used to fire on *any* frame change — including the
/// deceleration frames of an ordinary scroll — so any pull shorter than
/// `minBackScroll` (200pt) snapped straight back to the newest message the
/// moment the finger lifted. The glue now acts on content growth only.
///
/// Needs `qa-seed.mjs` + `qa-seed-nav.mjs` (the `scroll209` channel: 40
/// messages, enough transcript to actually scroll).
final class ScrollBounceTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var channelName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SCROLL_CHANNEL"] ?? "scroll209"
    }

    func testShortPullDoesNotBounceBackToBottom() {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channelName,
        ]
        app.launch()

        let lastMsg = app.staticTexts["scroll filler message 40"]
        XCTAssertTrue(lastMsg.waitForExistence(timeout: 60),
                      "never reached #\(channelName) — did qa-seed-nav.mjs run?")
        // Let the initial layout and any startup glue settle.
        sleep(2)
        let before = lastMsg.frame

        // A short pull back through history — the finger travels DOWN to
        // reveal older messages above. Past the 120pt bottom slack, well
        // under the 200pt unpin threshold: the exact range that used to
        // bounce back. Slow, with a hold, so momentum can't carry it past 200.
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.53))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)

        // Give the old bounce-back glue the time it used to fire in.
        sleep(2)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "after-short-pull"
        shot.lifetime = .keepAlways
        add(shot)

        let moved = lastMsg.exists ? abs(lastMsg.frame.minY - before.minY) : .infinity
        XCTAssertGreaterThan(
            moved, 60,
            "short pull bounced back: last message returned to its pre-pull position")
    }
}

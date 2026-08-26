import XCTest

/// Repro for the stuck-navigation report: open a thread from the channel,
/// go Back to the channel, then (a) open a thread again and (b) switch
/// channels through the drawer. Both must still work.
///
/// Needs `qa-seed.mjs` plus a threaded message in `#general` and a second
/// channel `nav205` (see the nav fixture script in the PR).
final class ThreadNavTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var threadChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_THREAD_CHANNEL"] ?? "nav205a"
    }

    private var secondChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SECOND_CHANNEL"] ?? "nav205b"
    }

    private func launchInThreadChannel() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": threadChannel,
        ]
        app.launch()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60), "never reached #\(threadChannel) — did the nav fixture run?")
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Pop the pushed screen with the interactive edge-swipe instead of the
    /// Back button — the gesture drives the pop through UIKit's transition
    /// coordinator, which is the path that historically desyncs
    /// `navigationDestination(item:)` bindings.
    private func swipeBack(_ app: XCUIApplication) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end)
    }

    /// Open the newest thread affordance, assert the Thread screen, then pop —
    /// via the Back button or the edge swipe.
    private func openThreadAndReturn(_ app: XCUIApplication, step: String, viaSwipe: Bool = false) {
        let affordance = app.buttons.matching(identifier: "msg.openThread").firstMatch
        XCTAssertTrue(affordance.waitForExistence(timeout: 15),
                      "no thread affordance in #\(threadChannel) — fixture missing or slow link")
        affordance.tap()
        let title = app.navigationBars["Thread"]
        XCTAssertTrue(title.waitForExistence(timeout: 10), "\(step): thread screen did not push")
        attach("\(step)-thread-open")
        if viaSwipe {
            swipeBack(app)
        } else {
            title.buttons.firstMatch.tap() // Back
        }
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "\(step): never returned to the channel")
        attach("\(step)-back-in-channel")
    }

    func testThreadBackThenReopenAndSwitchChannel() {
        let app = launchInThreadChannel()

        // 1. Open a thread, come back.
        openThreadAndReturn(app, step: "first")

        // 2. Open the SAME thread again — the reported failure.
        openThreadAndReturn(app, step: "second")

        // 3. Switch channels through the drawer — the other reported failure.
        app.buttons["nav.menu"].tap()
        let row = app.descendants(matching: .any)
            .matching(identifier: "sidebar.channel.\(secondChannel)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "drawer never opened / no #\(secondChannel) row")
        row.tap()
        let switched = app.staticTexts["Hello from nav205b"]
        XCTAssertTrue(switched.waitForExistence(timeout: 10), "channel switch did not land in #\(secondChannel)")
        attach("switched-channel")
    }

    /// Half-swipe: start the interactive pop and release before the commit
    /// threshold, so UIKit cancels it and the thread stays up. iOS has a
    /// history of nilling the `navigationDestination(item:)` binding on the
    /// cancelled gesture anyway, which strands the binding out of sync with
    /// the real stack — then nothing pushes or pops any more.
    func testCancelledSwipeThenNavStillWorks() {
        let app = launchInThreadChannel()

        let affordance = app.buttons.matching(identifier: "msg.openThread").firstMatch
        XCTAssertTrue(affordance.waitForExistence(timeout: 10), "thread affordance never appeared")
        affordance.tap()
        let title = app.navigationBars["Thread"]
        XCTAssertTrue(title.waitForExistence(timeout: 10), "thread screen did not push")

        // Cancelled pop: drag a short way in from the edge, slowly, hold, and
        // let go — a fast fling would commit the pop on velocity.
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.4)
        attach("after-cancelled-swipe")

        // The thread should still be up; leave it with the Back button.
        XCTAssertTrue(title.waitForExistence(timeout: 5), "cancelled swipe should stay on the thread")
        title.buttons.firstMatch.tap()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 10), "never returned to the channel")

        // The reported symptom: neither reopening a thread nor switching
        // channels works after this dance.
        openThreadAndReturn(app, step: "after-cancel")

        app.buttons["nav.menu"].tap()
        let row = app.descendants(matching: .any)
            .matching(identifier: "sidebar.channel.\(secondChannel)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "drawer never opened / no #\(secondChannel) row")
        row.tap()
        let switched = app.staticTexts["Hello from nav205b"]
        XCTAssertTrue(switched.waitForExistence(timeout: 10), "channel switch did not land in #\(secondChannel)")
        attach("cancel-switched-channel")
    }

    /// Rapid open/Back cycles with no settling waits: the pop and the channel
    /// screen's reappearing `.task` (which re-pushes a parked thread) race,
    /// and a push landing mid-pop corrupts the NavigationStack.
    func testRapidThreadOpenCloseCyclesThenNavWorks() {
        let app = launchInThreadChannel()

        let affordance = app.buttons.matching(identifier: "msg.openThread").firstMatch
        XCTAssertTrue(affordance.waitForExistence(timeout: 10), "thread affordance never appeared")

        for cycle in 1...6 {
            affordance.tap()
            // Back, as fast as possible — deliberately not waiting for the
            // push to settle. The Back button and the hamburger share the
            // top-left corner, so recover below if this landed on either
            // screen's control.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.06, dy: 0.085)).tap()
            if affordance.waitForExistence(timeout: 3), affordance.isHittable { continue }
            // Tap landed mid-push and we are still on the thread → Back again.
            let threadBar = app.navigationBars["Thread"]
            if threadBar.exists { threadBar.buttons.firstMatch.tap() }
            // Tap landed after the pop, on the hamburger → close the drawer.
            let backdrop = app.descendants(matching: .any)
                .matching(identifier: "nav.drawerBackdrop").firstMatch
            if backdrop.exists { backdrop.tap() }
            if !affordance.waitForExistence(timeout: 5) || !affordance.isHittable {
                attach("cycle-\(cycle)-stuck")
                XCTFail("cycle \(cycle): transcript unresponsive")
                return
            }
        }
        attach("after-rapid-cycles")

        // The reported symptom: thread affordance and channel switch dead.
        openThreadAndReturn(app, step: "after-rapid")

        app.buttons["nav.menu"].tap()
        let row = app.descendants(matching: .any)
            .matching(identifier: "sidebar.channel.\(secondChannel)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "drawer never opened / no #\(secondChannel) row")
        row.tap()
        let switched = app.staticTexts["Hello from nav205b"]
        XCTAssertTrue(switched.waitForExistence(timeout: 10), "channel switch did not land in #\(secondChannel)")
        attach("rapid-switched-channel")
    }

    /// Same journey, but popping the thread with the interactive edge swipe.
    func testSwipeBackThenReopenAndSwitchChannel() {
        let app = launchInThreadChannel()

        openThreadAndReturn(app, step: "swipe-first", viaSwipe: true)
        openThreadAndReturn(app, step: "swipe-second", viaSwipe: true)

        app.buttons["nav.menu"].tap()
        let row = app.descendants(matching: .any)
            .matching(identifier: "sidebar.channel.\(secondChannel)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "drawer never opened / no #\(secondChannel) row")
        row.tap()
        let switched = app.staticTexts["Hello from nav205b"]
        XCTAssertTrue(switched.waitForExistence(timeout: 10), "channel switch did not land in #\(secondChannel)")
        attach("swipe-switched-channel")
    }
}

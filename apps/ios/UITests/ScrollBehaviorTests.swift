import XCTest

/// Scroll rules for the channel transcript, written down as acceptance
/// criteria. All three were reported from the phone: a channel opening
/// mid-history behind the "Latest msgs" pill, and the pill appearing after
/// the reader sent a message themselves.
///
/// The rules:
///   1. Opening a channel lands on the newest message.
///   2. Sending a message always scrolls to it, wherever the reader was.
///   3. Re-opening a channel lands on the newest message, back-scroll or not.
///
/// Needs a dev server on 127.0.0.1:8787 with `qa-seed.mjs` fixtures, plus a
/// channel with a transcript long enough to scroll — `#general` is usually
/// too short. Point `FLOW_TEST_CHANNEL` at a seeded one.
final class ScrollBehaviorTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    /// A channel with dozens of messages. The whole suite is vacuous without
    /// one — a transcript shorter than the screen can't be scrolled away from.
    private var channelName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_CHANNEL"] ?? "scrolltest"
    }

    /// The second channel, for leaving and coming back.
    private var otherChannelName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_CHANNEL_2"] ?? "general"
    }

    private func launch(channel: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "scott@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channel ?? channelName,
        ]
        app.launch()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60),
                      "never reached a channel — is the dev server seeded?")
        return app
    }

    private func jumpPill(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "msg.jumpToLatest").firstMatch
    }

    /// The last seeded message. Built fresh per call — NSPredicate isn't
    /// Sendable, so a shared one can't cross into the matching call.
    private func newestMessage(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS 'Message 60 of 60'")
        ).firstMatch
    }

    /// Drags the transcript down, which scrolls it back through history.
    /// One swipe covers well over the 200pt "deliberate back-scroll" bar.
    private func backScroll(_ app: XCUIApplication, times: Int = 3) {
        let list = app.scrollViews.firstMatch
        for _ in 0..<times {
            list.swipeDown(velocity: .slow)
        }
    }

    /// Acceptance 1: a channel opens on its newest message, with no pill.
    func testOpensAtNewestMessage() {
        let app = launch()
        XCTAssertTrue(newestMessage(app).waitForExistence(timeout: 20),
                      "the newest message isn't on screen — the list opened mid-history")
        XCTAssertFalse(jumpPill(app).exists,
                       "opened at the bottom but still offered to jump to the bottom")
    }

    /// A deliberate back-scroll raises the pill, and tapping it returns.
    func testBackScrollRaisesPillAndTapReturns() {
        let app = launch()
        _ = newestMessage(app).waitForExistence(timeout: 20)

        backScroll(app)
        XCTAssertTrue(jumpPill(app).waitForExistence(timeout: 5),
                      "scrolled back through history but got no way back to the newest message")

        jumpPill(app).tap()
        XCTAssertTrue(newestMessage(app).waitForExistence(timeout: 5), "the jump button didn't reach the end")
        XCTAssertFalse(jumpPill(app).exists, "back at the bottom, so the pill should be gone")
    }

    /// Acceptance 2: my own message pulls the list to the bottom even when I
    /// was reading back-scroll. This is the case that failed on the phone —
    /// the keyboard resizing the list made the follow logic give up.
    func testSendingMyOwnMessageScrollsToIt() {
        let app = launch()
        _ = newestMessage(app).waitForExistence(timeout: 20)

        backScroll(app)
        XCTAssertTrue(jumpPill(app).waitForExistence(timeout: 5), "precondition: reading back-scroll")

        let body = "scroll-check \(UUID().uuidString.prefix(8))"
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        composer.tap()
        composer.typeText(body)
        app.descendants(matching: .any).matching(identifier: "composer.send").firstMatch.tap()

        let mine = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", body)).firstMatch
        XCTAssertTrue(mine.waitForExistence(timeout: 15),
                      "sent a message and the list didn't scroll to show it")
        XCTAssertFalse(jumpPill(app).exists,
                       "my own message should have returned the list to the bottom")
    }

    /// Leaving a channel and coming back always lands on the newest message.
    /// Restoring a back-scrolled position was tried and removed: tracking which
    /// row is on screen needs per-row geometry, and that makes every layout
    /// pass touch every row, which freezes the app on a channel switch.
    func testReturnToChannelOpensAtNewest() {
        let app = launch()
        _ = newestMessage(app).waitForExistence(timeout: 20)

        backScroll(app)
        XCTAssertTrue(jumpPill(app).waitForExistence(timeout: 5), "precondition: reading back-scroll")

        switchChannel(app, to: otherChannelName)
        switchChannel(app, to: channelName)

        XCTAssertTrue(newestMessage(app).waitForExistence(timeout: 15),
                      "re-opened a channel and didn't land on the newest message")
        XCTAssertFalse(jumpPill(app).exists, "opened at the bottom, so no pill")
    }

    private func switchChannel(_ app: XCUIApplication, to name: String) {
        app.buttons["nav.menu"].tap()
        let row = app.descendants(matching: .any)
            .matching(identifier: "sidebar.channel.\(name)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no sidebar row for #\(name)")
        row.tap()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 15), "#\(name) never opened")
    }
}

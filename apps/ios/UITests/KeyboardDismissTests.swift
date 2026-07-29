import XCTest

/// #69 / #139 — the software keyboard must go down when the drawer opens and
/// on *any* tap or scroll of the chat area. All three were unverifiable before:
/// composer focus is private to `ComposerView`, and simctl can't tap. XCUITest
/// can, from inside the simulator, so this is the acceptance criteria written
/// down.
///
/// Needs a dev server on 127.0.0.1:8787 with `qa-seed.mjs` fixtures (override
/// with `FLOW_TEST_SERVER_URL` if 8787 is taken), and the simulator's software
/// keyboard enabled (Hardware ▸ Keyboard ▸ Connect Hardware Keyboard OFF) —
/// otherwise nothing raises a keyboard to dismiss.
final class KeyboardDismissTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    /// The channel to land in. Override when `#general` is unusable — old QA-Lab
    /// rows are encrypted with a dev key a fresh server doesn't hold, and the
    /// scroll case wants a transcript long enough to actually scroll.
    private var channelName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_CHANNEL"] ?? "general"
    }

    /// The keyboard is gone within a few seconds.
    private func assertKeyboardDismissed(_ app: XCUIApplication) {
        let gone = expectation(for: NSPredicate(format: "exists == false"),
                               evaluatedWith: app.keyboards.element)
        wait(for: [gone], timeout: 5)
    }

    /// Signed in as the QA fixture user, sitting in #general with the composer
    /// focused and the keyboard up.
    private func launchWithKeyboardUp() throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channelName,
        ]
        app.launch()

        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60), "never reached a channel — is the dev server seeded?")
        composer.tap()
        XCTAssertTrue(app.keyboards.element.waitForExistence(timeout: 5),
                      "no software keyboard — is Connect Hardware Keyboard off?")
        return app
    }

    /// Acceptance: focus the composer, open the drawer → keyboard is down.
    func testOpeningDrawerDismissesKeyboard() throws {
        let app = try launchWithKeyboardUp()

        app.buttons["nav.menu"].tap()

        XCTAssertTrue(app.otherElements["nav.drawerBackdrop"].waitForExistence(timeout: 5), "drawer didn't open")
        assertKeyboardDismissed(app)
    }

    /// Acceptance: focus the composer, tap the message list → keyboard is down,
    /// and the tap doesn't get swallowed into some other navigation.
    func testTappingMessageListDismissesKeyboard() throws {
        let app = try launchWithKeyboardUp()

        // Empty space in the list, above the composer and below the header.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()

        assertKeyboardDismissed(app)
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch.exists,
                      "tap navigated away instead of just dismissing the keyboard")
    }

    /// Acceptance (#139): scrolling the transcript dismisses eagerly. The drag
    /// goes *downward* — back through history, away from the keyboard — which
    /// is exactly the gesture `.interactively` left the keyboard standing for.
    func testScrollingMessageListDismissesKeyboard() throws {
        let app = try launchWithKeyboardUp()

        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.20))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.50))
        start.press(forDuration: 0.05, thenDragTo: end)

        assertKeyboardDismissed(app)
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch.exists,
                      "scroll navigated away instead of just dismissing the keyboard")
    }
}

import XCTest

/// #69 — the software keyboard must go down when the drawer opens and when you
/// tap the message list. Both were unverifiable before: composer focus is
/// private to `ComposerView`, and simctl can't tap. XCUITest can, from inside
/// the simulator, so this is the acceptance criteria written down.
///
/// Needs a dev server on 127.0.0.1:8787 with `qa-seed.mjs` fixtures, and the
/// simulator's software keyboard enabled (Hardware ▸ Keyboard ▸ Connect
/// Hardware Keyboard OFF) — otherwise nothing raises a keyboard to dismiss.
final class KeyboardDismissTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    /// Signed in as the QA fixture user, sitting in #general with the composer
    /// focused and the keyboard up.
    private func launchWithKeyboardUp() throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": "http://127.0.0.1:8787",
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": "general",
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
        let gone = expectation(for: NSPredicate(format: "exists == false"),
                               evaluatedWith: app.keyboards.element)
        wait(for: [gone], timeout: 5)
    }

    /// Acceptance: focus the composer, tap the message list → keyboard is down,
    /// and the tap doesn't get swallowed into some other navigation.
    func testTappingMessageListDismissesKeyboard() throws {
        let app = try launchWithKeyboardUp()

        // Empty space in the list, above the composer and below the header.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()

        let gone = expectation(for: NSPredicate(format: "exists == false"),
                               evaluatedWith: app.keyboards.element)
        wait(for: [gone], timeout: 5)
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch.exists,
                      "tap navigated away instead of just dismissing the keyboard")
    }
}

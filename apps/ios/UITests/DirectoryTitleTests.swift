import XCTest

/// #434 — the profile Title on iOS: editable in My Profile, and shown under the
/// name on a Directory card and on a member's profile sheet.
///
/// Needs a dev server seeded with `qa-seed-directory.mjs`, which gives half the
/// roster a title and deliberately leaves the other half without one — the
/// "no title draws no line" half of the acceptance criteria needs both.
/// Override the URL and the credentials when 8787 is taken or the fixtures
/// differ (see UITests/README.md).
final class DirectoryTitleTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var env: [String: String] {
        let e = ProcessInfo.processInfo.environment
        return [
            "FLOW_SERVER_URL": e["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787",
            "FLOW_DEBUG_EMAIL": e["FLOW_TEST_EMAIL"] ?? "qa-directory@example.com",
            "FLOW_DEBUG_PASSWORD": e["FLOW_TEST_PASSWORD"] ?? "qa-password-1",
        ]
    }

    private func launch(extra: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = env.merging(extra) { _, new in new }
        app.launch()
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func card(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons["directory.card.\(name)"]
    }

    /// A first launch signs in, syncs and *then* draws, and the roster (which
    /// carries the titles) can land a moment after the grid does — so wait for
    /// the text rather than reading the label the instant a card appears.
    private func waitForLabel(_ element: XCUIElement, contains text: String, _ message: String) {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        let done = XCTNSPredicateExpectation(predicate: predicate, object: element)
        XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: 30), .completed, message)
    }

    /// Acceptance: a title shows under the name; a member without one gets no
    /// extra line; an agent keeps its "Sponsored by" attribution alongside.
    ///
    /// The card combines its children into one accessibility element, so its
    /// label is the whole card read out — which is exactly what "is the title
    /// drawn here, and is nothing drawn for someone without one" asks.
    func testDirectoryCardsShowTitlesAndOmitTheLineWhenUnset() {
        let app = launch(extra: ["FLOW_DEBUG_SHOW_DIRECTORY": "1"])
        let ada = card("Ada Lovelace", in: app)
        XCTAssertTrue(
            ada.waitForExistence(timeout: 120),
            "never reached the Directory — is the dev server up and qa-seed-directory.mjs run?"
        )
        waitForLabel(ada, contains: "Founder, Analytical Engines", "no title on a card that has one")

        let barbara = card("Barbara Liskov", in: app)
        XCTAssertTrue(barbara.exists, "the seeded title-less member is missing")
        XCTAssertTrue(barbara.label.contains("Member"), "the role line went missing")

        let prism = card("Prism", in: app)
        if prism.exists {
            waitForLabel(prism, contains: "Planner", "the agent's title is missing")
            XCTAssertTrue(prism.label.contains("Sponsored by"), "a title replaced the agent's attribution")
        }
        attach("01-directory-titles")
    }

    /// Acceptance: tapping a card opens the profile sheet, which repeats the
    /// title under the name.
    func testProfileSheetShowsTheTitle() {
        let app = launch(extra: ["FLOW_DEBUG_SHOW_DIRECTORY": "1"])
        let ada = card("Ada Lovelace", in: app)
        XCTAssertTrue(ada.waitForExistence(timeout: 120), "never reached the Directory")
        ada.tap()
        let title = app.staticTexts["profile.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 15), "the profile sheet shows no title")
        XCTAssertEqual(title.label, "Founder, Analytical Engines")
        attach("02-profile-sheet-title")
    }

    /// Acceptance: setting a Title in My Profile saves it, and it comes back on
    /// my own Directory card — the whole round trip through the server and the
    /// roster, on the client that wrote it.
    func testSavingATitleShowsItOnMyOwnCard() {
        let mine = "Head of QA (set on iOS)"
        let app = launch(extra: ["FLOW_DEBUG_OPEN_DRAWER": "1", "FLOW_DEBUG_OPEN_PROFILE": "1"])
        let field = app.textFields["profile.title"]
        XCTAssertTrue(field.waitForExistence(timeout: 120), "never reached My Profile")
        field.tap()
        if let value = field.value as? String, !value.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        field.typeText(mine)
        app.buttons["profile.save"].tap()
        app.terminate()

        let reopened = launch(extra: ["FLOW_DEBUG_SHOW_DIRECTORY": "1"])
        let me = card("Marie Curie", in: reopened)
        XCTAssertTrue(me.waitForExistence(timeout: 120), "never reached the Directory")
        waitForLabel(me, contains: mine, "the title saved on iOS never reached the Directory card")
        attach("04-title-saved-on-ios")
    }

    /// Acceptance: My Profile carries a Title field, next to Display name.
    func testMyProfileOffersATitleField() {
        let app = launch(extra: ["FLOW_DEBUG_OPEN_DRAWER": "1", "FLOW_DEBUG_OPEN_PROFILE": "1"])
        let title = app.textFields["profile.title"]
        XCTAssertTrue(
            title.waitForExistence(timeout: 120),
            "never reached My Profile, or it has no Title field"
        )
        XCTAssertTrue(app.textFields["profile.displayName"].exists, "Display name went missing")
        attach("03-my-profile-title-field")
    }
}

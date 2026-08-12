import XCTest

/// #220 — the expanded profile on iOS: a website link and a free-text bio.
///
/// The website is the security-relevant half. The server rejects anything that
/// is not an absolute http(s) URL, and this test is the iOS half of that story:
/// the form must say why before it lets you try, so a `javascript:` URL can
/// never leave the client in the first place.
///
/// Needs a dev server holding an account whose profile is already set. Override
/// the URL and the credentials when 8787 is taken or the fixtures differ.
final class ProfileFieldsTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var env: [String: String] {
        let e = ProcessInfo.processInfo.environment
        return [
            "FLOW_SERVER_URL": e["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787",
            "FLOW_DEBUG_EMAIL": e["FLOW_TEST_EMAIL"] ?? "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": e["FLOW_TEST_PASSWORD"] ?? "qa-password-1",
            // opens the account sheet and pushes My Profile, so the test starts
            // on the form instead of tapping its way there
            "FLOW_DEBUG_OPEN_DRAWER": "1",
            "FLOW_DEBUG_OPEN_PROFILE": "1",
        ]
    }

    private func launchOnProfile() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = env
        app.launch()
        let website = app.textFields["profile.website"]
        XCTAssertTrue(
            website.waitForExistence(timeout: 60),
            "never reached My Profile — is the dev server up and the account seeded?"
        )
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Acceptance: both fields exist, and the bio counter states the limit
    /// rather than leaving you to discover it when Save fails.
    func testProfileFormOffersWebsiteAndBio() {
        let app = launchOnProfile()
        XCTAssertTrue(app.textViews["profile.bio"].exists || app.textFields["profile.bio"].exists, "no bio field")
        XCTAssertTrue(
            app.staticTexts["profile.bioCount"].waitForExistence(timeout: 10),
            "the bio has no character counter"
        )
        XCTAssertTrue(app.staticTexts["profile.bioCount"].label.hasSuffix("/500"), "the counter doesn't name the limit")
        attach("01-profile-fields")
    }

    /// Acceptance — the security case: a `javascript:` URL is refused in the
    /// form, with a message that says what is wanted, and Save is unavailable
    /// while it stands. (The server refuses it as well; that half is covered by
    /// the schema tests.)
    func testJavascriptUrlIsRejectedBeforeSaving() {
        let app = launchOnProfile()
        let website = app.textFields["profile.website"]
        website.tap()
        // clear whatever the account already has
        if let value = website.value as? String, !value.isEmpty {
            website.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        website.typeText("javascript:alert(1)")

        let error = app.staticTexts["profile.websiteError"]
        XCTAssertTrue(error.waitForExistence(timeout: 10), "a javascript: URL produced no error message")
        XCTAssertTrue(error.label.contains("http://"), "the message doesn't say what a good link looks like")
        XCTAssertFalse(app.buttons["profile.save"].isEnabled, "Save stayed enabled with an invalid website")
        attach("02-invalid-url-rejected")
    }

    /// A full http(s) URL clears the error and re-enables Save — the message
    /// must be a gate, not a dead end.
    func testValidUrlClearsTheError() {
        let app = launchOnProfile()
        let website = app.textFields["profile.website"]
        website.tap()
        if let value = website.value as? String, !value.isEmpty {
            website.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        website.typeText("javascript:alert(1)")
        XCTAssertTrue(app.staticTexts["profile.websiteError"].waitForExistence(timeout: 10))

        website.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "javascript:alert(1)".count))
        website.typeText("https://example.com")
        XCTAssertFalse(
            app.staticTexts["profile.websiteError"].waitForExistence(timeout: 3),
            "the error stayed after the URL was fixed"
        )
        XCTAssertTrue(app.buttons["profile.save"].isEnabled, "Save stayed disabled for a valid URL")
        attach("03-valid-url-accepted")
    }
}

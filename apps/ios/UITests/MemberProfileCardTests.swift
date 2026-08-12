import XCTest

/// #223 — the member profile card on iOS: the first way to see anyone else's
/// avatar, bio and website. Before this, iOS could edit your own profile and
/// view nobody's.
///
/// Needs a dev server seeded with `qa-seed.mjs` then `qa-seed-profiles.mjs`,
/// which creates `#profiles223` holding a message from Bob (website + bio set)
/// and one from Alice (neither), plus a thread. Override the URL, the
/// credentials and the channel when 8787 is taken or the fixtures differ.
final class MemberProfileCardTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var env: [String: String] {
        let e = ProcessInfo.processInfo.environment
        return [
            "FLOW_SERVER_URL": e["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787",
            "FLOW_DEBUG_EMAIL": e["FLOW_TEST_EMAIL"] ?? "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": e["FLOW_TEST_PASSWORD"] ?? "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": e["FLOW_TEST_PROFILE_CHANNEL"] ?? "profiles223",
        ]
    }

    private func launch(extra: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = env.merging(extra) { _, new in new }
        app.launch()
        return app
    }

    /// The rows carry the message id in their identifier, which a test can't
    /// know — match the prefix instead.
    private func firstButton(_ prefix: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
    }

    private func waitForTranscript(_ app: XCUIApplication) {
        let avatar = firstButton("msg.avatar.", in: app)
        XCTAssertTrue(
            avatar.waitForExistence(timeout: 60),
            "no message rows — is the dev server up and #profiles223 seeded?"
        )
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Acceptance 1: the avatar is the tap target people reach for first.
    func testTappingAvatarOpensTheCard() {
        let app = launch()
        waitForTranscript(app)
        firstButton("msg.avatar.", in: app).tap()
        XCTAssertTrue(
            app.staticTexts["profile.name"].waitForExistence(timeout: 20),
            "tapping an avatar opened no profile card"
        )
        attach("01-card-from-avatar")
    }

    /// Acceptance 2: so is the name, which is the bigger target of the two.
    func testTappingSenderNameOpensTheCard() {
        let app = launch()
        waitForTranscript(app)
        firstButton("msg.sender.", in: app).tap()
        XCTAssertTrue(
            app.staticTexts["profile.name"].waitForExistence(timeout: 20),
            "tapping a sender name opened no profile card"
        )
    }

    /// Acceptance 3: the same from a thread — a sheet over the pushed screen,
    /// so the navigation stack does not grow a third level.
    func testCardOpensFromAThread() {
        let app = launch(extra: ["FLOW_DEBUG_OPEN_THREAD_LAST": "1"])
        XCTAssertTrue(
            app.navigationBars["Thread"].waitForExistence(timeout: 60),
            "the thread screen never opened"
        )
        firstButton("msg.avatar.", in: app).tap()
        XCTAssertTrue(
            app.staticTexts["profile.name"].waitForExistence(timeout: 20),
            "tapping an avatar in a thread opened no profile card"
        )
        XCTAssertTrue(app.navigationBars["Thread"].exists, "the thread screen was replaced rather than covered")
        attach("02-card-from-thread")
    }

    /// Acceptance 4: a profile with both fields shows both, and the bio keeps
    /// the author's line breaks.
    func testFilledProfileShowsWebsiteAndBio() {
        let app = launch(extra: ["FLOW_DEBUG_OPEN_MEMBER": "Bob"])
        XCTAssertTrue(app.staticTexts["profile.name"].waitForExistence(timeout: 60), "no card for Bob")
        XCTAssertEqual(app.staticTexts["profile.name"].label, "Bob")
        // SwiftUI's Link is exposed to XCUITest as a button, not a link.
        XCTAssertTrue(app.buttons["profile.website"].exists, "Bob's website is missing from his card")
        XCTAssertEqual(
            app.buttons["profile.website"].label, "example.com/bob",
            "the link text should drop the scheme"
        )
        XCTAssertTrue(app.staticTexts["profile.bio"].waitForExistence(timeout: 5), "Bob's bio is missing")
        XCTAssertTrue(app.staticTexts["profile.bio"].label.contains("\n"), "the bio lost its line break")
        attach("03-card-with-website-and-bio")
    }

    /// Acceptance 5: neither field set means neither row is drawn — the common
    /// case must look deliberate rather than like a card that failed to load.
    func testEmptyProfileDrawsNoEmptyRows() {
        let app = launch(extra: ["FLOW_DEBUG_OPEN_MEMBER": "Alice"])
        XCTAssertTrue(app.staticTexts["profile.name"].waitForExistence(timeout: 60), "no card for Alice")
        XCTAssertEqual(app.staticTexts["profile.name"].label, "Alice")
        XCTAssertFalse(app.staticTexts["profile.bio"].exists, "an empty bio still drew a row")
        XCTAssertFalse(app.buttons["profile.website"].exists, "an empty website still drew a row")
        attach("04-card-with-neither")
    }

    /// Acceptance 6 — the security-relevant half. The link must leave the app
    /// for the system browser, and the scheme is re-checked before it is made
    /// tappable at all (`safeWebsiteURL`), so a bad value can only ever be text.
    func testWebsiteOpensTheSystemBrowser() {
        let app = launch(extra: ["FLOW_DEBUG_OPEN_MEMBER": "Bob"])
        XCTAssertTrue(app.staticTexts["profile.name"].waitForExistence(timeout: 60), "no card for Bob")
        let link = app.buttons["profile.website"]
        XCTAssertTrue(link.waitForExistence(timeout: 10), "no tappable website on the card")
        link.tap()

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(
            safari.wait(for: .runningForeground, timeout: 30),
            "tapping the website did not hand off to the system browser"
        )
        attach("05-website-opened-safari")
        safari.terminate()
    }
}

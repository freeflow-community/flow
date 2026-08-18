import XCTest

/// Acceptance cover for #280: a channel whose rows are long agent-style
/// messages opened to a *blank* message area and stayed blank until the reader
/// dragged it. The transcript was already loaded — the scroll indicator proved
/// the content was there — so the viewport was parked past the end of it, which
/// is `.defaultScrollAnchor(.bottom, for: .initialOffset)` resolving against the
/// `LazyVStack`'s estimated content height.
///
/// **This does not reproduce #280**, and it is not claimed to. The reported
/// fault did not reproduce in the simulator on any fixture tried (see the PR):
/// it needs the estimate to actually be wrong, and which transcripts do that is
/// exactly what the report couldn't pin down either ("not every channel does
/// it"). What this pins is the acceptance criterion the fix has to keep true —
/// a fully-cached transcript of tall rows is *at its newest message* when the
/// screen appears, with no gesture. The unit cover for the decision itself is
/// `TranscriptFollowTests` in the macOS package, which both apps compile.
///
/// The distinction from `ScrollBehaviorTests.testOpensAtNewestMessage` is the
/// transcript and the cache: that one runs on uniform one-line messages, where
/// the estimate is right and nothing can overshoot.
///
/// Needs a dev server with a channel of long multi-paragraph messages whose
/// last message contains `NEWEST MESSAGE` — `FLOW_TEST_CHANNEL_LONG`, default
/// `scroll280c`. See UITests/README.md.
final class BlankTranscriptTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    /// A channel of long messages. The test is vacuous without one: short
    /// uniform rows are exactly the case the estimate gets right.
    private var longChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_CHANNEL_LONG"] ?? "scroll280c"
    }

    /// The seeded last message of that channel.
    private static let newestBody = "NEWEST MESSAGE"

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "scott@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": longChannel,
        ]
        app.launch()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60),
                      "never reached a channel — is the dev server seeded?")
        return app
    }

    private func newest(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", Self.newestBody)
        ).firstMatch
    }

    /// Open a long transcript with its history already in the local cache, so
    /// the list renders fully populated on its very first layout pass and the
    /// anchor is the only thing positioning it. The first launch fills the
    /// cache; the second is the one under test.
    ///
    /// `isHittable`, not `exists`, is the assertion that matters — a message
    /// sitting in the blank space below the viewport still *exists*.
    func testCachedLongTranscriptOpensOnItsNewestMessage() {
        _ = launch()
        let app = launch()
        let last = newest(app)
        XCTAssertTrue(last.waitForExistence(timeout: 30), "the transcript didn't load")
        XCTAssertTrue(last.isHittable,
                      "opened past the end of the content — the message area is blank (#280)")
        XCTAssertFalse(
            app.descendants(matching: .any).matching(identifier: "msg.jumpToLatest").firstMatch.exists,
            "opened at the bottom, so nothing should be offering a trip to the bottom")
    }
}

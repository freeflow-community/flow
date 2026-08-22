import XCTest

/// Regression cover for #306/#308: a single row that cannot fit made the whole
/// screen wider than the phone.
///
/// A row reports its ideal width whether or not the width exists — a long
/// unbroken URL and a fixed-size link preview are the two seen in the wild —
/// and a `ScrollView`'s ideal width is its content's. The screen's `ZStack`
/// then sized to that and laid every sibling out inside it, so the transcript,
/// the composer and the floating header pill all hung off both edges.
///
/// The invariant this pins is deliberately blunt and content-independent: the
/// transcript is never wider than the window it lives in. It is asserted after
/// posting a URL long enough that no phone can fit it on one line.
final class TranscriptWidthTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var channel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_CHANNEL"] ?? "general"
    }

    /// Long enough to beat any iPhone's content column, and unbroken except at
    /// the slashes a URL always has — the shape that reproduced #308.
    private static let longURL =
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtranscriptwidth308&index=17"

    func testALongURLDoesNotWidenTheTranscript() {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channel,
            "FLOW_DEBUG_SEND": Self.longURL,
        ]
        app.launch()

        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60),
                      "never reached a channel — is the dev server seeded?")
        // The send is one-shot at launch; give the row time to land and lay out.
        XCTAssertTrue(app.staticTexts.containing(
            NSPredicate(format: "label CONTAINS %@", "transcriptwidth308")).firstMatch
            .waitForExistence(timeout: 30), "the long URL never appeared in the transcript")

        let window = app.windows.firstMatch.frame
        let transcript = app.scrollViews.firstMatch.frame
        XCTAssertLessThanOrEqual(
            transcript.width, window.width,
            "the transcript is \(transcript.width)pt wide in a \(window.width)pt window — "
                + "a row is forcing its ideal width on the screen again (#308)")
        XCTAssertGreaterThanOrEqual(
            transcript.minX, 0,
            "the transcript starts at \(transcript.minX) — it is wider than the window and centred")
    }
}

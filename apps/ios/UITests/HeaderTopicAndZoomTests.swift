import XCTest

/// #202 — the channel topic under the channel name in the header, and
/// pinch-to-zoom in both full-screen image viewers. Both are visual and both
/// are gestures, so this is the acceptance criteria written down and the
/// source of the PR screenshots, which it attaches at each step.
///
/// Needs a dev server with `qa-seed.mjs` fixtures plus the #202 ones:
/// `topic202` (a long topic, one image message, the same image as an
/// artifact) and `notopic202` (no topic). Override the server with
/// `FLOW_TEST_SERVER_URL` when 8787 is taken.
final class HeaderTopicAndZoomTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var topicChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_TOPIC_CHANNEL"] ?? "topic202"
    }

    private var plainChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_NO_TOPIC_CHANNEL"] ?? "notopic202"
    }

    private func launch(inChannel name: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": name,
        ]
        app.launch()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60), "never reached #\(name) — did the #202 seed run?")
        return app
    }

    /// SwiftUI hangs an identifier on whatever element type it happens to
    /// build, so match on the identifier alone rather than guessing the type.
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    // MARK: - Part A: the header

    /// Acceptance 1: a channel with a topic shows it under the channel name.
    func testHeaderShowsTopicUnderChannelName() {
        let app = launch(inChannel: topicChannel)

        let bar = app.navigationBars["# \(topicChannel)"]
        XCTAssertTrue(bar.waitForExistence(timeout: 15), "no channel name in the header")

        let topic = app.staticTexts["channel.header.topic"]
        XCTAssertTrue(topic.waitForExistence(timeout: 10), "the topic never appeared under the name")
        XCTAssertFalse(topic.label.isEmpty)
        // Under the name, not in the bar beside it. (SwiftUI reports no useful
        // frame for this element, so the stacking itself is screenshot
        // evidence — the assertion here is that it is not a bar item.)
        XCTAssertFalse(bar.staticTexts["channel.header.topic"].exists,
                       "the topic belongs under the bar, not inside it")
        attach("01-header-with-topic")
    }

    /// Acceptance 2: no topic, no second line — and no gap where one would be.
    func testHeaderWithoutTopicIsUnchanged() {
        let app = launch(inChannel: plainChannel)

        XCTAssertTrue(app.navigationBars["# \(plainChannel)"].waitForExistence(timeout: 15),
                      "no channel name in the header")
        XCTAssertFalse(app.staticTexts["channel.header.topic"].exists,
                       "a channel with no topic must not render the second line")
        attach("02-header-without-topic")
    }

    // MARK: - Part B: zoom

    /// Acceptance 5 and 7: the chat lightbox pinches, double-taps and pans.
    func testLightboxZooms() {
        let app = launch(inChannel: topicChannel)

        let thumb = element(app, "msg.file.zoom-grid.png")
        XCTAssertTrue(thumb.waitForExistence(timeout: 20), "no image message in #\(topicChannel)")
        thumb.tap()

        let lightbox = app.otherElements["lightbox"]
        XCTAssertTrue(lightbox.waitForExistence(timeout: 15), "the lightbox didn't open")
        let image = element(app, "lightbox.image")
        XCTAssertTrue(image.waitForExistence(timeout: 20), "the image never loaded into the zoom scroll view")
        attach("03-lightbox-fit")

        image.pinch(withScale: 3, velocity: 2)
        attach("04-lightbox-zoomed")

        // Zoomed, the scroll view can actually scroll — that is the pan.
        image.swipeLeft()
        attach("05-lightbox-panned")

        // Double tap returns to fit, and a second one zooms back in.
        image.doubleTap()
        attach("06-lightbox-double-tap")

        app.buttons["lightbox.close"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
            .waitForExistence(timeout: 10), "closing the lightbox didn't return to the conversation")
    }

    /// Acceptance 6 and 7: the image artifact pane pinches too — the pane whose
    /// comment used to claim UIKit gave this for free.
    func testImageArtifactZooms() {
        let app = launch(inChannel: topicChannel)

        app.buttons["channel.menu"].tap()
        let artifacts = app.buttons["channel.artifacts"]
        XCTAssertTrue(artifacts.waitForExistence(timeout: 10), "no Artifacts item in the channel menu")
        artifacts.tap()
        let row = app.buttons["artifact.row.zoom-grid.png"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the image artifact isn't listed — did the #202 seed run?")
        row.tap()

        XCTAssertTrue(app.otherElements["artifact.sheet"].waitForExistence(timeout: 15))
        let image = element(app, "artifact.image.zoom-grid.png")
        XCTAssertTrue(image.waitForExistence(timeout: 20), "the artifact image isn't in a zoom scroll view")
        attach("07-artifact-fit")

        image.pinch(withScale: 3, velocity: 2)
        attach("08-artifact-zoomed")

        image.swipeUp()
        attach("09-artifact-panned")
        // Panning up while zoomed must pan, not dismiss the sheet.
        XCTAssertTrue(app.otherElements["artifact.sheet"].exists, "a pan while zoomed closed the viewer")

        image.doubleTap()
        attach("10-artifact-double-tap")

        app.buttons["artifact.close"].tap()
    }

    /// Acceptance 9: PDF artifacts still zoom, unchanged — PDFView brings its
    /// own pinch. Verification only; needs the `qa-seed-artifacts.mjs` channel.
    func testPdfArtifactStillZooms() throws {
        let app = launch(inChannel: topicChannel)

        app.buttons["channel.menu"].tap()
        app.buttons["channel.artifacts"].tap()
        let row = app.buttons["artifact.row.zoom-doc.pdf"]
        guard row.waitForExistence(timeout: 10) else {
            throw XCTSkip("no PDF artifact fixture in this workspace")
        }
        row.tap()

        let pdf = element(app, "artifact.pdf.zoom-doc.pdf")
        XCTAssertTrue(pdf.waitForExistence(timeout: 25), "the PDF pane didn't open")
        attach("11-pdf-fit")
        pdf.pinch(withScale: 3, velocity: 2)
        attach("12-pdf-zoomed")
        app.buttons["artifact.close"].tap()
    }
}

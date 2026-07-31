import XCTest

/// #157 — the iOS artifacts UI: a Docs button in the channel header badged with
/// the channel's artifact count, a dropdown listing them, and a full-screen
/// viewer. None of it is assertable from outside the simulator (the menu is a
/// system popover and the viewer is a sheet), so this is the acceptance
/// criteria written down — and the source of the PR screenshots, which it
/// attaches at each step.
///
/// Needs a dev server with `qa-seed.mjs` *and* `qa-seed-artifacts.mjs`
/// fixtures — the latter creates the `docs157` channel this drives. Override
/// the server with `FLOW_TEST_SERVER_URL` when 8787 is taken.
final class ArtifactsTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    /// The artifacts fixture channel (`qa-seed-artifacts.mjs`).
    private var channelName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_ARTIFACT_CHANNEL"] ?? "docs157"
    }

    private func launchInFixtureChannel() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channelName,
        ]
        app.launch()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60),
                      "never reached #\(channelName) — did qa-seed-artifacts.mjs run?")
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Acceptance: the header carries a Docs button, and its badge counts every
    /// artifact in the channel (four, in the fixture — including the link one).
    func testDocsButtonBadgeCountsChannelArtifacts() {
        let app = launchInFixtureChannel()

        let docs = app.buttons["channel.docs"]
        XCTAssertTrue(docs.waitForExistence(timeout: 15), "no Docs button in the channel header")
        XCTAssertEqual(docs.value as? String, "4", "badge should count every artifact in the channel")
        attach("01-docs-badge")
    }

    /// Acceptance: tapping Docs lists the channel's artifacts, one row each.
    func testDocsMenuListsArtifacts() {
        let app = launchInFixtureChannel()

        app.buttons["channel.docs"].tap()

        let board = app.buttons["artifact.row.task-board.html"]
        XCTAssertTrue(board.waitForExistence(timeout: 10), "the dropdown didn't list the artifacts")
        XCTAssertTrue(app.buttons["artifact.row.release-notes.md"].exists)
        XCTAssertTrue(app.buttons["artifact.row.brand-swatch.png"].exists)
        XCTAssertTrue(app.buttons["artifact.row.freeflow.im"].exists, "link artifacts are listed too")
        attach("02-docs-menu")
    }

    /// Acceptance: selecting an HTML artifact shows it, rendered — the agent
    /// task-board case, which has no chat message behind it and was unreachable
    /// on iOS before. Closing returns to the conversation.
    func testOpeningHtmlArtifactShowsItAndClosing() {
        let app = launchInFixtureChannel()

        app.buttons["channel.docs"].tap()
        app.buttons["artifact.row.task-board.html"].tap()

        let sheet = app.otherElements["artifact.sheet"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 15), "the artifact viewer didn't open")
        XCTAssertTrue(app.staticTexts["task-board.html"].waitForExistence(timeout: 10),
                      "viewer isn't titled with the artifact name")
        // The sandboxed web view renders the document's own text.
        XCTAssertTrue(app.webViews.staticTexts["Flow work queue"].waitForExistence(timeout: 20),
                      "HTML artifact didn't render in the sandboxed web view")
        attach("03-html-artifact")

        app.buttons["artifact.close"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
            .waitForExistence(timeout: 10), "closing didn't return to the conversation")
    }

    /// Acceptance: a text artifact renders inline in the monospace pane rather
    /// than bouncing to QuickLook.
    func testOpeningTextArtifactRendersInline() {
        let app = launchInFixtureChannel()

        app.buttons["channel.docs"].tap()
        app.buttons["artifact.row.release-notes.md"].tap()

        XCTAssertTrue(app.otherElements["artifact.sheet"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.scrollViews["artifact.text.release-notes.md"].waitForExistence(timeout: 20),
                      "text artifact didn't render in the inline text pane")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Release notes'"))
            .firstMatch.waitForExistence(timeout: 10), "the pane is there but empty")
        attach("04-text-artifact")
    }

    /// Acceptance: an image artifact renders in the image pane (authed bytes,
    /// not a broken remote URL).
    func testOpeningImageArtifactShowsIt() {
        let app = launchInFixtureChannel()

        app.buttons["channel.docs"].tap()
        app.buttons["artifact.row.brand-swatch.png"].tap()

        XCTAssertTrue(app.otherElements["artifact.sheet"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.images["artifact.image.brand-swatch.png"].waitForExistence(timeout: 20),
                      "image artifact didn't render")
        attach("05-image-artifact")
    }

    /// Acceptance: link artifacts are reachable but read-only — an "Open in
    /// Safari" button, and no URL bar that would re-point the artifact under
    /// everyone else. Deliberate divergence from macOS/web (CHANGELOG Parity).
    func testLinkArtifactIsReadOnly() {
        let app = launchInFixtureChannel()

        app.buttons["channel.docs"].tap()
        app.buttons["artifact.row.freeflow.im"].tap()

        XCTAssertTrue(app.otherElements["artifact.sheet"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["artifact.link.open"].waitForExistence(timeout: 10),
                      "link artifact has no way out to Safari")
        XCTAssertFalse(app.textFields["artifact.link.urlField"].exists,
                       "iOS must not ship the co-browse URL bar — it broadcasts to every viewer")
        attach("06-link-artifact")
    }
}

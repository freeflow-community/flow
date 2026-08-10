import XCTest

/// #206 — the "What's new" sheet, iOS's parity with the web lightbox and the
/// macOS sheet. iOS fetches FEATURES.md from the server, so the acceptance
/// criteria are: the drawer's workspace menu offers it, real notes render, and
/// a server it can't reach produces a readable failure — not a blank page.
///
/// Needs a dev server (which serves `/FEATURES.md` out of the web dist) with
/// the `qa-seed.mjs` fixtures. Override the server with `FLOW_TEST_SERVER_URL`
/// when 8787 is taken.
final class FeaturesSheetTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    /// A port nothing listens on. `FLOW_DEBUG_FEATURES_URL` redirects only the
    /// notes fetch, so the app still signs in normally — which is what losing
    /// the network looks like to this screen.
    private let deadNotesURL = "http://127.0.0.1:1/FEATURES.md"

    private func launch(notesURL: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        var env = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
        ]
        if let notesURL { env["FLOW_DEBUG_FEATURES_URL"] = notesURL }
        app.launchEnvironment = env
        app.launch()
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 60), "never signed in — is the dev server up?")
        return app
    }

    /// Drawer → workspace menu → the version row that opens the sheet.
    private func openWorkspaceMenu(_ app: XCUIApplication) -> XCUIElement {
        app.buttons["nav.menu"].tap()
        let workspace = app.buttons["sidebar.workspaceMenu"]
        XCTAssertTrue(workspace.waitForExistence(timeout: 15), "the drawer never opened")
        workspace.tap()
        let versionRow = app.buttons["sidebar.buildNumber"]
        XCTAssertTrue(versionRow.waitForExistence(timeout: 10), "no version / What's new row in the workspace menu")
        return versionRow
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Acceptance: the entry point exists in the drawer, labelled with the build
    /// version like macOS's, and opens a sheet titled "What's new".
    func testWorkspaceMenuOffersWhatsNew() {
        let app = launch()
        let versionRow = openWorkspaceMenu(app)
        attach("01-sidebar-entry")

        versionRow.tap()
        XCTAssertTrue(
            app.staticTexts["What's new"].waitForExistence(timeout: 15),
            "tapping the version row didn't open the What's new sheet"
        )
    }

    /// Acceptance: the notes actually render — headings and bullets from the
    /// fetched FEATURES.md, not an empty scroll view.
    func testNotesRenderFromTheServer() {
        let app = launch()
        openWorkspaceMenu(app).tap()

        let notes = app.scrollViews["features.notes"]
        XCTAssertTrue(notes.waitForExistence(timeout: 30), "the notes never loaded from \(serverURL)")
        XCTAssertGreaterThan(
            notes.staticTexts.count, 5,
            "the sheet loaded but rendered almost nothing — check the markdown parse"
        )
        attach("02-whats-new-content")

        app.buttons["features.done"].tap()
        XCTAssertFalse(app.scrollViews["features.notes"].waitForExistence(timeout: 5), "Done didn't dismiss the sheet")
    }

    /// Acceptance: an unreachable server gives a message and a retry, because
    /// this screen needs the network and a blank page is the likely defect.
    func testUnreachableServerShowsMessageNotBlankScreen() {
        let app = launch(notesURL: deadNotesURL)

        openWorkspaceMenu(app).tap()

        let headline = app.descendants(matching: .any)
            .matching(identifier: "features.error.title").firstMatch
        XCTAssertTrue(headline.waitForExistence(timeout: 40), "a dead server produced no error state — blank screen?")
        XCTAssertTrue(
            app.descendants(matching: .any).matching(identifier: "features.retry").firstMatch.exists,
            "the failure explains itself but offers no way to try again"
        )
        attach("03-whats-new-offline")
    }
}

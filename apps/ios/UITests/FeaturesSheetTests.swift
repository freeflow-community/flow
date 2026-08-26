import XCTest

/// #206 — the "What's new" sheet, iOS's parity with the web lightbox and the
/// macOS sheet. FEATURES.md is bundled into the app by the "Bundle FEATURES.md"
/// build phase, so the acceptance criteria are: the drawer's workspace menu
/// offers it, and real notes render out of the bundle — no server involved.
///
/// Sign-in still needs a dev server with the `qa-seed.mjs` fixtures. Override
/// it with `FLOW_TEST_SERVER_URL` when 8787 is taken.
final class FeaturesSheetTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
        ]
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
    /// bundled FEATURES.md, not an empty scroll view. Nothing fetches them, so
    /// rendering at all is what proves the build phase bundled the file.
    func testNotesRenderFromTheBundle() {
        let app = launch()
        openWorkspaceMenu(app).tap()

        let notes = app.scrollViews["features.notes"]
        XCTAssertTrue(notes.waitForExistence(timeout: 30), "no notes — did the Bundle FEATURES.md phase run?")
        XCTAssertGreaterThan(
            notes.staticTexts.count, 5,
            "the sheet loaded but rendered almost nothing — check the markdown parse"
        )
        attach("02-whats-new-content")

        app.buttons["features.done"].tap()
        XCTAssertFalse(app.scrollViews["features.notes"].waitForExistence(timeout: 5), "Done didn't dismiss the sheet")
    }
}

import XCTest

/// #340 — leaving a workspace from the phone. The entry point is an item in a
/// system `Menu` and the confirmation is a system dialog, so none of it is
/// assertable from outside the simulator: this file is the acceptance criteria
/// written down, and the source of the PR screenshots.
///
/// Needs a dev server with **three** workspaces for the signed-in account: one
/// it owns (the disabled case), one it belongs to (the dialog), and a second it
/// belongs to that the destructive test is free to consume — leaving is one-way
/// without an admin to re-invite, so that test must not eat the fixture the
/// others need. Override the server and the account with `FLOW_TEST_SERVER_URL`
/// / `FLOW_TEST_EMAIL` / `FLOW_TEST_PASSWORD`, and the workspaces with
/// `FLOW_TEST_{MEMBER,LEAVABLE,OWNED}_WORKSPACE(_SLUG)`.
final class LeaveWorkspaceTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var env: [String: String] {
        let e = ProcessInfo.processInfo.environment
        return [
            "FLOW_SERVER_URL": e["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787",
            "FLOW_DEBUG_EMAIL": e["FLOW_TEST_EMAIL"] ?? "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": e["FLOW_TEST_PASSWORD"] ?? "qa-password-1",
        ]
    }

    /// A workspace the account is a plain member of — the one it may leave.
    private var memberWorkspace: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_MEMBER_WORKSPACE"] ?? "Throwaway QA"
    }
    private var memberSlug: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_MEMBER_WORKSPACE_SLUG"] ?? "throwaway-qa"
    }

    /// A second member workspace, sacrificed by the destructive test.
    private var leavableWorkspace: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_LEAVABLE_WORKSPACE"] ?? "Second Room"
    }
    private var leavableSlug: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_LEAVABLE_WORKSPACE_SLUG"] ?? "second-room"
    }

    /// A workspace the account owns — the one it may not.
    private var ownedWorkspace: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_OWNED_WORKSPACE"] ?? "Bo Owns This"
    }
    private var ownedSlug: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_OWNED_WORKSPACE_SLUG"] ?? "bo-owns-this"
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = env
        app.launch()
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Drawer → workspace menu. The menu is a system popover, so its items only
    /// exist once it is open — every assertion below has to re-open it.
    ///
    /// Opens the drawer only when it isn't already open: tapping `nav.menu`
    /// toggles, so an unconditional tap after `selectWorkspace` would *close*
    /// the drawer and leave the assertions reading a view on its way out.
    @discardableResult
    private func openWorkspaceMenu(_ app: XCUIApplication) -> XCUIElement {
        if !app.buttons["sidebar.workspaceMenu"].exists { openDrawer(app) }
        app.buttons["sidebar.workspaceMenu"].tap()
        let leave = app.buttons["sidebar.leaveWorkspace"]
        XCTAssertTrue(leave.waitForExistence(timeout: 10), "the workspace menu has no Leave Workspace item")
        return leave
    }

    /// Open the drawer without opening the workspace menu.
    private func openDrawer(_ app: XCUIApplication) {
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 60), "never signed in — is the dev server up?")
        menu.tap()
        XCTAssertTrue(
            app.buttons["sidebar.workspaceMenu"].waitForExistence(timeout: 20),
            "no workspace menu in the drawer"
        )
    }

    /// Switch workspace from the rail, not the menu: rail buttons carry stable
    /// `rail.workspace.<slug>` identifiers, while the menu rows are matched by
    /// display name — which also names the drawer header, so it is ambiguous.
    private func selectWorkspace(_ app: XCUIApplication, slug: String, name: String) {
        openDrawer(app)
        let rail = app.buttons["rail.workspace.\(slug)"]
        XCTAssertTrue(rail.waitForExistence(timeout: 20), "no \(name) in the workspace rail")
        rail.tap()
        XCTAssertTrue(
            app.buttons["sidebar.workspaceMenu"].label.contains(name),
            "tapping the rail did not switch to \(name) — header says \(app.buttons["sidebar.workspaceMenu"].label)"
        )
    }

    /// Acceptance 1: a member sees a destructive Leave Workspace item, and it
    /// confirms before doing anything.
    func testMemberSeesLeaveWorkspaceAndAConfirmation() {
        let app = launch()
        selectWorkspace(app, slug: memberSlug, name: memberWorkspace)

        let leave = openWorkspaceMenu(app)
        XCTAssertTrue(leave.isEnabled, "a plain member must be able to leave — item reads \(leave.label)")
        attach("01-workspace-menu")
        leave.tap()

        XCTAssertTrue(
            app.staticTexts["Leave \(memberWorkspace)?"].waitForExistence(timeout: 10),
            "confirming dialog never named the workspace"
        )
        XCTAssertTrue(
            app.staticTexts["You'll lose access to all its channels. Your past messages will remain."].exists,
            "the dialog does not say what is lost and what survives"
        )
        XCTAssertTrue(app.buttons["Cancel"].exists, "no way out of the dialog")
        attach("02-confirm-dialog")

        // Cancel keeps the membership — the destructive half is exercised by
        // the next test, which has nothing left to do afterwards.
        app.buttons["Cancel"].tap()
        XCTAssertTrue(
            app.buttons["rail.workspace.\(memberSlug)"].waitForExistence(timeout: 10),
            "Cancel still left the workspace"
        )
    }

    /// Acceptance 2: confirming leaves for real — the workspace is gone from the
    /// switcher, and stays gone when the app is relaunched.
    func testConfirmingLeavesAndTheWorkspaceStaysGone() {
        let app = launch()
        selectWorkspace(app, slug: leavableSlug, name: leavableWorkspace)

        openWorkspaceMenu(app).tap()
        let confirm = app.buttons["Leave Workspace"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "no confirm button in the dialog")
        confirm.tap()

        // The client lands on another workspace; the one just left is gone.
        // Poll rather than `expectation(for:)` — the completion-handler form
        // captures the test case, which Swift 6 rejects as non-Sendable.
        let rail = app.buttons["rail.workspace.\(leavableSlug)"]
        let deadline = Date().addingTimeInterval(30)
        while rail.exists && Date() < deadline {
            usleep(500_000)
        }
        XCTAssertFalse(rail.exists, "the workspace is still in the switcher after leaving")
        attach("03-after-leaving")

        // Restart: a departure that only lived in memory would come back.
        app.terminate()
        app.launch()
        openDrawer(app)
        XCTAssertFalse(
            app.buttons["rail.workspace.\(leavableSlug)"].exists,
            "the workspace came back after a relaunch"
        )
        attach("04-after-relaunch")
    }

    /// Acceptance 4: the owner cannot leave, and is told why rather than being
    /// left to guess at a greyed-out row.
    func testOwnerCannotLeaveAndIsToldWhy() {
        let app = launch()
        selectWorkspace(app, slug: ownedSlug, name: ownedWorkspace)

        let leave = openWorkspaceMenu(app)
        XCTAssertFalse(leave.isEnabled, "the owner must not be able to leave")
        XCTAssertTrue(
            leave.label.contains("transfer ownership"),
            "the disabled item does not explain itself — got \(leave.label)"
        )
        attach("05-owner-disabled")
    }
}

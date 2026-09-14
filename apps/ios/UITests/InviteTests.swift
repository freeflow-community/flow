import XCTest

/// #283 — inviting someone to the workspace from iOS. Until now the phone had
/// no invite surface at all: you could join a workspace on iOS but never bring
/// anyone else into one, and #85's join-link management had nowhere to live.
///
/// The sheet is a modal reached through a system `Menu`, so none of this is
/// assertable from outside the simulator — this file is the acceptance criteria
/// written down, and the source of the PR screenshots.
///
/// Needs a dev server seeded with `qa-seed.mjs`. Alice owns the QA Lab
/// workspace; Bob is a plain member, which is what makes the admin-only
/// join-link section testable in both directions. Override the server with
/// `FLOW_TEST_SERVER_URL` when 8787 is taken.
final class InviteTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var env: [String: String] {
        let e = ProcessInfo.processInfo.environment
        return [
            "FLOW_SERVER_URL": e["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787",
            "FLOW_DEBUG_EMAIL": e["FLOW_TEST_EMAIL"] ?? "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": e["FLOW_TEST_PASSWORD"] ?? "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": e["FLOW_TEST_CHANNEL"] ?? "general",
        ]
    }

    /// A workspace member with no admin rights — the server answers 403 on the
    /// join-link route for them, which is what hides the section.
    private var memberEmail: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_MEMBER_EMAIL"] ?? "bob@qa.local"
    }

    private func launch(as email: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = email.map { env.merging(["FLOW_DEBUG_EMAIL": $0]) { _, new in new } } ?? env
        app.launch()
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Drawer → workspace menu → "Invite People…". The menu is a system popover,
    /// so its items only exist once it is open.
    private func openInviteSheet(_ app: XCUIApplication) {
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 60), "never signed in — is the dev server up and seeded?")
        menu.tap()
        let workspaceMenu = app.buttons["sidebar.workspaceMenu"]
        XCTAssertTrue(workspaceMenu.waitForExistence(timeout: 20), "no workspace menu in the drawer")
        workspaceMenu.tap()
        let invite = app.buttons["sidebar.invitePeople"]
        XCTAssertTrue(invite.waitForExistence(timeout: 10), "the workspace menu has no Invite People item")
        invite.tap()
        XCTAssertTrue(
            app.buttons["invite.create"].waitForExistence(timeout: 20),
            "Invite People opened no sheet"
        )
    }

    /// Acceptance 1: the workspace menu offers Invite People, and it opens a
    /// sheet with an email field. This is the whole of what #283 asks for.
    func testWorkspaceMenuOpensTheInviteSheet() {
        let app = launch()
        openInviteSheet(app)
        XCTAssertTrue(app.textFields["invite.email"].exists, "the sheet has no email field")
        XCTAssertFalse(
            app.buttons["invite.create"].isEnabled,
            "Create Invite should be disabled with no address typed"
        )
        attach("01-invite-sheet")
    }

    /// Acceptance 2: an address mints an invite link, shown with Copy and Share.
    /// The link is the deliverable — the server sends no email — so a sheet that
    /// creates one without showing it would be useless.
    func testCreatingAnInviteShowsACopyableLink() {
        let app = launch()
        openInviteSheet(app)

        let field = app.textFields["invite.email"]
        field.tap()
        field.typeText("invitee-283@example.com")
        let create = app.buttons["invite.create"]
        XCTAssertTrue(create.isEnabled, "Create Invite stayed disabled with an address typed")
        create.tap()

        let link = app.staticTexts["invite.link"]
        XCTAssertTrue(link.waitForExistence(timeout: 30), "no invite link came back")
        XCTAssertTrue(link.label.contains("invite"), "that does not look like an invite URL — got \(link.label)")
        XCTAssertTrue(app.buttons["invite.link.copy"].exists, "the link has no Copy button")
        XCTAssertTrue(app.buttons["invite.link.share"].exists, "the link has no Share button")
        attach("02-invite-link")

        app.buttons["invite.link.copy"].tap()
        XCTAssertTrue(
            app.buttons["Copied"].waitForExistence(timeout: 5),
            "Copy gave no confirmation"
        )
        attach("03-invite-link-copied")
    }

    /// Acceptance 3 (#85 on iOS): an admin can create, regenerate and revoke the
    /// workspace's persistent join link. Regenerate is also the revoke-a-leaked-
    /// link path, so the link must actually change.
    func testAdminCanManageTheJoinLink() {
        let app = launch()
        openInviteSheet(app)

        // Whatever the database held, get to a known state: a link exists.
        if app.buttons["invite.joinLink.create"].waitForExistence(timeout: 20) {
            app.buttons["invite.joinLink.create"].tap()
        }
        let link = app.staticTexts["invite.joinLink"]
        XCTAssertTrue(link.waitForExistence(timeout: 30), "no join link after Create")
        let first = link.label
        attach("04-join-link")

        // Poll rather than `expectation(for:)`: the completion handler form
        // captures the test case, which Swift 6 rejects as non-Sendable.
        app.buttons["invite.joinLink.regenerate"].tap()
        let deadline = Date().addingTimeInterval(30)
        while link.label == first && Date() < deadline {
            usleep(200_000)
        }
        XCTAssertNotEqual(
            link.label, first,
            "Regenerate returned the same link — the old one would still work"
        )
        attach("05-join-link-regenerated")

        app.buttons["invite.joinLink.revoke"].tap()
        XCTAssertTrue(
            app.buttons["invite.joinLink.create"].waitForExistence(timeout: 30),
            "after Revoke the section should offer to create a new link"
        )
        XCTAssertFalse(app.staticTexts["invite.joinLink"].exists, "the revoked link is still on screen")
        attach("06-join-link-revoked")
    }

    /// Acceptance 4: a plain member never sees the join-link section. The server
    /// is the authority (403), and the client must not render a section whose
    /// every button would fail.
    func testPlainMemberSeesNoJoinLinkSection() {
        let app = launch(as: memberEmail)
        openInviteSheet(app)
        // The invite half is still there — the section that must not appear is
        // the join-link one.
        XCTAssertTrue(app.textFields["invite.email"].exists, "the sheet did not open for a plain member")
        XCTAssertFalse(
            app.buttons["invite.joinLink.create"].exists,
            "a non-admin was offered join-link management"
        )
        XCTAssertFalse(app.staticTexts["invite.joinLink"].exists, "a non-admin was shown the join link")
        attach("07-member-no-join-link")
    }
}

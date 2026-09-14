import XCTest

/// #257 — starting a DM from iOS. Before this the app could only *open* a DM
/// someone else had created, so an iOS-only user had no way to write first.
///
/// Two entry points, both covered here: the "+" on the sidebar's Direct
/// Messages header, and the Message button on a member's profile card.
///
/// Needs a dev server seeded with `qa-seed.mjs` (Alice, Bob and Scott in the
/// QA Lab workspace). The picker lists every workspace member, so the group
/// case picks two of them by name rather than by seeded id.
final class NewDmTests: XCTestCase {
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

    /// The people the picker is expected to offer, signed in as Alice.
    private var firstPerson: String { ProcessInfo.processInfo.environment["FLOW_TEST_DM_PERSON"] ?? "Bob" }
    private var secondPerson: String { ProcessInfo.processInfo.environment["FLOW_TEST_DM_PERSON_2"] ?? "Scott" }

    private func launch(extra: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = env.merging(extra) { _, new in new }
        app.launch()
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Rows carry the user id, which the test can't know — match on the label.
    private func personRow(_ name: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH 'newDm.user.' AND label CONTAINS %@", name)
        ).firstMatch
    }

    /// Open the drawer and scroll the Direct Messages section into view. A
    /// workspace with many channels pushes it below the fold, XCUITest will not
    /// scroll to an element for you, and the list is lazy — an off-screen DM row
    /// does not exist to query at all until it has been scrolled to.
    @discardableResult
    private func openDrawerAtDms(_ app: XCUIApplication) -> XCUIElement {
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 60), "never signed in — is the dev server up and seeded?")
        menu.tap()
        let plus = app.buttons["dm.create"]
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the Direct Messages header has no + control")
        var scrolls = 0
        while !plus.isHittable && scrolls < 12 {
            app.swipeUp()
            scrolls += 1
        }
        XCTAssertTrue(plus.isHittable, "the + never came into view")
        return plus
    }

    /// Open the drawer and the picker through the "+" a person would tap.
    private func openPicker() -> XCUIApplication {
        let app = launch()
        openDrawerAtDms(app).tap()
        XCTAssertTrue(
            app.buttons["newDm.create"].waitForExistence(timeout: 20),
            "the + opened no people picker"
        )
        return app
    }

    /// Pick someone by searching for them first. The roster is long and lazily
    /// rendered, so filtering is the reliable way to reach a row — and it is
    /// what a person does too. Selection survives the search being cleared,
    /// which is what makes a group DM possible.
    private func select(_ name: String, in app: XCUIApplication) {
        let search = app.textFields["newDm.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 20), "no search field in the picker")
        search.tap()
        search.typeText(name)
        let row = personRow(name, in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "\(name) is missing from the picker")
        row.tap()
        app.buttons["newDm.clearSearch"].tap()
    }

    /// Acceptance 1: the "+" exists, opens a picker, and the picker lists the
    /// other people in the workspace — but never you (your self-DM is already
    /// pinned in the sidebar).
    func testSidebarPlusOpensAPeoplePicker() {
        let app = openPicker()
        XCTAssertTrue(
            personRow(firstPerson, in: app).waitForExistence(timeout: 20),
            "\(firstPerson) is missing from the picker"
        )
        XCTAssertFalse(
            personRow("Alice", in: app).exists,
            "the signed-in user should not be offered as a DM partner"
        )
        attach("01-people-picker")
    }

    /// Acceptance 2: the search field filters the list. It is a leaf control —
    /// an identifier on the row around it would hide it from this query.
    func testSearchFiltersThePicker() {
        let app = openPicker()
        let search = app.textFields["newDm.search"]
        XCTAssertTrue(search.waitForExistence(timeout: 20), "no search field in the picker")
        search.tap()
        search.typeText(firstPerson)
        XCTAssertTrue(personRow(firstPerson, in: app).waitForExistence(timeout: 10))
        XCTAssertFalse(personRow(secondPerson, in: app).exists, "search did not filter the list")
        attach("02-picker-filtered")
    }

    /// Acceptance 3: picking one person starts (or opens) the DM and lands in
    /// it. Start is disabled until something is selected — a picker that can
    /// create an empty DM is worse than no picker.
    func testStartingAOneToOneDmOpensTheConversation() {
        let app = openPicker()
        let create = app.buttons["newDm.create"]
        XCTAssertFalse(create.isEnabled, "Start should be disabled with nobody selected")
        select(firstPerson, in: app)
        XCTAssertTrue(create.isEnabled, "Start stayed disabled after picking someone")
        create.tap()
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "identifier == 'header.title' AND label == %@", firstPerson)
            ).firstMatch.waitForExistence(timeout: 30),
            "starting a DM did not open the conversation with \(firstPerson)"
        )
        attach("03-dm-opened")
    }

    /// Acceptance 4 (the duplicate trap): starting a DM with someone you
    /// already have one with must open that conversation, not create a second.
    /// Run twice in one test so the second run is guaranteed to be the
    /// already-exists case whatever the database held to begin with.
    func testStartingADmTwiceReusesTheSameConversation() {
        for pass in 1...2 {
            let app = openPicker()
            select(firstPerson, in: app)
            app.buttons["newDm.create"].tap()
            XCTAssertTrue(
                app.staticTexts.matching(
                NSPredicate(format: "identifier == 'header.title' AND label == %@", firstPerson)
            ).firstMatch.waitForExistence(timeout: 30),
                "pass \(pass): the DM with \(firstPerson) did not open"
            )
            // Back in the sidebar there must be exactly one row for them. A 1:1
            // DM's row identifier is exactly the other person's name, so this
            // cannot also match a group DM another test creates.
            openDrawerAtDms(app)
            let rows = app.buttons.matching(
                NSPredicate(format: "identifier == %@", "sidebar.dm.\(firstPerson)")
            )
            XCTAssertEqual(
                rows.count, 1,
                "pass \(pass): \(rows.count) DM rows for \(firstPerson) — a duplicate DM was created"
            )
            if pass == 2 { attach("04-no-duplicate-dm") }
            app.terminate()
        }
    }

    /// Acceptance 5: multi-select, because `createDm` takes a list and group
    /// DMs are real on every other client.
    func testStartingAGroupDm() {
        let app = openPicker()
        select(firstPerson, in: app)
        select(secondPerson, in: app)
        attach("05a-two-people-selected")
        app.buttons["newDm.create"].tap()
        // A group DM's title is the other members' names, comma-joined and
        // sorted — so both are in the header pill's title (#298).
        let bar = app.staticTexts.matching(
            NSPredicate(
                format: "identifier == 'header.title' AND label CONTAINS %@ AND label CONTAINS %@",
                firstPerson, secondPerson
            )
        ).firstMatch
        XCTAssertTrue(
            bar.waitForExistence(timeout: 30),
            "the group DM did not open with both people in its title"
        )
        attach("05-group-dm")
    }

    /// Acceptance 6: the second entry point — a member's profile card.
    func testMessageButtonOnAProfileCard() {
        let app = launch(extra: ["FLOW_DEBUG_OPEN_MEMBER": firstPerson])
        XCTAssertTrue(
            app.staticTexts["profile.name"].waitForExistence(timeout: 60),
            "no profile card for \(firstPerson)"
        )
        let message = app.buttons["profile.message"]
        XCTAssertTrue(message.waitForExistence(timeout: 10), "the profile card has no Message button")
        attach("06-profile-message-button")
        message.tap()
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "identifier == 'header.title' AND label == %@", firstPerson)
            ).firstMatch.waitForExistence(timeout: 30),
            "Message did not open the DM with \(firstPerson)"
        )
    }
}

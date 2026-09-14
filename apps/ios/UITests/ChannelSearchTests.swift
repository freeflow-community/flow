import XCTest

/// #570 — in-channel search: tapping the channel header opens a focused search
/// field under it, typing filters the channel's messages, tapping a result
/// jumps to it, and Cancel (or the header again) puts everything back.
///
/// This is the ticket's acceptance criteria written down, and the source of the
/// PR screenshots, which it attaches at each step. Pull them out with
/// `xcrun xcresulttool export attachments --path <run>.xcresult --output-path <dir>`.
///
/// Needs the `qa-seed.mjs` fixtures plus a conversation in the channel with
/// something to find — `pnpm qa:up` followed by this repo's #570 seed. The
/// query and its expected hit count are overridable, because the assertion is
/// "search found exactly the messages that contain it", not a fixed number:
/// `FLOW_TEST_SEARCH_QUERY` / `FLOW_TEST_SEARCH_HITS`.
final class ChannelSearchTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var channel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_CHANNEL"] ?? "general"
    }

    private var query: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SEARCH_QUERY"] ?? "deploy"
    }

    private var expectedHits: Int {
        Int(ProcessInfo.processInfo.environment["FLOW_TEST_SEARCH_HITS"] ?? "") ?? 4
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channel,
        ]
        app.launch()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60), "never reached #\(channel) — did the seed run?")
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

    /// Open search the way a person does: tap the channel name in the header.
    @discardableResult
    private func openSearch(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts["header.title"].tap()
        let field = element(app, "channel.search.query")
        XCTAssertTrue(field.waitForExistence(timeout: 5), "tapping the header did not open the search field")
        return field
    }

    // MARK: - Acceptance 1: open from the header, close again

    func testHeaderTapOpensFocusedFieldAndCancelRestoresTheChannel() {
        let app = launch()
        let field = openSearch(app)

        // "Gets focus immediately (keyboard up)" — the keyboard is the
        // observable half of that, and the one the ticket asks for.
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5),
                      "the search field opened without taking the keyboard")
        XCTAssertTrue(field.value as? String == nil || (field.value as? String)?.isEmpty == true
                      || (field.value as? String) == "Search in # \(channel)",
                      "the field should open empty")
        // The header itself must not move or disappear when the bar appears.
        XCTAssertTrue(app.staticTexts["header.title"].exists, "the header vanished when search opened")
        XCTAssertTrue(element(app, "channel.search.prompt").exists, "no empty-query prompt")
        attach("01-header-tap-opens-search")

        element(app, "channel.search.cancel").tap()
        XCTAssertFalse(element(app, "channel.search.query").waitForExistence(timeout: 3),
                       "Cancel left the search field on screen")
        let composer = element(app, "composer.input")
        XCTAssertTrue(composer.waitForExistence(timeout: 5), "the composer never came back after Cancel")
        attach("02-cancel-restores-channel")
    }

    /// The ticket's other dismissal: the header toggles.
    func testHeaderTapAgainClosesSearch() {
        let app = launch()
        openSearch(app)
        app.staticTexts["header.title"].tap()
        XCTAssertFalse(element(app, "channel.search.query").waitForExistence(timeout: 3),
                       "tapping the header a second time did not close search")
        XCTAssertTrue(element(app, "composer.input").waitForExistence(timeout: 5),
                      "the composer never came back")
    }

    // MARK: - Acceptance 2: matches from this channel, tap to jump

    func testQueryMatchesAndTappingAResultJumpsToTheMessage() {
        let app = launch()
        let field = openSearch(app)
        field.typeText(query)

        let count = element(app, "channel.search.count")
        XCTAssertTrue(count.waitForExistence(timeout: 5), "no result count")
        XCTAssertEqual(count.label, "\(expectedHits) messages",
                       "search found a different number of messages than the fixture contains")
        attach("03-results-for-query")

        let results = app.descendants(matching: .any).matching(identifier: "channel.search.result")
        XCTAssertEqual(results.count, expectedHits, "one row per matching message")

        let first = results.element(boundBy: 0)
        let snippet = first.staticTexts.element(boundBy: 1).label
        first.tap()

        // Tapping a result closes search and lands on the message in context.
        XCTAssertFalse(element(app, "channel.search.query").waitForExistence(timeout: 3),
                       "search stayed open after tapping a result")
        XCTAssertTrue(element(app, "composer.input").waitForExistence(timeout: 5),
                      "did not return to the channel")
        // The snippet is a window around the match, so compare on a word of it
        // rather than the whole string.
        if let word = snippet.split(separator: " ").first(where: { $0.count > 4 }) {
            let landed = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", String(word))).firstMatch
            XCTAssertTrue(landed.waitForExistence(timeout: 10),
                          "the tapped message is not on screen after the jump")
        }
        attach("04-jumped-to-message")
    }

    // MARK: - Acceptance 3: empty query and no matches

    func testNoMatchesShowsAnEmptyStateAndClearingReturnsToThePrompt() {
        let app = launch()
        let field = openSearch(app)

        // Empty query: a prompt, never the whole channel listed as "results".
        XCTAssertTrue(element(app, "channel.search.prompt").exists)
        XCTAssertFalse(element(app, "channel.search.count").exists)

        field.typeText("zzqqxx-no-such-message")
        let empty = element(app, "channel.search.empty")
        XCTAssertTrue(empty.waitForExistence(timeout: 5), "no empty state for a query that matches nothing")
        attach("05-no-matches")

        element(app, "channel.search.clear").tap()
        XCTAssertTrue(element(app, "channel.search.prompt").waitForExistence(timeout: 5),
                      "clearing the query should go back to the prompt, not stay on 'No matches'")
    }

    // MARK: - Discoverability

    /// The header tap is a bare gesture, so the same action has to exist as a
    /// real button — this is the one VoiceOver can reach.
    func testChannelMenuAlsoOpensSearch() {
        let app = launch()
        element(app, "channel.menu").tap()
        element(app, "channel.search").tap()
        XCTAssertTrue(element(app, "channel.search.query").waitForExistence(timeout: 5),
                      "the menu item did not open search")
    }
}

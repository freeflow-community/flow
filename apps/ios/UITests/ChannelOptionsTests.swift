import XCTest

/// #188 — the channel-options sheet behind the header's "⋯" menu. iOS had no
/// way to rename a channel or set its topic at all before this, so this is the
/// acceptance criteria written down (and the source of the PR screenshot).
///
/// Needs a dev server with the `qa-seed.mjs` fixtures. Override the server with
/// `FLOW_TEST_SERVER_URL` when 8787 is taken.
final class ChannelOptionsTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private func launch(inChannel channel: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channel,
        ]
        app.launch()
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 60), "never reached #\(channel) — did qa-seed.mjs run?")
        return app
    }

    private func openOptions(_ app: XCUIApplication) {
        app.buttons["channel.menu"].tap()
        let options = app.buttons["channel.options"]
        XCTAssertTrue(options.waitForExistence(timeout: 10), "no Channel Options item in the ⋯ menu")
        options.tap()
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Acceptance: the sheet opens from the menu, prefilled with the channel's
    /// name and topic, and offers a delete.
    func testOptionsSheetShowsNameTopicAndDelete() {
        let app = launch(inChannel: "docs157")

        openOptions(app)

        let name = app.textFields["channel.edit.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10), "the options sheet didn't open")
        XCTAssertEqual(name.value as? String, "docs157", "name should be prefilled with the channel's name")
        XCTAssertTrue(app.textFields["channel.edit.topic"].exists, "no topic field")
        XCTAssertTrue(app.buttons["channel.edit.delete"].exists, "no way to delete the channel")
        XCTAssertTrue(app.buttons["channel.edit.save"].exists, "no way to save")
        attach("07-channel-options")
    }

    /// Acceptance: #general is the one channel that can be neither renamed nor
    /// deleted (the server refuses both), so the UI must not offer either.
    func testGeneralCannotBeRenamedOrDeleted() {
        let app = launch(inChannel: "general")

        openOptions(app)

        let name = app.textFields["channel.edit.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 10), "the options sheet didn't open")
        XCTAssertFalse(name.isEnabled, "#general's name field should be disabled")
        XCTAssertFalse(app.buttons["channel.edit.delete"].exists, "#general must not offer a delete")
        attach("08-general-options")
    }

    /// Acceptance: a topic typed here actually reaches the server. The local
    /// row is only written after the PATCH succeeds (`SyncEngine.updateChannel`),
    /// so reopening the sheet and finding the new topic means it landed.
    func testSettingTopicReachesTheServer() {
        let stamp = "menu topic \(Int(Date().timeIntervalSince1970) % 100000)"
        let app = launch(inChannel: "docs157")

        openOptions(app)
        let topic = app.textFields["channel.edit.topic"]
        XCTAssertTrue(topic.waitForExistence(timeout: 10))
        topic.tap()
        // Clear whatever is there, then type the stamped topic.
        if let existing = topic.value as? String, !existing.isEmpty {
            topic.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count))
        }
        topic.typeText(stamp)
        attach("09-topic-set")
        app.buttons["channel.edit.save"].tap()

        // The sheet closes on success; reopen it and the field is the new topic.
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
            .waitForExistence(timeout: 15), "saving didn't close the sheet")
        openOptions(app)
        XCTAssertTrue(topic.waitForExistence(timeout: 10))
        XCTAssertEqual(topic.value as? String, stamp, "the topic didn't survive the round trip")
    }
}

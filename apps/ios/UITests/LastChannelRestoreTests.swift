import XCTest

/// #242: the app reopens the channel you were last reading, and falls back to
/// the normal landing screen when it can't.
///
/// Needs `qa-seed.mjs` plus the two nav fixture channels (`nav205a`,
/// `nav205b`) that `ThreadNavTests` uses — this test switches between them.
final class LastChannelRestoreTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var firstChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_THREAD_CHANNEL"] ?? "nav205a"
    }

    private var secondChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SECOND_CHANNEL"] ?? "nav205b"
    }

    /// Mirrors `Profile.suffix` / `Server.storageSuffix`: every stored key
    /// carries the server it belongs to (empty for the default local one), so
    /// a run against 8788 must not poke 8787's value.
    private var lastChannelKey: String {
        guard serverURL != "http://127.0.0.1:8787", let url = URL(string: serverURL) else {
            return "lastChannelId"
        }
        let hostPort = [url.host, url.port.map(String.init)].compactMap { $0 }.joined(separator: "-")
        let allowed = hostPort.unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "."
        }
        return "lastChannelId@" + String(String.UnicodeScalarView(allowed))
    }

    /// `openChannel` nil is the interesting case: a launch with no debug hook,
    /// i.e. exactly what a user's cold launch looks like.
    /// `storedChannel` writes the persisted key through UserDefaults' argument
    /// domain, which wins over what the app itself saved — the only way to put
    /// an unusable value there from outside the process.
    private func launch(openChannel: String?, storedChannel: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        var env = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
        ]
        if let openChannel { env["FLOW_DEBUG_OPEN_CHANNEL"] = openChannel }
        app.launchEnvironment = env
        if let storedChannel { app.launchArguments = ["-\(lastChannelKey)", storedChannel] }
        app.launch()
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func waitForChannel(_ app: XCUIApplication, _ name: String, _ message: String) {
        // The channel name is in the header pill (#298), not a system bar.
        let title = app.staticTexts["header.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 60), message)
        XCTAssertEqual(title.label, "# \(name)", message)
    }

    /// The headline behaviour: pick a channel by hand, quit, come back to it.
    /// The second launch carries no `FLOW_DEBUG_OPEN_CHANNEL`, so the only
    /// thing that can put the app in that channel is the restore.
    func testColdLaunchReopensTheChannelYouLeftFrom() {
        let app = launch(openChannel: firstChannel)
        waitForChannel(app, firstChannel, "never reached #\(firstChannel) — did the nav fixture run?")

        // Switch through the drawer, so what gets stored is a real user
        // selection rather than the launch hook's.
        app.buttons["nav.menu"].tap()
        let row = app.descendants(matching: .any)
            .matching(identifier: "sidebar.channel.\(secondChannel)").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "drawer never opened / no #\(secondChannel) row")
        row.tap()
        waitForChannel(app, secondChannel, "channel switch did not land in #\(secondChannel)")
        attach("before-quit-in-\(secondChannel)")

        app.terminate()

        let relaunched = launch(openChannel: nil)
        waitForChannel(relaunched, secondChannel,
                       "cold launch did not reopen #\(secondChannel)")
        attach("after-relaunch-in-\(secondChannel)")
    }

    /// A stored channel that isn't there any more (deleted, or an id from an
    /// account that no longer applies) must not strand the app on a blank
    /// conversation — it falls through to the ordinary landing screen.
    func testUnknownStoredChannelFallsBackToTheLandingScreen() {
        let app = launch(openChannel: nil, storedChannel: "no-such-channel-242")
        XCTAssertTrue(app.staticTexts["Select a channel"].waitForExistence(timeout: 60),
                      "an unusable stored channel should fall back to the landing screen")
        attach("fallback-landing-screen")
    }

    /// An explicit destination outranks the restored channel: here the debug
    /// hook stands in for a deep link or a tapped notification, which reach
    /// the same `selectChannel` path.
    func testExplicitDestinationBeatsTheStoredChannel() {
        let app = launch(openChannel: firstChannel)
        waitForChannel(app, firstChannel, "never reached #\(firstChannel)")
        app.terminate()

        // Stored channel says one thing, the launch destination says another.
        let relaunched = launch(openChannel: secondChannel)
        waitForChannel(relaunched, secondChannel,
                       "the explicit destination should win over the stored #\(firstChannel)")
        attach("explicit-destination-wins")
    }
}

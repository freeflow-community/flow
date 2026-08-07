import XCTest

/// Issue #191: the transcript must never render as bare background. The report
/// from the phone was a chat view that went blank after submitting a prompt,
/// showed the agent's "thinking…" row alone, and only then redrew the history —
/// long enough on a slow link to look like the conversation had been lost.
///
/// What was actually happening is the history load, not the send: nothing in the
/// sync layer deletes a channel's messages, so an empty transcript means the
/// local cache has no rows for that channel yet — and while the page was in
/// flight the list drew nothing at all. Two rules come out of that:
///
///   1. An empty transcript always says *why* — loading, or genuinely empty.
///   2. A message on screen before a send is still on screen after it.
///
/// Needs a dev server with `qa-seed.mjs` fixtures and a channel holding a
/// handful of messages; point `FLOW_TEST_CHANNEL` at one (`#general` in an old
/// QA Lab is often undecryptable — see UITests/README.md). Rule 1 is only
/// meaningful against a *slow* server, so `FLOW_TEST_SERVER_URL` should point at
/// a latency-shimmed one when running that case deliberately; against a fast
/// local server the assertion still holds, it just has less to catch.
final class SendKeepsTranscriptTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var channelName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_CHANNEL"] ?? "general"
    }

    /// A message seeded into the test channel that is on screen before the send.
    private var anchorText: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_ANCHOR"]
            ?? "Sounds like a failed optimistic reply that never un-bumped."
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "scott@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channelName,
        ]
        app.launch()
        return app
    }

    private func composer(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
    }

    private func anchor(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", anchorText)).firstMatch
    }

    /// Anything that counts as the transcript having something to say: a real
    /// message, the loading state, or the genuinely-empty state.
    private func transcriptSpeaks(_ app: XCUIApplication) -> Bool {
        app.descendants(matching: .any).matching(identifier: "msg.loading").firstMatch.exists
            || app.descendants(matching: .any).matching(identifier: "msg.emptyChannel").firstMatch.exists
            || anchor(app).exists
    }

    /// Rule 1. From the moment the channel screen exists until its history has
    /// landed, the transcript is never a void — it is loading, empty, or full.
    /// This is the one that failed before the fix: on a slowed link the list
    /// drew nothing for the whole round trip.
    func testTranscriptNeverRendersBlankWhileLoading() {
        let app = launch()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 60),
                      "never reached a channel — is the dev server seeded?")

        var silentSamples = 0
        for _ in 0..<60 {
            if anchor(app).exists { break } // history landed; nothing left to wait for
            if !transcriptSpeaks(app) { silentSamples += 1 }
            Thread.sleep(forTimeInterval: 0.15)
        }
        if silentSamples > 0 {
            add(XCTAttachment(screenshot: XCUIScreen.main.screenshot()))
        }
        XCTAssertEqual(silentSamples, 0, """
            the transcript rendered as bare background for \(silentSamples) sample(s) while \
            history was loading — that blank is what reads as a lost conversation
            """)
    }

    /// Rule 1b. Focusing the composer keeps the transcript on screen. Reported
    /// from the phone with a screen recording: tapping into the composer blanked
    /// the chat, tapping out brought it back.
    ///
    /// Asserted on *geometry*, not `exists` — the rows stay in the accessibility
    /// tree the whole time, laid out past the end of the viewport, so an
    /// existence check passes on a broken build. Needs a channel whose messages
    /// are several screens tall: the failure is the scroll position being
    /// recomputed from estimated row heights, and short rows estimate fine.
    func testKeyboardDoesNotBlankTranscript() {
        let app = launch()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 60),
                      "never reached a channel — is the dev server seeded?")
        XCTAssertTrue(anchor(app).waitForExistence(timeout: 60),
                      "precondition: the transcript should be on screen before focusing")
        XCTAssertTrue(isOnScreen(anchor(app), in: app),
                      "precondition: the newest message is on screen at rest")

        composer(app).tap() // raises the keyboard

        var blankSamples = 0
        for _ in 0..<20 {
            if !isOnScreen(anchor(app), in: app) { blankSamples += 1 }
            Thread.sleep(forTimeInterval: 0.15)
        }
        if blankSamples > 0 {
            add(XCTAttachment(screenshot: XCUIScreen.main.screenshot()))
        }
        XCTAssertEqual(blankSamples, 0, """
            the transcript scrolled out of view for \(blankSamples) sample(s) after the composer \
            took focus — the messages are still in the list, just not in the viewport
            """)
    }

    /// Is this element actually within the window, above the keyboard? `exists`
    /// is not enough — a row scrolled past the end of the viewport still exists,
    /// which is precisely how this bug hid from an existence check. One element
    /// query on purpose: a channel of screens-tall messages makes walking the
    /// whole accessibility tree slow enough to time the test out.
    private func isOnScreen(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        guard element.exists else { return false }
        let window = app.windows.firstMatch.frame
        let keyboardTop = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY : window.maxY
        let chatArea = CGRect(
            x: window.minX, y: window.minY,
            width: window.width, height: max(0, keyboardTop - window.minY)
        )
        let f = element.frame
        return f.width > 0 && f.height > 0 && f.intersects(chatArea)
    }

    /// Rule 2. Sending keeps what was already on screen. Sampling matters more
    /// than a single end-state assertion: the reported symptom is a transient,
    /// and a check that only looks once the dust settles passes on a broken
    /// build.
    func testTranscriptStaysOnScreenWhileSending() {
        let app = launch()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 60),
                      "never reached a channel — is the dev server seeded?")
        XCTAssertTrue(anchor(app).waitForExistence(timeout: 60),
                      "precondition: the anchor message should be on screen before sending")

        let body = "blank-check \(UUID().uuidString.prefix(8))"
        composer(app).tap()
        composer(app).typeText(body)
        app.descendants(matching: .any).matching(identifier: "composer.send").firstMatch.tap()

        for sample in 0..<20 {
            if !anchor(app).exists {
                add(XCTAttachment(screenshot: XCUIScreen.main.screenshot()))
                XCTFail("""
                    the transcript blanked \(sample) sample(s) after send: a message that was \
                    on screen before the send disappeared while the new one was in flight
                    """)
                return
            }
            Thread.sleep(forTimeInterval: 0.15)
        }

        let mine = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", body)).firstMatch
        XCTAssertTrue(mine.waitForExistence(timeout: 30), "the sent message never appeared")
        XCTAssertTrue(anchor(app).exists, "the transcript didn't survive the send")
    }
}

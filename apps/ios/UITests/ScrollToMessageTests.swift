import XCTest

/// #332 — the acceptance criteria for iOS scroll-to-message, written down.
///
/// Rows carry `.id(message.clientMsgId)` since #312, but every `proxy.scrollTo`
/// still passed `message.id`: a target that matches no row, so the scroll
/// silently did nothing. These three journeys are the ones a person notices —
/// a reply that lands off screen, and a jump that goes nowhere — in the
/// channel transcript and in the thread screen.
///
/// Needs `qa-seed.mjs` then `qa-seed-scroll332.mjs` (channel `scroll332`;
/// override with `FLOW_TEST_SCROLL332_CHANNEL`). Attaches the PR screenshots.
final class ScrollToMessageTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var channelName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SCROLL332_CHANNEL"] ?? "scroll332"
    }

    private func launch(_ extra: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channelName,
        ].merging(extra) { _, new in new }
        app.launch()
        return app
    }

    /// The composer, by screen: the thread's carries its own identifiers
    /// (`thread.composer.*`) so the two can never be confused for one another.
    private func composer(_ app: XCUIApplication, inThread: Bool) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(identifier: inThread ? "thread.composer.input" : "composer.input").firstMatch
    }

    private func sendButton(_ app: XCUIApplication, inThread: Bool) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(identifier: inThread ? "thread.composer.send" : "composer.send").firstMatch
    }

    private func waitForChannel(_ app: XCUIApplication) {
        let first = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 90),
                      "never reached #\(channelName) — did qa-seed-scroll332.mjs run against \(serverURL)?")
    }

    /// Back out of a thread the channel re-pushed on entry (#89's parked
    /// thread), so a test that is about the transcript starts on it.
    private func popThreadIfPushed(_ app: XCUIApplication) {
        let bar = app.navigationBars["Thread"]
        guard bar.waitForExistence(timeout: 3) else { return }
        bar.buttons.firstMatch.tap()
        _ = app.descendants(matching: .any)
            .matching(identifier: "composer.input").firstMatch.waitForExistence(timeout: 10)
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func text(containing needle: String, in app: XCUIApplication) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", needle)).firstMatch
    }

    /// On screen means *visible*, not merely present: a `scrollTo` that no-ops
    /// still leaves the row in the tree once the LazyVStack has materialised
    /// it, which is exactly how this bug hid. A hittable frame inside the
    /// window is the assertion that discriminates.
    private func assertOnScreen(_ element: XCUIElement, _ app: XCUIApplication, _ what: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 20), "\(what): never rendered at all")
        XCTAssertTrue(element.isHittable, "\(what): in the list but not on screen — the scroll went nowhere")
        XCTAssertTrue(app.windows.firstMatch.frame.contains(element.frame.origin),
                      "\(what): row frame \(element.frame) is outside the window")
    }

    /// Acceptance 1: sending a reply in a thread scrolls to it.
    func testReplyInThreadScrollsToTheNewMessage() {
        let app = launch(["FLOW_DEBUG_OPEN_THREAD_LAST": "1"])
        waitForChannel(app)
        XCTAssertTrue(app.navigationBars["Thread"].waitForExistence(timeout: 30), "thread never pushed")
        // The thread opens at its newest reply; the last filler proves it.
        _ = text(containing: "thread filler reply 120 of 120", in: app).waitForExistence(timeout: 30)
        attach("1a-thread-open-at-newest-reply")

        let body = "reply-332 \(UUID().uuidString.prefix(8))"
        let input = composer(app, inThread: true)
        XCTAssertTrue(input.waitForExistence(timeout: 15), "no thread composer")
        input.tap()
        input.typeText(body)
        sendButton(app, inThread: true).tap()

        assertOnScreen(text(containing: body, in: app), app, "my new thread reply")
        attach("1b-thread-scrolled-to-my-reply")
    }

    /// Acceptance 2a: a jump from the Activity feed lands on the message in
    /// the channel transcript, 60 messages back.
    func testActivityJumpLandsOnTheMessageInTheChannel() {
        // Land in the channel first, then walk to Activity through the drawer.
        // Going straight there with FLOW_DEBUG_SHOW_ACTIVITY races the first
        // sign-in: the feed fetches once before there is a session and renders
        // "No activity yet", which is a fixture-shaped failure with no fixture
        // problem behind it.
        let app = launch()
        waitForChannel(app)
        // A thread parked open from an earlier session is re-pushed when the
        // channel opens (#89), and an Activity jump to a *channel* message then
        // lands behind it — pre-existing, unrelated to row identity, and not
        // what this test is about. Start from the transcript.
        popThreadIfPushed(app)
        app.buttons["nav.menu"].tap()
        let activity = app.descendants(matching: .any).matching(identifier: "sidebar.activity").firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 15), "drawer never opened / no Activity row")
        activity.tap()

        let item = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'activity.item.'")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 30), "no Activity rows — was the @mention seeded?")
        attach("2a-activity-feed")
        item.tap()

        assertOnScreen(text(containing: "CHANNEL JUMP TARGET", in: app), app, "the channel jump target")
        attach("2b-channel-jumped-to-target")
    }

    /// Acceptance 2b: the same jump inside the thread screen. The Activity feed
    /// deliberately doesn't focus a thread reply on iOS, so the pins sheet is
    /// the path here — it pushes the thread and sets the same `focusMessageId`.
    func testPinnedReplyJumpLandsInTheThreadScreen() {
        let app = launch()
        waitForChannel(app)
        app.buttons["channel.menu"].tap()
        let pins = app.buttons["channel.pins"]
        XCTAssertTrue(pins.waitForExistence(timeout: 15), "no Pins item in the channel menu")
        pins.tap()

        let pinned = text(containing: "THREAD JUMP TARGET", in: app)
        XCTAssertTrue(pinned.waitForExistence(timeout: 20), "the pinned reply isn't in the pins sheet")
        attach("3a-pins-sheet")
        pinned.tap()

        XCTAssertTrue(app.navigationBars["Thread"].waitForExistence(timeout: 20), "the pin didn't push the thread")
        _ = composer(app, inThread: true).waitForExistence(timeout: 20)
        attach("3b-thread-pushed")
        assertOnScreen(text(containing: "THREAD JUMP TARGET", in: app), app, "the thread jump target")
        attach("3b-thread-jumped-to-pinned-reply")
    }

    // MARK: - #494: which replies may move the reader

    /// Acceptance 3: several replies in a row, each brought into view. The
    /// scroll is issued before the new row has a height, so the one that
    /// matters is the *settle* behind it — and the settle is keyed on the row
    /// identity, so the server echo replacing the optimistic row must not
    /// spend a second jump on the same reply.
    func testSeveralRepliesInARowEachLandInView() {
        let app = launch(["FLOW_DEBUG_OPEN_THREAD_LAST": "1"])
        waitForChannel(app)
        XCTAssertTrue(app.navigationBars["Thread"].waitForExistence(timeout: 30), "thread never pushed")
        _ = text(containing: "thread filler reply 120 of 120", in: app).waitForExistence(timeout: 30)

        let run = UUID().uuidString.prefix(6)
        for i in 1...3 {
            let body = "burst-494-\(run)-\(i)"
            let input = composer(app, inThread: true)
            XCTAssertTrue(input.waitForExistence(timeout: 15), "no thread composer before reply \(i)")
            input.tap()
            input.typeText(body)
            sendButton(app, inThread: true).tap()
            assertOnScreen(text(containing: body, in: app), app, "reply \(i) of 3")
            // Let the echo swap and the settle passes finish before the next
            // send, so a double-jump would have somewhere to show itself.
            sleep(1)
            XCTAssertTrue(text(containing: body, in: app).isHittable,
                          "reply \(i) drifted off screen after its server echo landed")
        }
        attach("4-three-replies-each-in-view")
    }

    /// Acceptance 4: a reply from someone else must not drag a back-scrolled
    /// reader down. This screen used to scroll on *every* new last message,
    /// own or not; it now asks the shared follow model, which re-pins only for
    /// my own send (#111/#334).
    ///
    /// Bob plays over REST — there is no other way to produce a reply the
    /// reader did not send.
    func testAnotherUsersReplyDoesNotForceScrollTheReader() throws {
        let app = launch(["FLOW_DEBUG_OPEN_THREAD_LAST": "1"])
        waitForChannel(app)
        XCTAssertTrue(app.navigationBars["Thread"].waitForExistence(timeout: 30), "thread never pushed")
        _ = text(containing: "thread filler reply 120 of 120", in: app).waitForExistence(timeout: 30)
        sleep(2) // let the opening landing and its settle passes finish

        // Pull back through the thread's history, past the 200pt unpin
        // threshold: this reader has decided to leave the end.
        for _ in 0..<3 {
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
        sleep(1)
        attach("5a-reader-scrolled-back")

        // An anchor the assertion can measure: whatever filler is on screen now.
        let anchor = app.staticTexts
            .containing(NSPredicate(format: "label CONTAINS %@", "thread filler reply")).firstMatch
        XCTAssertTrue(anchor.exists, "no filler row on screen to anchor the assertion to")
        let anchorLabel = anchor.label
        let before = anchor.frame

        let body = "bob-494-\(UUID().uuidString.prefix(8))"
        try bobRepliesInTheThread(body)

        // Generous: the old unconditional follow fired the moment the row
        // arrived, and the settle passes run out to 600ms behind it.
        sleep(4)
        attach("5b-after-bobs-reply")
        let after = app.staticTexts[anchorLabel]
        XCTAssertTrue(after.exists, "the anchor row left the tree — the list scrolled far enough to recycle it")
        XCTAssertEqual(after.frame.minY, before.minY, accuracy: 4,
                       "Bob's reply force-scrolled the reader: \(anchorLabel) moved from \(before.minY) to \(after.frame.minY)")

        // …and it really did arrive: returning to the end finds it. Without
        // this the test would pass just as well against a broken sync.
        for _ in 0..<6 { app.swipeUp() }
        assertOnScreen(text(containing: body, in: app), app, "Bob's reply, once the reader scrolls back down")
        attach("5c-bobs-reply-found-at-the-end")
    }

    // MARK: - REST (playing Bob)

    private func bobRepliesInTheThread(_ body: String) throws {
        let login = try post("/v1/auth/login", token: nil,
                             body: ["email": "bob@qa.local", "password": "qa-password-1"])
        let token = try XCTUnwrap(login["token"] as? String, "no token for bob — is the server seeded?")

        let workspaces = try get("/v1/me/workspaces", token: token)
        let list = (workspaces["workspaces"] as? [[String: Any]]) ?? []
        let ws = try XCTUnwrap(list.first { $0["slug"] as? String == "qa-lab" }, "no qa-lab workspace")
        let wsId = try XCTUnwrap(ws["id"] as? String)

        let channels = try get("/v1/workspaces/\(wsId)/channels", token: token)
        let rows = (channels["channels"] as? [[String: Any]]) ?? []
        let channel = try XCTUnwrap(rows.first { $0["name"] as? String == channelName },
                                    "no #\(channelName) — did qa-seed-scroll332.mjs run?")
        let channelId = try XCTUnwrap(channel["id"] as? String)

        let messages = try get("/v1/channels/\(channelId)/messages?limit=200", token: token)
        let all = (messages["messages"] as? [[String: Any]]) ?? []
        let root = try XCTUnwrap(
            all.first { ($0["body"] as? String)?.hasPrefix("THREAD ROOT") == true }?["id"] as? String,
            "no thread root in #\(channelName)"
        )
        _ = try post("/v1/channels/\(channelId)/messages", token: token,
                     body: ["clientMsgId": UUID().uuidString, "body": body, "threadRootId": root])
    }

    private func post(_ path: String, token: String?, body: [String: Any]) throws -> [String: Any] {
        var req = URLRequest(url: URL(string: serverURL + path)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try send(req, path)
    }

    private func get(_ path: String, token: String) throws -> [String: Any] {
        var req = URLRequest(url: URL(string: serverURL + path)!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        return try send(req, path)
    }

    private func send(_ req: URLRequest, _ path: String) throws -> [String: Any] {
        var result: [String: Any] = [:]
        var failure: String?
        let done = expectation(description: path)
        URLSession.shared.dataTask(with: req) { data, response, error in
            defer { done.fulfill() }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard error == nil, (200..<300).contains(code), let data else {
                failure = "\(req.httpMethod ?? "GET") \(path) -> \(code) \(error?.localizedDescription ?? "")"
                return
            }
            result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        }.resume()
        wait(for: [done], timeout: 30)
        if let failure { XCTFail(failure); throw XCTSkip(failure) }
        return result
    }
}

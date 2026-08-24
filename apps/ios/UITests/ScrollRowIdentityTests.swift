import XCTest

/// #332 — every `scrollTo` on iOS now names the row identity (`clientMsgId`),
/// not the message id. Rows have carried `.id(message.clientMsgId)` since #312,
/// so a scroll aimed at a message id matched no row and silently did nothing.
///
/// Three acceptance behaviours, each of them a scroll that used to go nowhere,
/// plus the #334 arrival settle ported alongside:
///   1. A reply you send in a thread scrolls into view.
///   2. Jumping to a message in the channel transcript lands on it.
///   3. Jumping to a message in a thread lands on it.
///   4. A message arriving while you sit at the bottom lands in view (#334).
///
/// Needs a dev server seeded with `qa-seed.mjs` then
/// `node packages/server/scripts/qa-seed-scroll332.mjs` — channels `jump332`
/// (60 messages, "Message 20 of 60" pinned) and `thread332` (a root with 30
/// replies, "Reply 3 of 30" pinned). Override with `FLOW_TEST_JUMP_CHANNEL` /
/// `FLOW_TEST_THREAD332_CHANNEL`.
///
/// Note the assertions are on `isHittable`, not `exists`: the channel
/// transcript renders eagerly below 100 messages, so an off-screen row is in
/// the accessibility tree either way. "Is it actually on screen" is the
/// question, and it is the one that discriminates the fix from the bug.
final class ScrollRowIdentityTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var jumpChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_JUMP_CHANNEL"] ?? "jump332"
    }

    private var threadChannel: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_THREAD332_CHANNEL"] ?? "thread332"
    }

    private func launch(channel: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": channel,
        ]
        app.launch()
        // A thread left open by an earlier test is *parked*, not closed (#89),
        // so the app can come up on the thread screen rather than the channel.
        // Land on the channel either way.
        let composer = app.descendants(matching: .any).matching(identifier: "composer.input").firstMatch
        let threadBar = app.navigationBars["Thread"]
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline, !composer.exists {
            if threadBar.exists { threadBar.buttons.firstMatch.tap() } // Back
            _ = composer.waitForExistence(timeout: 1)
        }
        XCTAssertTrue(composer.exists, "never reached #\(channel) — is the dev server seeded?")
        return app
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func text(_ app: XCUIApplication, _ body: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", body)).firstMatch
    }

    /// Waits for a row to be genuinely on screen. `exists` is not enough (see
    /// the note above), and a scroll animation needs a moment to finish.
    private func waitUntilHittable(_ element: XCUIElement, timeout: TimeInterval = 15) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists && element.isHittable { return true }
            _ = element.waitForExistence(timeout: 0.5)
        }
        return false
    }

    private func jumpPill(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "msg.jumpToLatest").firstMatch
    }

    /// Opens the pins sheet and taps the pin whose body contains `body`.
    /// Pins live behind the header's "⋯" menu since #188, so that opens first.
    private func tapPin(_ app: XCUIApplication, containing body: String) {
        app.buttons["channel.menu"].tap()
        let pins = app.buttons["channel.pins"]
        XCTAssertTrue(pins.waitForExistence(timeout: 10), "no Pinned Messages item in the channel menu")
        pins.tap()
        let row = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", body)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "no pinned row for \"\(body)\"")
        row.tap()
    }

    // MARK: - 1. A reply you send in a thread scrolls into view

    func testReplyInThreadScrollsToIt() {
        let app = launch(channel: threadChannel)

        app.descendants(matching: .any).matching(identifier: "msg.openThread").firstMatch.tap()
        let composer = app.descendants(matching: .any)
            .matching(identifier: "thread.composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 20), "the thread never opened")
        XCTAssertTrue(waitUntilHittable(text(app, "Reply 30 of 30")),
                      "the thread didn't open on its newest reply")

        let body = "reply-332 \(UUID().uuidString.prefix(8))"
        composer.tap()
        composer.typeText(body)
        app.descendants(matching: .any).matching(identifier: "thread.composer.send").firstMatch.tap()

        XCTAssertTrue(waitUntilHittable(text(app, body)),
                      "sent a reply and the thread didn't scroll to it")
        attach("1-reply-in-thread-scrolls-to-it")
    }

    // MARK: - 2. Jump-to-message in the channel transcript

    func testJumpToMessageInChannel() {
        let app = launch(channel: jumpChannel)

        let target = text(app, "Message 20 of 60")
        XCTAssertTrue(waitUntilHittable(text(app, "Message 60 of 60")),
                      "the channel didn't open on its newest message")
        XCTAssertFalse(target.isHittable,
                       "precondition: the jump target must start off screen")
        attach("2a-channel-before-jump")

        tapPin(app, containing: "Message 20 of 60")

        XCTAssertTrue(waitUntilHittable(target),
                      "jumped to a message in the channel and the list never moved to it")
        attach("2b-channel-after-jump")
    }

    // MARK: - 3. Jump-to-message in the thread screen

    func testJumpToMessageInThread() {
        let app = launch(channel: threadChannel)

        tapPin(app, containing: "Reply 3 of 30")

        let composer = app.descendants(matching: .any)
            .matching(identifier: "thread.composer.input").firstMatch
        XCTAssertTrue(composer.waitForExistence(timeout: 20),
                      "tapping a pinned reply didn't open the thread")
        let landed = waitUntilHittable(text(app, "Reply 3 of 30"))
        attach("3-thread-after-jump")
        XCTAssertTrue(landed, "jumped to a reply and the thread never moved to it")
    }

    // MARK: - 4. #334: a message arriving while you're at the bottom lands in view

    func testIncomingMessageLandsInView() throws {
        let app = launch(channel: jumpChannel)
        XCTAssertTrue(waitUntilHittable(text(app, "Message 60 of 60")),
                      "the channel didn't open on its newest message")

        let body = "arrival-332 \(UUID().uuidString.prefix(8))"
        try bobPosts(body, inChannelNamed: jumpChannel)

        XCTAssertTrue(waitUntilHittable(text(app, body), timeout: 30),
                      "a message arrived while sitting at the bottom and was left below the fold")
        XCTAssertFalse(jumpPill(app).exists,
                       "still at the bottom, so nothing should be offering the way back")
        attach("4-incoming-message-lands-in-view")
    }

    // MARK: - The other side of the conversation (REST, as Bob)

    /// Posts as Bob so the message arrives over the socket into a running app —
    /// the only way to stage an *incoming* message, which is what #334 is about.
    private func bobPosts(_ body: String, inChannelNamed name: String) throws {
        let login = try post("/v1/auth/login", token: nil,
                             body: ["email": "bob@qa.local", "password": "qa-password-1"])
        let token = try XCTUnwrap(login["token"] as? String, "no token for bob — is the server seeded?")

        let workspaces = try get("/v1/me/workspaces", token: token)
        let list = (workspaces["workspaces"] as? [[String: Any]]) ?? []
        let ws = try XCTUnwrap(list.first { $0["slug"] as? String == "qa-lab" }, "no qa-lab workspace")
        let wsId = try XCTUnwrap(ws["id"] as? String)

        let channels = try get("/v1/workspaces/\(wsId)/channels", token: token)
        let rows = (channels["channels"] as? [[String: Any]]) ?? []
        let channel = try XCTUnwrap(rows.first { $0["name"] as? String == name }, "no #\(name)")
        let channelId = try XCTUnwrap(channel["id"] as? String)

        _ = try post("/v1/channels/\(channelId)/messages", token: token,
                     body: ["body": body, "clientMsgId": UUID().uuidString])
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

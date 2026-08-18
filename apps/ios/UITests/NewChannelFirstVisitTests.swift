import XCTest

/// #269 — a channel that appears while the app is running (an agent creates it,
/// invites you, then posts) must show its transcript the *first* time you open
/// it, not on the second visit after a switch away and back.
///
/// The fixture is made by the test itself rather than a seed script: the bug is
/// about a channel arriving over the socket *into a running app*, so it cannot
/// be staged before launch. Bob plays the agent over REST — the server can't
/// tell him from any other client.
///
/// Needs a dev server seeded with `qa-seed.mjs` (Alice and Bob in QA Lab).
final class NewChannelFirstVisitTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private var serverURL: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_SERVER_URL"] ?? "http://127.0.0.1:8787"
    }

    private var env: [String: String] {
        let e = ProcessInfo.processInfo.environment
        return [
            "FLOW_SERVER_URL": serverURL,
            "FLOW_DEBUG_EMAIL": e["FLOW_TEST_EMAIL"] ?? "alice@qa.local",
            "FLOW_DEBUG_PASSWORD": e["FLOW_TEST_PASSWORD"] ?? "qa-password-1",
            "FLOW_DEBUG_OPEN_CHANNEL": e["FLOW_TEST_CHANNEL"] ?? "general",
        ]
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

    // MARK: - The agent side (REST, as Bob)

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
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
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

    /// Create a channel as Bob, add Alice, and post `messages` into it —
    /// exactly the sequence an agent performs, and all of it after the app
    /// under test is already running.
    private func agentCreatesChannel(named name: String, saying messages: [String]) throws {
        let login = try post("/v1/auth/login", token: nil,
                             body: ["email": "bob@qa.local", "password": "qa-password-1"])
        let token = try XCTUnwrap(login["token"] as? String, "no token for bob — is the server seeded?")

        let workspaces = try get("/v1/me/workspaces", token: token)
        let list = (workspaces["workspaces"] as? [[String: Any]]) ?? []
        let ws = try XCTUnwrap(list.first { $0["slug"] as? String == "qa-lab" }, "no qa-lab workspace")
        let wsId = try XCTUnwrap(ws["id"] as? String)

        let channel = try post("/v1/workspaces/\(wsId)/channels", token: token,
                               body: ["name": name, "topic": "agent-created", "isPrivate": false])
        let channelId = try XCTUnwrap(channel["id"] as? String)

        let members = try get("/v1/workspaces/\(wsId)/members", token: token)
        let rows = (members["members"] as? [[String: Any]]) ?? []
        let alice = try XCTUnwrap(
            rows.first { ($0["email"] as? String) == "alice@qa.local" }?["userId"] as? String,
            "alice is not a member of qa-lab"
        )
        _ = try post("/v1/channels/\(channelId)/members", token: token, body: ["userId": alice])

        for text in messages {
            _ = try post("/v1/channels/\(channelId)/messages", token: token,
                         body: ["body": text, "clientMsgId": UUID().uuidString.lowercased()])
        }
    }

    /// Open the channel drawer. The first tap after the app comes back from the
    /// background can land before it is fully resumed and be swallowed, so
    /// confirm the backdrop and try once more.
    private func openDrawer(_ app: XCUIApplication) {
        let backdrop = app.otherElements["nav.drawerBackdrop"]
        for _ in 0..<3 {
            app.buttons["nav.menu"].tap()
            if backdrop.waitForExistence(timeout: 5) { return }
        }
        XCTFail("the channel drawer never opened")
    }

    /// The drawer's row for `name`, scrolled into view. QA Lab accumulates
    /// channels across runs and the sidebar is lazy, so an off-screen row does
    /// not merely fail to be hittable — it does not exist to query until it has
    /// been scrolled to (same trap `NewDmTests` documents).
    private func channelRow(_ name: String, in app: XCUIApplication) -> XCUIElement {
        let row = app.buttons["sidebar.channel.\(name)"]
        _ = row.waitForExistence(timeout: 20) // give the arrival a chance first
        var scrolls = 0
        while !(row.exists && row.isHittable) && scrolls < 15 {
            app.swipeUp()
            scrolls += 1
        }
        return row
    }

    // MARK: - The test

    func testFirstVisitShowsMessagesPostedBeforeArrival() throws {
        let app = launch()
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 60), "never signed in — is the dev server up and seeded?")

        // Unique per run: the channel must be one this app has never opened.
        let name = "new269\(Int(Date().timeIntervalSince1970) % 1_000_000)"
        let greeting = "first visit \(name)"
        try agentCreatesChannel(named: name, saying: [greeting, "second line", "third line"])

        openDrawer(app)
        let row = channelRow(name, in: app)
        XCTAssertTrue(row.exists, "the new channel never reached the sidebar")
        row.tap()

        // First visit: the transcript must be here, without a switch away and back.
        let message = app.staticTexts[greeting]
        let appeared = message.waitForExistence(timeout: 20)
        attach("first-visit")
        XCTAssertTrue(appeared, "#269: the first visit to a newly created channel showed no messages")
        XCTAssertFalse(
            app.staticTexts["No messages yet"].exists,
            "#269: the transcript claimed the channel was empty"
        )
    }

    /// Variant: the channel is created while the app is in the background, so
    /// the socket is down and nothing about it reaches the client live.
    func testFirstVisitAfterBackgroundedCreation() throws {
        let app = launch()
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 60), "never signed in — is the dev server up and seeded?")

        XCUIDevice.shared.press(.home)
        let name = "bg269\(Int(Date().timeIntervalSince1970) % 1_000_000)"
        let greeting = "backgrounded \(name)"
        try agentCreatesChannel(named: name, saying: [greeting, "second line"])
        // Long enough to count as a real absence — the resume re-sync ignores a
        // flick to another app and straight back (`AppState.resumeResyncAfter`).
        Thread.sleep(forTimeInterval: 12)
        app.activate()
        openDrawer(app)
        let row = channelRow(name, in: app)
        attach("sidebar-after-resume")
        XCTAssertTrue(row.exists, "the new channel never reached the sidebar")
        row.tap()

        let appeared = app.staticTexts[greeting].waitForExistence(timeout: 20)
        attach("first-visit-backgrounded")
        XCTAssertTrue(appeared, "#269: first visit after a backgrounded creation showed no messages")
    }

    /// Variant: the channel is created while the app is not running at all, so
    /// it arrives in the cold-launch channel snapshot.
    func testFirstVisitAfterColdLaunch() throws {
        let name = "cold269\(Int(Date().timeIntervalSince1970) % 1_000_000)"
        let greeting = "cold launch \(name)"
        try agentCreatesChannel(named: name, saying: [greeting, "second line"])

        let app = launch()
        let menu = app.buttons["nav.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 60), "never signed in — is the dev server up and seeded?")
        openDrawer(app)
        let row = channelRow(name, in: app)
        XCTAssertTrue(row.exists, "the new channel never reached the sidebar")
        row.tap()

        let appeared = app.staticTexts[greeting].waitForExistence(timeout: 20)
        attach("first-visit-cold")
        XCTAssertTrue(appeared, "#269: first visit after a cold launch showed no messages")
    }
}

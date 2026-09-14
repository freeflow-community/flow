import XCTest

/// Inviting someone into a channel from iOS. Until now the phone could only
/// get *you* into a public channel (Browse → Join); adding anyone else meant
/// opening web or macOS. The sheet lists workspace members who are not in the
/// channel yet, each with an Add button.
///
/// Needs a dev server seeded with `qa-seed.mjs` (Alice + Bob in QA Lab).
/// The test creates a fresh channel as Alice over REST so Bob is guaranteed to
/// be addable, then drives the app as Alice. Override the server with
/// `FLOW_TEST_SERVER_URL` when 8787 is taken.
final class InviteToChannelTests: XCTestCase {
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

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    // MARK: - REST (as Alice)

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

    /// A brand-new public channel with only Alice in it, plus Bob's user id
    /// (the one person the sheet must offer).
    private func freshChannel() throws -> (name: String, channelId: String, bobId: String) {
        let login = try post("/v1/auth/login", token: nil,
                             body: ["email": "alice@qa.local", "password": "qa-password-1"])
        let token = try XCTUnwrap(login["token"] as? String, "no token for alice — is the server seeded?")

        let workspaces = try get("/v1/me/workspaces", token: token)
        let list = (workspaces["workspaces"] as? [[String: Any]]) ?? []
        let ws = try XCTUnwrap(list.first { $0["slug"] as? String == "qa-lab" }, "no qa-lab workspace")
        let wsId = try XCTUnwrap(ws["id"] as? String)

        let name = "inv-" + String(UUID().uuidString.lowercased().prefix(8))
        let channel = try post("/v1/workspaces/\(wsId)/channels", token: token,
                               body: ["name": name, "topic": "invite test", "isPrivate": false])
        let channelId = try XCTUnwrap(channel["id"] as? String)

        let members = try get("/v1/workspaces/\(wsId)/members", token: token)
        let rows = (members["members"] as? [[String: Any]]) ?? []
        let bob = try XCTUnwrap(
            rows.first { ($0["email"] as? String) == "bob@qa.local" }?["userId"] as? String,
            "bob is not a member of qa-lab"
        )
        return (name, channelId, bob)
    }

    private func memberIds(of channelId: String) throws -> [String] {
        let login = try post("/v1/auth/login", token: nil,
                             body: ["email": "alice@qa.local", "password": "qa-password-1"])
        let token = try XCTUnwrap(login["token"] as? String)
        let resp = try get("/v1/channels/\(channelId)/members", token: token)
        return (resp["userIds"] as? [String]) ?? []
    }

    // MARK: - Tests

    /// Acceptance: the ⋯ menu offers Invite to Channel…, the sheet lists Bob
    /// with an Add button, tapping it adds him (server-verified) and the row
    /// flips to a checkmark.
    func testMenuOpensSheetAndAddTapAddsBob() throws {
        let fixture = try freshChannel()
        let app = launch(inChannel: fixture.name)

        app.buttons["channel.menu"].tap()
        let invite = app.buttons["channel.invite"]
        XCTAssertTrue(invite.waitForExistence(timeout: 10), "no Invite to Channel item in the ⋯ menu")
        invite.tap()

        let add = app.buttons["inviteChannel.add.\(fixture.bobId)"]
        XCTAssertTrue(add.waitForExistence(timeout: 20), "the sheet didn't list Bob with an Add button")
        attach("01-invite-to-channel-sheet")

        add.tap()
        let added = app.images["inviteChannel.added.\(fixture.bobId)"]
        XCTAssertTrue(added.waitForExistence(timeout: 20), "Add never flipped to the checkmark")
        XCTAssertFalse(app.staticTexts["inviteChannel.error"].exists, "the sheet showed an error")
        attach("02-bob-added")

        XCTAssertTrue(try memberIds(of: fixture.channelId).contains(fixture.bobId),
                      "the server does not list Bob as a channel member")
    }

    /// Acceptance: people already in the channel are not offered. After Bob is
    /// in, re-opening the sheet on a two-person workspace shows "Everyone is
    /// here." (Scott is also seeded, so the list may still have him — the
    /// assertion is only that Bob's Add button is gone.)
    func testAlreadyMembersAreNotOffered() throws {
        let fixture = try freshChannel()
        let login = try post("/v1/auth/login", token: nil,
                             body: ["email": "alice@qa.local", "password": "qa-password-1"])
        let token = try XCTUnwrap(login["token"] as? String)
        _ = try post("/v1/channels/\(fixture.channelId)/members", token: token, body: ["userId": fixture.bobId])

        let app = launch(inChannel: fixture.name)
        app.buttons["channel.menu"].tap()
        let invite = app.buttons["channel.invite"]
        XCTAssertTrue(invite.waitForExistence(timeout: 10))
        invite.tap()
        XCTAssertTrue(app.buttons["inviteChannel.done"].waitForExistence(timeout: 20), "the sheet didn't open")

        // Give the member fetch time to land, then check Bob is not addable.
        let bobAdd = app.buttons["inviteChannel.add.\(fixture.bobId)"]
        let gone = NSPredicate(format: "exists == false")
        let settled = XCTNSPredicateExpectation(predicate: gone, object: bobAdd)
        XCTAssertEqual(XCTWaiter().wait(for: [settled], timeout: 20), .completed,
                       "Bob is already in the channel but the sheet still offers him")
        attach("03-bob-not-offered")
    }
}

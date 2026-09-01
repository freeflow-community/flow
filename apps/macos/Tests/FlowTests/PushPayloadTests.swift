import XCTest

@testable import Flow

// APNs payload contract + the foreground-banner rule (#249). Pure logic, so it
// runs in both suites — the iOS unit-test target compiles this same file
// (apps/ios/project.yml), which is what stops the rule the phone depends on
// from rotting when someone edits it on the Mac.
final class PushPayloadTests: XCTestCase {
    private func alertUserInfo(
        channelId: String = "c1",
        threadRootId: String? = nil,
        badge: Int? = 7
    ) -> [AnyHashable: Any] {
        var aps: [AnyHashable: Any] = ["alert": ["title": "Alice", "body": "standup?"], "sound": "default"]
        if let badge { aps["badge"] = badge }
        var info: [AnyHashable: Any] = [
            "aps": aps,
            "workspaceId": "w1",
            "channelId": channelId,
            "messageId": "m1",
            "notificationId": "n1",
        ]
        if let threadRootId { info["threadRootId"] = threadRootId }
        return info
    }

    // MARK: - Parsing

    func testParsesTheServersAlertKeys() throws {
        let p = try XCTUnwrap(PushPayload(userInfo: alertUserInfo(threadRootId: "r1")))
        XCTAssertEqual(p.workspaceId, "w1")
        XCTAssertEqual(p.channelId, "c1")
        XCTAssertEqual(p.messageId, "m1")
        XCTAssertEqual(p.threadRootId, "r1")
        XCTAssertEqual(p.notificationId, "n1")
    }

    func testTopLevelPushHasNoThreadRoot() throws {
        let p = try XCTUnwrap(PushPayload(userInfo: alertUserInfo()))
        XCTAssertNil(p.threadRootId)
    }

    /// A badge-sync push carries no routing keys — nothing to navigate to.
    func testBadgeSyncPushIsNotRoutable() {
        let silent: [AnyHashable: Any] = ["aps": ["badge": 3, "content-available": 1]]
        XCTAssertNil(PushPayload(userInfo: silent))
        XCTAssertEqual(PushPayload.badge(from: silent), 3)
    }

    func testAlertPushCarriesTheBadgeToo() {
        XCTAssertEqual(PushPayload.badge(from: alertUserInfo(badge: 12)), 12)
        XCTAssertNil(PushPayload.badge(from: alertUserInfo(badge: nil)))
        XCTAssertNil(PushPayload.badge(from: ["workspaceId": "w1"]))
    }

    func testIncompletePayloadDoesNotParse() {
        XCTAssertNil(PushPayload(userInfo: ["workspaceId": "w1", "channelId": "c1"]))
    }

    // MARK: - Malformed payloads (#458)
    //
    // A tap has already brought the app to the front by the time these are
    // read, so the only question is whether anything navigates. Nil is the
    // answer that leaves it at home rather than on a screen for an id that
    // cannot resolve.

    func testEmptyRoutingIdDoesNotParse() {
        for key in ["workspaceId", "channelId", "messageId"] {
            var info = alertUserInfo()
            info[key] = ""
            XCTAssertNil(PushPayload(userInfo: info), "empty \(key) must not route")
        }
    }

    func testRoutingIdOfTheWrongTypeDoesNotParse() {
        var info = alertUserInfo()
        info["channelId"] = 42
        XCTAssertNil(PushPayload(userInfo: info))
    }

    func testPayloadWithNoRoutingKeysAtAllDoesNotParse() {
        XCTAssertNil(PushPayload(userInfo: ["aps": ["alert": ["title": "hi"]]]))
        XCTAssertNil(PushPayload(userInfo: [:]))
    }

    /// Empty optional keys collapse to nil rather than through: an empty
    /// `threadRootId` would read as "open a thread", and an empty
    /// `notificationId` would send a mark-read for no row.
    func testEmptyOptionalKeysReadAsAbsent() throws {
        var info = alertUserInfo()
        info["threadRootId"] = ""
        info["notificationId"] = ""
        let p = try XCTUnwrap(PushPayload(userInfo: info))
        XCTAssertNil(p.threadRootId)
        XCTAssertNil(p.notificationId)
    }

    /// The routable payload is unchanged by all of the above — the hardening
    /// must not narrow what the server actually sends.
    func testServerShapedPayloadStillParses() throws {
        let p = try XCTUnwrap(PushPayload(userInfo: alertUserInfo(threadRootId: "r1")))
        XCTAssertEqual(p.channelId, "c1")
        XCTAssertEqual(p.threadRootId, "r1")
    }

    // MARK: - The foreground rule

    private func present(
        channelId: String = "c1",
        threadRootId: String? = nil,
        appActive: Bool = true,
        visible: String?,
        openThread: String? = nil
    ) throws -> Bool {
        let p = try XCTUnwrap(PushPayload(userInfo: alertUserInfo(channelId: channelId, threadRootId: threadRootId)))
        return PushPayload.shouldPresentBanner(
            payload: p, appActive: appActive, visibleChannelId: visible, openThreadRootId: openThread
        )
    }

    func testSuppressedForTheChannelOnScreen() throws {
        XCTAssertFalse(try present(visible: "c1"))
    }

    func testBanneredForAnotherChannel() throws {
        XCTAssertTrue(try present(visible: "c2"))
        XCTAssertTrue(try present(visible: nil))
    }

    /// The phone's thread screen covers the transcript, so the channel
    /// underneath is not "on screen" — unlike the Mac's side panel.
    func testBanneredWhenAThreadCoversTheChannel() throws {
        XCTAssertTrue(try present(visible: "c1", openThread: "r9"))
    }

    func testSuppressedForTheOpenThreadsOwnReply() throws {
        XCTAssertFalse(try present(threadRootId: "r9", visible: "c1", openThread: "r9"))
    }

    func testBanneredForAReplyInAnUnopenedThread() throws {
        XCTAssertTrue(try present(threadRootId: "r9", visible: "c1"))
        XCTAssertTrue(try present(threadRootId: "r9", visible: "c1", openThread: "r8"))
    }

    /// Backgrounded is not "seen" — the same rule the read path already uses.
    func testBanneredWhenTheAppIsNotActive() throws {
        XCTAssertTrue(try present(appActive: false, visible: "c1"))
    }

    // MARK: - When a tap may be routed (#458, iOS)

    #if os(iOS)
    /// A tap that lands before the session resolves must be *held*, not
    /// applied: `AppState.setPhase(.signedOut)` — which every cold bootstrap
    /// passes through — calls `clearForSignOut()`, so a route applied any
    /// earlier is silently erased and the tap opens "Select a channel".
    func testTapIsOnlyRoutedOnceSignedIn() throws {
        XCTAssertFalse(PushDelegate.canRoute(phase: .loading))
        XCTAssertFalse(PushDelegate.canRoute(phase: .signedOut))
        let user = try JSONDecoder().decode(
            User.self,
            from: Data(#"{"id":"u1","email":"a@qa.local","displayName":"A"}"#.utf8)
        )
        XCTAssertTrue(PushDelegate.canRoute(phase: .signedIn(user)))
    }
    #endif
}

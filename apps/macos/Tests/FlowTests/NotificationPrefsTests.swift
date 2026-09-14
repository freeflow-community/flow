import UserNotifications
import XCTest

@testable import Flow

// Notification prefs on macOS (#464). Two things worth pinning down here.
//
// The prefs themselves are three-state — absent, true, false — and every
// toggle in `MyProfileSheet` reads them as "absent means on". A round trip
// through `Codable` has to keep the absent case absent, because a PATCH that
// spelled out every key would clobber whatever another client set a second
// earlier.
//
// And the sound branch, which has no observable to assert against anywhere
// else: a silenced banner is pixel-identical to a noisy one, so the only way
// to catch a regression is to check the content the app hands the OS.
final class NotificationPrefsTests: XCTestCase {
    // MARK: - Absent means on

    func testAbsentPrefsReadAsOn() {
        let prefs = NotificationPrefs()
        XCTAssertTrue(prefs.isOn(\.dm))
        XCTAssertTrue(prefs.isOn(\.mention))
        XCTAssertTrue(prefs.isOn(\.sound))
    }

    func testExplicitFalseReadsAsOff() {
        let prefs = NotificationPrefs(mention: false, sound: false)
        XCTAssertFalse(prefs.isOn(\.mention))
        XCTAssertFalse(prefs.isOn(\.sound))
        XCTAssertTrue(prefs.isOn(\.dm)) // untouched key stays on
    }

    func testUserWithNoPrefsColumnDefaultsToAllOn() throws {
        let json = """
            {"id":"u1","displayName":"Alice","email":"a@x.test","createdAt":"2026-09-01T00:00:00Z"}
            """
        let user = try JSONDecoder().decode(User.self, from: Data(json.utf8))
        XCTAssertNil(user.notificationPrefs)
        XCTAssertTrue(user.prefs.isOn(\.dm))
        XCTAssertTrue(user.prefs.isOn(\.sound))
    }

    /// One flip = one key on the wire. Encoding a delta must not spell out the
    /// keys it doesn't carry, or the server's shallow merge has nothing to
    /// merge and every other pref is reset to the sender's stale view.
    func testDeltaEncodesOnlyTheKeyThatMoved() throws {
        var delta = NotificationPrefs()
        delta.sound = false
        let encoded = try JSONEncoder().encode(delta)
        let keys = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        ).keys.sorted()
        XCTAssertEqual(keys, ["sound"])
    }

    // MARK: - The sound branch (AC 3)

    func testBannerCarriesDefaultSoundWhenThePrefIsOn() {
        let content = Banners.makeContent(
            title: "Bob", body: "hi", userInfo: ["channelId": "c1"], sound: true
        )
        XCTAssertEqual(content.sound, .default)
    }

    func testBannerCarriesNoSoundWhenThePrefIsOff() {
        let content = Banners.makeContent(
            title: "Bob", body: "hi", userInfo: ["channelId": "c1"], sound: false
        )
        XCTAssertNil(content.sound)
        // Silencing is presentation only — the banner still shows, and still
        // knows where to jump.
        XCTAssertEqual(content.title, "Bob")
        XCTAssertEqual(content.userInfo["channelId"] as? String, "c1")
    }

    /// The foreground path: Flow frontmost means the app, not the OS, picks the
    /// presentation options, so it has to make the same call the content did.
    func testForegroundPresentationFollowsTheContent() {
        XCTAssertEqual(Banners.presentationOptions(hasSound: true), [.banner, .sound])
        XCTAssertEqual(Banners.presentationOptions(hasSound: false), [.banner])
    }
}

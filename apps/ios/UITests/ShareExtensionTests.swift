import XCTest

/// Issue #214: the share extension. These are the three things that fail
/// *quietly* if the wiring is wrong, so they are asserted rather than eyeballed:
///
///   1. Flow appears in the system share sheet and its UI opens (AC 1).
///   2. The extension is already signed in — it reads the app's token out of
///      the shared Keychain group and lists real channels (AC 2, AC 4).
///   3. A 12 MP HEIC and a URL both post to the chosen channel (AC 6, AC 7).
///
/// Prerequisites, all supplied by `tools/qa-share-extension.sh`:
///
/// - The app is installed and signed in. `TEST_RUNNER_FLOW_TEST_LINK_CODE`
///   carries a one-time code from `POST /v1/auth/app-link`, which
///   `FLOW_DEBUG_LINK_CODE` exchanges — an agent account has no password, so
///   `FLOW_DEBUG_EMAIL` cannot be used.
/// - A 12 MP HEIC is in the simulator's photo library (`simctl addmedia`).
/// - The app *and the extension* are built against a non-localhost server. A
///   localhost build cannot fail the way this feature fails: `Server.storageSuffix`
///   is empty for `127.0.0.1:8787`, so both processes agree on the Keychain
///   account name by accident.
final class ShareExtensionTests: XCTestCase {
    private let photosBundleId = "com.apple.mobileslideshow"
    private let springboardBundleId = "com.apple.springboard"
    private let safariBundleId = "com.apple.mobilesafari"

    override func setUp() {
        continueAfterFailure = false
    }

    private var linkCode: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_LINK_CODE"] ?? ""
    }

    private var channelName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_CHANNEL"] ?? "task-214"
    }

    /// Distinctive enough to find in the channel afterwards.
    static let captionText = "12 MP HEIC from the share sheet"
    static let sharedURL = "https://example.com/flow-share-214"

    // MARK: - Sign the app in, so the extension has a token to find

    private func signInApp() {
        XCTAssertFalse(linkCode.isEmpty, "TEST_RUNNER_FLOW_TEST_LINK_CODE is required")
        let app = XCUIApplication()
        app.launchEnvironment = ["FLOW_DEBUG_LINK_CODE": linkCode]
        app.launch()

        // Signed in is defined by the *absence* of the sign-in screen: the
        // workspace title varies by account, "Sign in with Apple" does not.
        let signInButton = app.buttons["Sign in with Apple"]
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            dismissStraySystemAlert()
            if !signInButton.exists { break }
            _ = signInButton.waitForNonExistence(timeout: 3)
        }
        XCTAssertFalse(signInButton.exists, "app did not reach a signed-in state")
        // The notification prompt appears just after sign-in and would swallow
        // the first tap in Photos.
        dismissStraySystemAlert()
        app.terminate()
    }

    // MARK: - Tests

    func testShareTwelveMegapixelHEICFromPhotos() throws {
        signInApp()

        let photos = openPhotos()
        openNewestPhoto(photos)
        tap(
            photos.buttons["PUOneUpBarButtonItemIdentifierShare"],
            in: photos, name: "Share"
        )

        let flowActivity = photos.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Flow")).firstMatch
        XCTAssertTrue(
            flowActivity.waitForExistence(timeout: 20),
            "AC 1: Flow is missing from the share sheet"
        )
        flowActivity.tap()

        // AC 2: no sign-in screen, and a channel list drawn from the API.
        let picker = photos.buttons["share.channel"]
        XCTAssertTrue(
            picker.waitForExistence(timeout: 60),
            "AC 2/AC 4: the extension did not reach its channel picker — it is "
                + "signed out, or pointed at the wrong server"
        )
        XCTAssertFalse(
            photos.secureTextFields["Password"].exists,
            "AC 2: the extension is asking for a login"
        )
        // AC 4: on a second run the last-used channel is already selected, so
        // the picker only has to be opened when it isn't.
        let wanted = "#\(channelName)"
        if (picker.value as? String) != wanted {
            picker.tap()
            let channelRow = photos.buttons[wanted]
            XCTAssertTrue(
                channelRow.waitForExistence(timeout: 20),
                "AC 4: \(wanted) is not in the picker"
            )
            channelRow.tap()
        }
        XCTAssertEqual(picker.value as? String, wanted, "channel not selected")

        // AC 5: the caption rides along with the image as one message.
        let caption = photos.textFields["share.caption"]
        XCTAssertTrue(caption.waitForExistence(timeout: 10), "caption field is missing")
        caption.tap()
        caption.typeText(Self.captionText)

        let send = photos.buttons["share.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 10), "Send is missing")
        send.tap()

        // AC 6: the upload finishes before the sheet closes and the process is
        // not jetsammed on the way — either would leave "Sent" undrawn.
        let status = photos.staticTexts["share.status"]
        XCTAssertTrue(status.waitForExistence(timeout: 120), "the image did not post")
        XCTAssertEqual(status.label, "Sent to Flow", "the extension reported an error")
    }

    /// AC 7. A link is the other half of the activation rule, and it takes a
    /// different path through the extension: no upload, the URL *is* the
    /// message body.
    func testShareURLFromSafari() throws {
        signInApp()

        let safari = XCUIApplication(bundleIdentifier: safariBundleId)
        safari.terminate()
        safari.launch()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20), "Safari did not open")
        dismissStraySystemAlert()

        let address = safari.textFields["TabBarItemTitle"]
        XCTAssertTrue(address.waitForExistence(timeout: 20), "Safari address field not found")
        address.tap()
        safari.typeText(Self.sharedURL + "\n")

        // Safari 26 keeps Share inside the "More" menu rather than on the
        // toolbar.
        let shareInToolbar = safari.buttons["ShareButton"]
        if !shareInToolbar.waitForExistence(timeout: 5) {
            let more = safari.buttons["MoreMenuButton"]
            XCTAssertTrue(more.waitForExistence(timeout: 20), "Safari More button not found")
            more.tap()
        }
        XCTAssertTrue(shareInToolbar.waitForExistence(timeout: 20), "Safari Share not found")
        shareInToolbar.tap()

        let flowActivity = safari.cells["Flow"]
        XCTAssertTrue(
            flowActivity.waitForExistence(timeout: 20),
            "AC 1/AC 7: Flow is missing from Safari's share sheet"
        )
        flowActivity.tap()

        // Wait for the *form*, not for Send: the toolbar exists from the first
        // frame, so Send is on screen (disabled) while the channels are still
        // loading. Tapping it then does nothing at all.
        let picker = safari.buttons["share.channel"]
        XCTAssertTrue(
            picker.waitForExistence(timeout: 90),
            "AC 2/AC 7: the extension did not reach its channel picker"
        )
        XCTAssertEqual(
            safari.textFields["share.caption"].value as? String, Self.sharedURL,
            "AC 7: the shared link is not the message body"
        )

        let send = safari.buttons["share.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 10), "Send is missing")
        send.tap()

        let status = safari.staticTexts["share.status"]
        XCTAssertTrue(status.waitForExistence(timeout: 90), "the link did not post")
        XCTAssertEqual(status.label, "Sent to Flow", "the extension reported an error")
    }

    // MARK: - Helpers

    private func openPhotos() -> XCUIApplication {
        dismissStraySystemAlert()
        let photos = XCUIApplication(bundleIdentifier: photosBundleId)
        // Photos resumes wherever the last run left it — a photo still open,
        // or a share sheet still up. Start from a known screen.
        photos.terminate()
        photos.launch()
        XCTAssertTrue(photos.wait(for: .runningForeground, timeout: 20), "Photos did not open")
        dismissStraySystemAlert()
        let back = photos.buttons["PUOneUpBarButtonItemIdentifierDone"]
        if back.waitForExistence(timeout: 3), back.isHittable { back.tap() }
        return photos
    }

    /// Opens the newest photo — `simctl addmedia` appends, so the HEIC this
    /// test cares about is last. The grid is not a collection view: the tiles
    /// are `Image` elements under one layout group, and they report as not
    /// hittable, so the tap has to go through a coordinate.
    private func openNewestPhoto(_ photos: XCUIApplication) {
        let libraryTab = photos.buttons["LibraryTab"]
        if libraryTab.exists, libraryTab.isHittable { libraryTab.tap() }

        let tiles = photos.images.matching(identifier: "PXGGridLayout-Info")
        XCTAssertTrue(
            tiles.firstMatch.waitForExistence(timeout: 20),
            "no photo in the library — run simctl addmedia first"
        )
        tiles.element(boundBy: tiles.count - 1)
            .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .tap()
    }

    /// System alerts — the notification prompt after sign-in, and the
    /// "Open in Flow?" alert `simctl openurl` leaves behind — belong to
    /// SpringBoard, not to the app under test, and they swallow the first tap
    /// of whatever runs next.
    private func dismissStraySystemAlert() {
        let springboard = XCUIApplication(bundleIdentifier: springboardBundleId)
        for label in ["Allow", "Open", "OK", "Cancel", "Don't Allow"] {
            let button = springboard.alerts.buttons[label]
            if button.exists, button.isHittable { button.tap(); return }
        }
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication, name: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 20), "\(name) not found")
        element.tap()
    }
}

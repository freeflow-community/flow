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
    private let filesBundleId = "com.apple.DocumentsApp"

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
    static let videoCaption = "video from the share sheet (#219)"
    static let documentCaption = "PDF from Files (#219)"

    /// Seeded by `tools/qa-share-extension.sh`: a short movie in the photo
    /// library, and two files in the Files app's "On My iPhone" — a small PDF
    /// and one deliberately over the upload limit.
    private var documentName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_DOCUMENT"] ?? "qa-share-219.pdf"
    }

    private var oversizeName: String {
        ProcessInfo.processInfo.environment["FLOW_TEST_OVERSIZE"] ?? "qa-oversize-219.bin"
    }

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
        openNewest("Photo", in: photos)
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

    // MARK: - Issue #219: video and documents

    /// The failure this test exists for is silent: a video shared from Photos
    /// offers the movie *and* a preview frame, so an image-first precedence
    /// rule posts a still and still says "Sent to Flow". The assertion is
    /// therefore on the attachment row, not on the outcome.
    func testShareVideoFromPhotos() throws {
        signInApp()

        let photos = openPhotos()
        openNewest("Video", in: photos)
        tap(
            photos.buttons["PUOneUpBarButtonItemIdentifierShare"],
            in: photos, name: "Share"
        )

        let flowActivity = photos.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Flow")).firstMatch
        XCTAssertTrue(
            flowActivity.waitForExistence(timeout: 20),
            "Flow is missing from the share sheet for a video — check "
                + "NSExtensionActivationSupportsMovieWithMaxCount"
        )
        flowActivity.tap()

        selectChannel(in: photos)

        // The movie, not the poster frame.
        let name = photos.staticTexts["share.attachment.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 30), "no attachment preview")
        let ext = (name.label as NSString).pathExtension.lowercased()
        XCTAssertTrue(
            ["mov", "mp4", "m4v"].contains(ext),
            "the video posted as \(name.label) — precedence put the preview image first"
        )
        // Duration is only in the row when AVFoundation read the asset, which a
        // still frame would not have.
        let meta = photos.staticTexts["share.attachment.meta"]
        XCTAssertTrue(meta.label.contains("·"), "no duration in \(meta.label) — not read as a movie")
        attachScreenshot("share-sheet-video")

        caption(in: photos, Self.videoCaption)
        sendAndExpectSent(in: photos, timeout: 300)
    }

    /// A PDF has no image representation at all, so this is the plain-document
    /// path: the `File` activation rule, the document pass in the loader, and
    /// `application/pdf` from the extension.
    func testSharePDFFromFiles() throws {
        signInApp()

        let files = openFiles()
        shareDocument(named: documentName, in: files)

        let flowActivity = files.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Flow")).firstMatch
        XCTAssertTrue(
            flowActivity.waitForExistence(timeout: 20),
            "Flow is missing from the Files share sheet — check "
                + "NSExtensionActivationSupportsFileWithMaxCount"
        )
        flowActivity.tap()

        selectChannel(in: files)

        let name = files.staticTexts["share.attachment.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 30), "no attachment preview")
        XCTAssertEqual(name.label, documentName, "a different file was picked up")
        attachScreenshot("share-sheet-pdf")

        caption(in: files, Self.documentCaption)
        sendAndExpectSent(in: files, timeout: 120)
    }

    /// Over the limit has to *say so*. Before #219 an over-size file was a
    /// silent no-op or a jetsam, and both look identical to a slow upload.
    func testOversizeFileIsRefusedWithAReadableError() throws {
        signInApp()

        let files = openFiles()
        shareDocument(named: oversizeName, in: files)

        let flowActivity = files.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Flow")).firstMatch
        XCTAssertTrue(flowActivity.waitForExistence(timeout: 20), "Flow is missing from the share sheet")
        flowActivity.tap()

        // The check runs before the channel list, so the error is the first
        // thing drawn — and no bytes leave the device.
        let status = files.staticTexts["share.status"]
        XCTAssertTrue(status.waitForExistence(timeout: 60), "no error shown for an over-size file")
        attachScreenshot("share-sheet-oversize")
        XCTAssertTrue(
            status.label.contains("accepts files up to"),
            "the error does not name the limit: \(status.label)"
        )
        XCTAssertFalse(
            files.buttons["share.send"].isEnabled,
            "Send is still live on a file that cannot be posted"
        )
    }

    // MARK: - Helpers

    /// Kept in the result bundle so the sheet that was actually on screen can
    /// be looked at afterwards:
    ///
    ///   xcrun xcresulttool export attachments --path <result>.xcresult \
    ///     --output-path /tmp/shots
    private func attachScreenshot(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// The channel picker, plus the selection the sheet remembers between runs.
    private func selectChannel(in app: XCUIApplication, timeout: TimeInterval = 90) {
        let picker = app.buttons["share.channel"]
        XCTAssertTrue(
            picker.waitForExistence(timeout: timeout),
            "the extension did not reach its channel picker — it is signed out, "
                + "or pointed at the wrong server"
        )
        let wanted = "#\(channelName)"
        if (picker.value as? String) != wanted {
            picker.tap()
            let channelRow = app.buttons[wanted]
            XCTAssertTrue(channelRow.waitForExistence(timeout: 20), "\(wanted) is not in the picker")
            channelRow.tap()
        }
        XCTAssertEqual(picker.value as? String, wanted, "channel not selected")
    }

    private func caption(in app: XCUIApplication, _ text: String) {
        let field = app.textFields["share.caption"]
        XCTAssertTrue(field.waitForExistence(timeout: 10), "caption field is missing")
        field.tap()
        field.typeText(text)
    }

    /// The upload has to finish before the sheet closes: there is no background
    /// session, so a jetsam or a timeout leaves "Sent" undrawn.
    private func sendAndExpectSent(in app: XCUIApplication, timeout: TimeInterval) {
        let send = app.buttons["share.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 10), "Send is missing")
        send.tap()

        let status = app.staticTexts["share.status"]
        XCTAssertTrue(status.waitForExistence(timeout: timeout), "nothing posted")
        XCTAssertEqual(status.label, "Sent to Flow", "the extension reported an error")
    }

    private func openFiles() -> XCUIApplication {
        dismissStraySystemAlert()
        let files = XCUIApplication(bundleIdentifier: filesBundleId)
        files.terminate()
        files.launch()
        XCTAssertTrue(files.wait(for: .runningForeground, timeout: 20), "Files did not open")
        dismissStraySystemAlert()

        // The tab bar, specifically: Files restores the last location, and the
        // back button in that state is *also* labelled "Browse".
        let browse = files.tabBars.buttons["Browse"].firstMatch
        if browse.waitForExistence(timeout: 10), browse.isHittable { browse.tap() }
        // On a simulator "On My iPhone" is usually the only location, and
        // Browse opens straight into it.
        let onMyPhone = files.cells.staticTexts["On My iPhone"]
        if onMyPhone.waitForExistence(timeout: 5), onMyPhone.isHittable { onMyPhone.tap() }
        return files
    }

    /// Long-press → Share is the reliable route: tapping a document opens a
    /// preview whose toolbar differs per file type, and a `.bin` has no
    /// preview at all.
    ///
    /// Matched on the cell's *label*, which starts with the base name — the
    /// visible static text drops the extension ("qa-share-219"), so a match on
    /// the full filename finds nothing.
    private func shareDocument(named name: String, in files: XCUIApplication) {
        let base = (name as NSString).deletingPathExtension
        let item = files.cells.matching(NSPredicate(format: "label BEGINSWITH %@", base)).firstMatch
        XCTAssertTrue(
            item.waitForExistence(timeout: 20),
            "\(name) is not in On My iPhone — run qa-share-extension.sh to seed it"
        )
        item.press(forDuration: 1.2)
        let share = files.buttons["Share"].firstMatch
        XCTAssertTrue(share.waitForExistence(timeout: 20), "no Share in the context menu")
        share.tap()
    }

    private func openPhotos() -> XCUIApplication {
        dismissStraySystemAlert()
        let photos = XCUIApplication(bundleIdentifier: photosBundleId)
        // Photos resumes wherever the last run left it — a photo still open,
        // or a share sheet still up. Start from a known screen.
        photos.terminate()
        photos.launch()
        XCTAssertTrue(photos.wait(for: .runningForeground, timeout: 20), "Photos did not open")
        dismissStraySystemAlert()
        // "What's New in Photos" after an OS update. It covers the grid, and
        // the tiles are still visible *behind* it — so the tile assertion
        // passes and the coordinate tap lands on the sheet instead.
        let whatsNew = photos.buttons["Continue"]
        if whatsNew.waitForExistence(timeout: 3), whatsNew.isHittable { whatsNew.tap() }
        returnToGrid(photos)
        return photos
    }

    /// Photos survives `terminate()` with its screen intact, and a *video*
    /// left open resumes playing full screen with the chrome hidden — no Done
    /// button, no grid, and the next test reports an empty library. A tap
    /// brings the chrome back, and Done returns to the grid.
    private func returnToGrid(_ photos: XCUIApplication) {
        let tiles = photos.images.matching(identifier: "PXGGridLayout-Info")
        for _ in 0..<4 {
            if tiles.firstMatch.waitForExistence(timeout: 3) { return }
            photos.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let done = photos.buttons["PUOneUpBarButtonItemIdentifierDone"]
            if done.waitForExistence(timeout: 3), done.isHittable { done.tap() }
        }
    }

    /// Opens the newest photo, or the newest video. The grid is not a
    /// collection view: the tiles are `Image` elements under one layout group,
    /// and they report as not hittable, so the tap has to go through a
    /// coordinate.
    ///
    /// The *kind* matters since #219 seeds a movie into the same library —
    /// "the last tile" would hand the HEIC test a video. Each tile's label
    /// begins with "Photo, " or "Video, ", which is the only thing here that
    /// distinguishes them.
    private func openNewest(_ kind: String, in photos: XCUIApplication) {
        let libraryTab = photos.buttons["LibraryTab"]
        if libraryTab.exists, libraryTab.isHittable { libraryTab.tap() }

        let all = photos.images.matching(identifier: "PXGGridLayout-Info")
        XCTAssertTrue(
            all.firstMatch.waitForExistence(timeout: 20),
            "no media in the library — run simctl addmedia first"
        )
        let tiles = all.matching(NSPredicate(format: "label BEGINSWITH %@", "\(kind), "))
        XCTAssertGreaterThan(
            tiles.count, 0,
            "no \(kind.lowercased()) in the library — run qa-share-extension.sh to seed one"
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

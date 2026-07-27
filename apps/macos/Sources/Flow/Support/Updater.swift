import Foundation
import Sparkle
import SwiftUI

/// In-place auto-update (Sparkle 2). The app polls the appcast published beside
/// the DMG (`SUFeedURL` in Info.plist → `/download/mac/appcast.xml` on whichever
/// server this build points at), verifies each update against the EdDSA public
/// key baked into the bundle, and installs on quit.
///
/// Deliberately inert unless the build can actually be updated safely:
///   - a bare SwiftPM executable has no bundle (nothing to replace), and
///   - a build with no `SUPublicEDKey` cannot verify what it downloads.
/// In both cases the updater never starts and the menu item stays disabled,
/// rather than pointing an unverifiable installer at a running app.
@MainActor
final class AppUpdater: ObservableObject {
    /// Drives the Check for Updates… menu item's enabled state.
    @Published private(set) var canCheck = false

    private let controller: SPUStandardUpdaterController

    /// Everything the updater needs is present: a real bundle, a feed, and a
    /// public key to verify signatures with.
    static var isSupported: Bool {
        guard Bundle.main.bundleIdentifier != nil else { return false }
        let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
        let feed = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String ?? ""
        return !key.isEmpty && !feed.isEmpty
    }

    init() {
        // startingUpdater: false — starting it in an unsupported build logs a
        // Sparkle error on every launch. We start it below only when it can work.
        controller = SPUStandardUpdaterController(
            startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil
        )
        guard Self.isSupported else { return }
        do {
            try controller.updater.start()
            canCheck = controller.updater.canCheckForUpdates
        } catch {
            NSLog("Flow updater: not started — %@", error.localizedDescription)
        }
    }

    func checkForUpdates() {
        controller.updater.checkForUpdates()
    }

    /// Version line for the workspace menu, e.g. `2.1.0 (275)`.
    static var versionLabel: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "\(short) (\(build))"
    }
}

/// Standard "Check for Updates…" item for the app menu. Disabled while an
/// update is already in flight, and absent entirely from unbundled dev builds.
struct CheckForUpdatesCommand: View {
    @ObservedObject var updater: AppUpdater

    var body: some View {
        Button("Check for Updates…") { updater.checkForUpdates() }
            .disabled(!updater.canCheck)
    }
}

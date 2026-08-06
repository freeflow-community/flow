import Foundation

/// Version tag surfaced at the bottom of the workspace menu (web parity).
/// A packaged app shows its released marketing version (`CFBundleShortVersionString`,
/// from `apps/macos/VERSION`). The bare SwiftPM executable (dev/QA path) has no
/// plist, so it falls back to the commit SHA — same signal as `Banners.available`.
enum BuildInfo {
    /// Marketing version of a packaged build, e.g. `2.2.16`; nil when unbundled.
    static var version: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    /// Short commit SHA written into the bundle by `make-app.sh`, or `dev`.
    static var sha: String {
        Bundle.main.object(forInfoDictionaryKey: "FlowBuild") as? String ?? "dev"
    }

    /// Menu-ready label, e.g. `Version 2.2.16`; `Build a1b2c3d` when there is no
    /// version to show (dev build).
    static var label: String {
        if let version, !version.isEmpty { return "Version \(version)" }
        return "Build \(sha)"
    }
}

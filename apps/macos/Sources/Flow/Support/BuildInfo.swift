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

    /// `CFBundleVersion` — the build number App Store Connect keys on.
    static var build: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
    }

    /// Menu-ready label, e.g. `Version 2.2.16`; `Build a1b2c3d` when there is no
    /// version to show (dev build). iOS appends the build number
    /// (`Version 2.0 (21)`): every TestFlight build of a release shares one
    /// marketing version, so the version alone doesn't identify which one a
    /// tester is running.
    static var label: String {
        if let version, !version.isEmpty {
            #if os(iOS)
            if let build, !build.isEmpty, build != version {
                return "Version \(version) (\(build))"
            }
            #endif
            return "Version \(version)"
        }
        return "Build \(sha)"
    }
}

import Foundation

/// Build tag surfaced at the bottom of the workspace menu (web parity):
/// the short commit SHA of this build. `make-app.sh` writes `FlowBuild` into the
/// bundle Info.plist. The bare SwiftPM executable (dev/QA path) has no plist, so
/// it falls back to `dev` — same signal as `Banners.available`.
enum BuildInfo {
    /// Short commit SHA, or `dev` for an unbundled dev build.
    static var sha: String {
        Bundle.main.object(forInfoDictionaryKey: "FlowBuild") as? String ?? "dev"
    }

    /// Menu-ready label, e.g. `Build a1b2c3d`.
    static var label: String { "Build \(sha)" }
}

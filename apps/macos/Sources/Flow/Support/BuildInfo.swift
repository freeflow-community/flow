import Foundation

/// Readable build tag surfaced at the bottom of the workspace menu (web parity).
/// `make-app.sh` writes `FlowBuild` (`MMDD.N`, e.g. `0722.27`) and `FlowBuildSHA`
/// into the bundle Info.plist. The bare SwiftPM executable (dev/QA path) has no
/// plist, so both fall back — same signal as `Banners.available`.
enum BuildInfo {
    /// `MMDD.N` release tag, or `dev` for an unbundled dev build.
    static var number: String {
        Bundle.main.object(forInfoDictionaryKey: "FlowBuild") as? String ?? "dev"
    }

    /// Short commit SHA, empty when unavailable.
    static var sha: String {
        Bundle.main.object(forInfoDictionaryKey: "FlowBuildSHA") as? String ?? ""
    }

    /// Menu-ready label, e.g. `Build 0722.27`.
    static var label: String { "Build \(number)" }
}

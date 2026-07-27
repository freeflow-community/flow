import Foundation

/// Test/dev profile support: launch with FLOW_PROFILE=alice to give this
/// instance its own local cache, Keychain slot, and UserDefaults keys, so
/// multiple instances can run side by side as different accounts.
enum Profile {
    /// Sanitized profile name, or nil when running as the default instance.
    static let name: String? = {
        guard let raw = ProcessInfo.processInfo.environment["FLOW_PROFILE"],
              !raw.isEmpty else { return nil }
        let allowed = raw.unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
        }
        let cleaned = String(String.UnicodeScalarView(allowed))
        return cleaned.isEmpty ? nil : cleaned
    }()

    /// Suffix appended to storage identifiers. Combines the profile dimension
    /// ("" or ".alice") with the server dimension ("" for local dev, or
    /// "@app.freeflow.im" — see Server.storageSuffix) so instances never share
    /// caches, Keychain slots, or prefs across accounts *or* servers.
    static var suffix: String { (name.map { ".\($0)" } ?? "") + Server.storageSuffix }

    /// Window title ("Flow", "Flow — alice", "Flow @ app.freeflow.im", …).
    static var windowTitle: String {
        var title = name.map { "Flow — \($0)" } ?? "Flow"
        if !Server.isDefaultLocal { title += " @ \(Server.displayName)" }
        return title
    }
}

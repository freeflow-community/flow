import Foundation

/// Test/dev profile support: launch with MYCHAT_PROFILE=alice to give this
/// instance its own local cache, Keychain slot, and UserDefaults keys, so
/// multiple instances can run side by side as different accounts.
enum Profile {
    /// Sanitized profile name, or nil when running as the default instance.
    static let name: String? = {
        guard let raw = ProcessInfo.processInfo.environment["MYCHAT_PROFILE"],
              !raw.isEmpty else { return nil }
        let allowed = raw.unicodeScalars.filter {
            CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
        }
        let cleaned = String(String.UnicodeScalarView(allowed))
        return cleaned.isEmpty ? nil : cleaned
    }()

    /// Suffix appended to storage identifiers ("" or ".alice").
    static var suffix: String { name.map { ".\($0)" } ?? "" }

    /// Window title for this instance ("MyChat" or "MyChat — alice").
    static var windowTitle: String { name.map { "MyChat — \($0)" } ?? "MyChat" }
}

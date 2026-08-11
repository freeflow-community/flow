import Foundation
import Security

/// Minimal Keychain wrapper for the session bearer token.
enum Keychain {
    private static let service = "ai.biztrip.flow"
    private static let account = "session-token" + Profile.suffix

    #if os(iOS)
    /// Keychain access group shared by the iOS app and its share extension
    /// (issue #214). An extension runs as its own process with its own default
    /// group, so without this it reads an empty keychain and looks signed out.
    ///
    /// The value is the *app's own* application-identifier, which is also the
    /// group the app already writes to when no group is named — so tokens
    /// saved by earlier builds are already inside it and nothing has to
    /// migrate. It must stay in step with `DEVELOPMENT_TEAM` and
    /// `PRODUCT_BUNDLE_IDENTIFIER` in `apps/ios/project.yml`, and with the
    /// `keychain-access-groups` entitlement on both targets there.
    static let accessGroup: String? = "RP5QYMYA4Z.im.freeflow.app"
    #else
    /// macOS signs under a different team and has no extension to share with.
    static let accessGroup: String? = nil
    #endif

    static func saveToken(_ token: String) {
        deleteToken()
        var query = baseQuery()
        query[kSecValueData as String] = Data(token.utf8)
        if SecItemAdd(query as CFDictionary, nil) == errSecMissingEntitlement {
            // Unsigned or ad-hoc-signed builds (simulator, `swift run`) have no
            // entitlement to name a group. Storing ungrouped keeps those builds
            // working; on a properly signed device build this never runs.
            SecItemAdd(baseQuery(accessGroup: nil) as CFDictionary, nil)
        }
    }

    static func loadToken() -> String? {
        if let token = load(accessGroup: accessGroup) { return token }
        guard accessGroup != nil else { return nil }
        return load(accessGroup: nil)
    }

    static func deleteToken() {
        SecItemDelete(baseQuery() as CFDictionary)
        if accessGroup != nil { SecItemDelete(baseQuery(accessGroup: nil) as CFDictionary) }
    }

    private static func load(accessGroup: String?) -> String? {
        var query = baseQuery(accessGroup: accessGroup)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// `accessGroup` is passed explicitly (not defaulted to the static) so the
    /// ungrouped retry above can't accidentally re-add it.
    private static func baseQuery(accessGroup: String? = Keychain.accessGroup) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }
}

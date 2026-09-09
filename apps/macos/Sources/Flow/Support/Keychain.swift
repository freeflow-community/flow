import Foundation
import Security

/// Minimal Keychain wrapper for a session bearer token.
///
/// The account is a parameter, not a constant: each connection+identity keeps
/// its bearer in its own account, named by the `credentialRef` the connection
/// registry stores (`StorageScope.keychainAccount`). The default is the slot a
/// pre-multi-server install already uses, which is also the one the migrated
/// default connection is bound to — so an upgrade moves no credential and the
/// share extension, which has no registry of its own, keeps reading the right
/// account.
enum Keychain {
    private static let service = "ai.biztrip.flow"

    /// The pre-multi-server account, still owned by the default connection.
    static var defaultAccount: String { "session-token" + Profile.suffix }

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

    static func saveToken(_ token: String, account: String = Keychain.defaultAccount) {
        deleteToken(account: account)
        var query = baseQuery(account: account)
        query[kSecValueData as String] = Data(token.utf8)
        if SecItemAdd(query as CFDictionary, nil) == errSecMissingEntitlement {
            // Unsigned or ad-hoc-signed builds (simulator, `swift run`) have no
            // entitlement to name a group. Storing ungrouped keeps those builds
            // working; on a properly signed device build this never runs.
            SecItemAdd(baseQuery(account: account, accessGroup: nil) as CFDictionary, nil)
        }
    }

    static func loadToken(account: String = Keychain.defaultAccount) -> String? {
        if let token = load(account: account, accessGroup: accessGroup) { return token }
        guard accessGroup != nil else { return nil }
        return load(account: account, accessGroup: nil)
    }

    /// Does this account hold a token, without reading its bytes? Used at
    /// launch to decide whether the migrated connection starts out
    /// authenticated. Asking for attributes rather than data keeps it off the
    /// path that prompts for access on macOS.
    static func hasToken(account: String = Keychain.defaultAccount) -> Bool {
        func exists(_ group: String?) -> Bool {
            var query = baseQuery(account: account, accessGroup: group)
            query[kSecReturnAttributes as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: AnyObject?
            return SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess
        }
        if exists(accessGroup) { return true }
        return accessGroup != nil && exists(nil)
    }

    static func deleteToken(account: String = Keychain.defaultAccount) {
        SecItemDelete(baseQuery(account: account) as CFDictionary)
        if accessGroup != nil {
            SecItemDelete(baseQuery(account: account, accessGroup: nil) as CFDictionary)
        }
    }

    private static func load(account: String, accessGroup: String?) -> String? {
        var query = baseQuery(account: account, accessGroup: accessGroup)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// `accessGroup` is passed explicitly (not defaulted to the static) so the
    /// ungrouped retry above can't accidentally re-add it.
    private static func baseQuery(
        account: String,
        accessGroup: String? = Keychain.accessGroup
    ) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }
}

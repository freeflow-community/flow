import Foundation

/// Where one connection+identity's local state lives — its database directory,
/// its Keychain account, and every `UserDefaults` key it owns
/// (docs/specs/multi-server-workspaces.md: "Every credential, cache key, object
/// URL, database, sync cursor, navigation entry, draft, notification, and read
/// marker is scoped by connection and identity").
///
/// The scope is an *opaque local key*, not something derived from a server id.
/// Two backends that hand out deliberately colliding user or workspace UUIDs
/// still get disjoint storage, because nothing a server says feeds into it.
///
/// Two shapes exist:
///
///   * `.legacy` — the slot a pre-multi-server install already occupies:
///     `Flow<Profile.suffix>`, `session-token<Profile.suffix>`,
///     `activeWorkspaceId<Profile.suffix>`, and so on. Migration *binds* this
///     scope to the default connection rather than copying anything into a new
///     one, so an upgraded app re-downloads nothing and an interrupted
///     migration cannot strand a session.
///   * Everything else — `<name><profile>#<storageKey>`, minted locally when a
///     connection is added or an identity changes.
struct StorageScope: Equatable, Sendable {
    /// Sentinel for the namespace an existing install already uses.
    static let legacyKey = "legacy"

    let storageKey: String

    static let legacy = StorageScope(storageKey: legacyKey)

    static func fresh() -> StorageScope {
        StorageScope(storageKey: UUID().uuidString)
    }

    var isLegacy: Bool { storageKey == StorageScope.legacyKey }

    /// The QA/dev profile dimension alone (`""` or `".alice"`). The connection
    /// registry itself is keyed by this and *not* by the server dimension: one
    /// profile owns one registry, which may list several servers.
    /// `FLOW_PROFILE` isolation survives multi-server unchanged.
    static var profileDimension: String { Profile.name.map { ".\($0)" } ?? "" }

    /// Storage identifier for one of this scope's artifacts.
    func key(_ name: String) -> String {
        isLegacy ? name + Profile.suffix : name + StorageScope.profileDimension + "#" + storageKey
    }

    /// Application Support directory name for this scope's GRDB cache.
    var databaseDirectoryName: String { key("Flow") }

    /// Keychain account this scope's bearer lives under.
    var keychainAccount: String { key("session-token") }
}

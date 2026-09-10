import Foundation

/// Persistence and first-upgrade migration for the connection registry.
///
/// The registry is versioned. A blob we cannot read at the current version is
/// discarded rather than half-parsed: the connections it described are
/// rebuildable (migration re-runs, servers get re-added), and guessing at
/// unknown ownership is exactly what the spec forbids.
enum ConnectionStore {
    /// Keyed by the *profile* dimension only — one profile owns one registry,
    /// which may list several servers. QA `FLOW_PROFILE` isolation is unchanged.
    static var defaultsKey: String { "flow.connections.v1" + StorageScope.profileDimension }
    static var migrationMarkerKey: String { "flow.connections.migrated" + StorageScope.profileDimension }

    static func load(from defaults: UserDefaults) -> ConnectionRegistry? {
        guard let data = defaults.data(forKey: defaultsKey),
              let registry = try? JSONDecoder().decode(ConnectionRegistry.self, from: data),
              registry.version == ConnectionRegistry.currentVersion
        else { return nil }
        return registry
    }

    static func save(_ registry: ConnectionRegistry, to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(registry) else { return }
        defaults.set(data, forKey: defaultsKey)
        #if os(iOS)
        UserDefaults(suiteName: "group.im.freeflow.app")?.set(data, forKey: defaultsKey)
        #endif
    }

    /// The registry for this profile, migrating the pre-multi-server install on
    /// first upgrade.
    ///
    /// Migration creates a default connection from the *configured* server
    /// (`Server.baseURL` — env var, Info.plist, or the local dev default) and
    /// binds it to the legacy storage scope. Nothing is moved, copied or
    /// deleted: the token stays in the Keychain account it is already in, and
    /// the GRDB cache stays in the directory it is already in.
    ///
    /// That makes it crash-safe by construction. The marker is written only
    /// after the registry commits, and a crash at any point before that leaves
    /// an app whose legacy state is exactly where it was — the next launch
    /// re-runs migration and reaches the same result. Idempotent for the same
    /// reason: a second run finds the connection and returns it.
    ///
    /// The identity is deliberately left nil. It is committed by
    /// `bindIdentity` once `/v1/me` has *validated* the adopted token; claiming
    /// an unvalidated one is the single thing migration must not do.
    static func loadOrMigrate(
        from defaults: UserDefaults,
        server: URL,
        hasLegacyCredential: Bool
    ) -> ConnectionRegistry {
        if let existing = load(from: defaults), !existing.connections.isEmpty {
            return existing
        }
        var registry = load(from: defaults) ?? ConnectionRegistry()
        let origin = CanonicalOrigin.originOf(server)
            ?? CanonicalOrigin.originOf(Server.defaultLocal)!
        let connection = ServerConnection(
            connectionId: UUID().uuidString,
            provider: .flow,
            providerIdentity: origin.origin,
            origin: origin.origin,
            // The legacy connection keeps the cache directory the install
            // already has: `Flow<Profile.suffix>`.
            connectionStorageKey: StorageScope.legacyKey,
            label: origin.label,
            apiVersion: nil,
            capabilities: [:],
            addedAt: Date()
        )
        registry.connections.append(connection)
        registry.sessions.append(ServerSession(
            connectionId: connection.connectionId,
            userId: nil,
            credentialRef: StorageScope.legacy.keychainAccount,
            storageKey: StorageScope.legacyKey,
            authGeneration: 0,
            status: hasLegacyCredential ? .authenticated : .signedOut
        ))
        registry.activeConnectionId = connection.connectionId
        save(registry, to: defaults)
        defaults.set(ISO8601.string(from: Date()), forKey: migrationMarkerKey)
        return registry
    }

    /// Every defaults key a scope owns, so discarding one is exhaustive rather
    /// than a guess. The database directory and Keychain account are removed
    /// separately by the runtime that owns them.
    static let scopedDefaultsNames = [
        "currentUserId",
        "pushDeviceToken",
        "activeWorkspaceId",
        "lastChannelId",
        "collapsedImages",
        "pushRoutingId",
    ]

    static func clear(scope: StorageScope, in defaults: UserDefaults) {
        for name in scopedDefaultsNames { defaults.removeObject(forKey: scope.key(name)) }
        let suffix = scope.key("")
        for key in defaults.dictionaryRepresentation().keys {
            if (key.hasPrefix("navigation:") || key.hasPrefix("draft:") || key.hasPrefix("scroll:")) && key.hasSuffix(suffix) && (!scope.isLegacy || !key.contains("#")) {
                defaults.removeObject(forKey: key)
            }
        }
    }
}

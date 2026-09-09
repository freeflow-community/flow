import Foundation
import Testing
@testable import Flow

/// The connection registry and its first-upgrade migration (#540). Everything
/// here is value-level: no Keychain, no database, no network.

// MARK: - Canonical origin

@Suite struct CanonicalOriginTests {
    @Test func normalizesSchemeHostCaseAndDefaultPort() throws {
        #expect(try CanonicalOrigin.normalize("https://Flow.Example.COM/").origin == "https://flow.example.com")
        #expect(try CanonicalOrigin.normalize("HTTPS://flow.example.com:443").origin == "https://flow.example.com")
        #expect(try CanonicalOrigin.normalize("flow.example.com").origin == "https://flow.example.com")
    }

    @Test func keepsANonDefaultPort() throws {
        let origin = try CanonicalOrigin.normalize("https://flow.example.com:8443")
        #expect(origin.origin == "https://flow.example.com:8443")
        #expect(origin.effectivePort == 8443)
        #expect(origin.label == "flow.example.com:8443")
    }

    @Test func reportsTheEffectivePortEvenWhenItIsTheDefault() throws {
        #expect(try CanonicalOrigin.normalize("https://flow.example.com").effectivePort == 443)
    }

    @Test func rejectsUserinfoQueryFragmentAndNonRootPaths() {
        func code(_ input: String) -> ServerOriginError? {
            do {
                _ = try CanonicalOrigin.normalize(input)
                return nil
            } catch let e as ServerOriginError {
                return e
            } catch {
                return nil
            }
        }
        #expect(code("https://user:pw@flow.example.com") == .userinfoNotAllowed)
        #expect(code("https://flow.example.com/?join=abc") == .queryNotAllowed)
        #expect(code("https://flow.example.com/#/x") == .fragmentNotAllowed)
        #expect(code("https://example.com/flow") == .pathNotAllowed)
        #expect(code("https://example.com/join/acme/token") == .pathNotAllowed)
        #expect(code("   ") == .empty)
        #expect(code("flow://signin?code=1") == .schemeNotSupported)
    }

    @Test func requiresHTTPSOffLoopbackAndAllowsLoopbackOnlyInDevelopment() throws {
        #expect(throws: ServerOriginError.insecure) {
            try CanonicalOrigin.normalize("http://flow.example.com", allowInsecureLoopback: true)
        }
        #expect(throws: ServerOriginError.insecure) {
            try CanonicalOrigin.normalize("http://127.0.0.1:8787", allowInsecureLoopback: false)
        }
        #expect(
            try CanonicalOrigin.normalize("http://127.0.0.1:8787", allowInsecureLoopback: true).origin
                == "http://127.0.0.1:8787"
        )
        // A private-network deployment over HTTPS is fine.
        #expect(
            try CanonicalOrigin.normalize("https://192.168.1.9:8443", allowInsecureLoopback: false).origin
                == "https://192.168.1.9:8443"
        )
    }

    @Test func ownsOnlyItsExactOrigin() throws {
        let origin = try CanonicalOrigin.normalize("https://flow.example.com")
        #expect(origin.owns(URL(string: "https://flow.example.com/v1/me")!))
        #expect(!origin.owns(URL(string: "http://flow.example.com/v1/me")!))
        #expect(!origin.owns(URL(string: "https://flow.example.com:8443/v1/me")!))
        #expect(!origin.owns(URL(string: "https://evil.example.com/v1/me")!))
        // The shape a presigned storage URL actually arrives in.
        #expect(!origin.owns(URL(string: "https://bucket.r2.cloudflarestorage.com/o?X-Amz-Signature=x")!))
        #expect(origin.socketURL.absoluteString == "wss://flow.example.com/v1/ws")
    }
}

// MARK: - Storage scope

@Suite struct StorageScopeTests {
    @Test func legacyScopeResolvesToTheSlotAnExistingInstallAlreadyUses() {
        #expect(StorageScope.legacy.key("activeWorkspaceId") == "activeWorkspaceId" + Profile.suffix)
        #expect(StorageScope.legacy.keychainAccount == "session-token" + Profile.suffix)
        #expect(StorageScope.legacy.databaseDirectoryName == "Flow" + Profile.suffix)
    }

    @Test func twoScopesNeverCollide() {
        let a = StorageScope.fresh()
        let b = StorageScope.fresh()
        #expect(a.key("activeWorkspaceId") != b.key("activeWorkspaceId"))
        #expect(a.keychainAccount != b.keychainAccount)
        #expect(a.databaseDirectoryName != b.databaseDirectoryName)
        #expect(a.key("activeWorkspaceId") != StorageScope.legacy.key("activeWorkspaceId"))
    }

    @Test func aFreshScopeCarriesTheProfileDimensionSoQAProfilesStayApart() {
        // The registry key and every non-legacy artifact carry the profile
        // dimension, not the server dimension — see StorageScope.
        #expect(StorageScope.fresh().key("x").hasPrefix("x" + StorageScope.profileDimension + "#"))
        #expect(ConnectionStore.defaultsKey.hasSuffix(StorageScope.profileDimension))
    }
}

// MARK: - Registry records

@Suite struct ConnectionRegistryRecordTests {
    private func origin(_ s: String) throws -> CanonicalOrigin {
        try CanonicalOrigin.normalize(s, allowInsecureLoopback: true)
    }

    @Test func addingAConnectionMintsAPrivateNamespace() throws {
        var registry = ConnectionRegistry()
        let c = registry.addFlowConnection(origin: try origin("HTTPS://Flow.Example.com/"))
        #expect(c.origin == "https://flow.example.com")
        #expect(c.provider == .flow)
        #expect(c.providerIdentity == c.origin)
        #expect(registry.activeConnectionId == c.connectionId)
        let session = try #require(registry.session(c.connectionId))
        #expect(session.storageKey != StorageScope.legacyKey)
        #expect(session.credentialRef == StorageScope(storageKey: session.storageKey).keychainAccount)
        #expect(session.userId == nil)
        #expect(session.authGeneration == 0)
    }

    @Test func theSameOriginIsTheSameConnectionAndADifferentPortIsNot() throws {
        var registry = ConnectionRegistry()
        let first = registry.addFlowConnection(origin: try origin("https://flow.example.com"))
        let again = registry.addFlowConnection(origin: try origin("https://flow.example.com:443"))
        #expect(again.connectionId == first.connectionId)
        #expect(registry.connections.count == 1)
        _ = registry.addFlowConnection(origin: try origin("https://flow.example.com:8443"))
        #expect(registry.connections.count == 2)
    }

    @Test func collidingServerIdsCannotShareStorage() throws {
        var registry = ConnectionRegistry()
        let a = registry.addFlowConnection(origin: try origin("https://a.example.com"))
        let b = registry.addFlowConnection(origin: try origin("https://b.example.com"))
        // Both servers hand out the same user UUID on purpose.
        _ = registry.bindIdentity(a.connectionId, userId: "11111111-1111-1111-1111-111111111111")
        _ = registry.bindIdentity(b.connectionId, userId: "11111111-1111-1111-1111-111111111111")
        let sa = StorageScope(storageKey: try #require(registry.session(a.connectionId)).storageKey)
        let sb = StorageScope(storageKey: try #require(registry.session(b.connectionId)).storageKey)
        #expect(sa.databaseDirectoryName != sb.databaseDirectoryName)
        #expect(sa.keychainAccount != sb.keychainAccount)
    }

    @Test func bindingADifferentIdentityRotatesTheNamespace() throws {
        var registry = ConnectionRegistry()
        let c = registry.addFlowConnection(origin: try origin("https://flow.example.com"))
        let firstBind = registry.bindIdentity(c.connectionId, userId: "user-1")
        #expect(firstBind == nil)
        let firstKey = try #require(registry.session(c.connectionId)).storageKey
        // Same identity again is a no-op.
        let rebind = registry.bindIdentity(c.connectionId, userId: "user-1")
        #expect(rebind == nil)
        #expect(try #require(registry.session(c.connectionId)).storageKey == firstKey)

        let rotated = registry.bindIdentity(c.connectionId, userId: "user-2")
        let abandoned = try #require(rotated)
        #expect(abandoned.storageKey == firstKey)
        let after = try #require(registry.session(c.connectionId))
        #expect(after.storageKey != firstKey)
        #expect(after.credentialRef == StorageScope(storageKey: after.storageKey).keychainAccount)
        #expect(after.userId == "user-2")
    }

    @Test func removingAConnectionForgetsOnlyItsOwnRecords() throws {
        var registry = ConnectionRegistry()
        let a = registry.addFlowConnection(origin: try origin("https://a.example.com"))
        let b = registry.addFlowConnection(origin: try origin("https://b.example.com"))
        registry.setBinding(WorkspaceBinding(
            connectionId: a.connectionId, userId: "u", workspaceId: "ws", name: "A"
        ))
        registry.setBinding(WorkspaceBinding(
            connectionId: b.connectionId, userId: "u", workspaceId: "ws", name: "B"
        ))
        registry.setNavigationTarget(NavigationTarget(
            connectionId: a.connectionId, userId: "u", workspaceId: "ws", channelId: "c-a"
        ))
        registry.setNavigationTarget(NavigationTarget(
            connectionId: b.connectionId, userId: "u", workspaceId: "ws", channelId: "c-b"
        ))

        registry.removeConnection(a.connectionId)
        #expect(registry.connections.map(\.connectionId) == [b.connectionId])
        #expect(registry.sessions.count == 1)
        #expect(registry.bindings.map(\.name) == ["B"])
        #expect(registry.navigationTarget(connectionId: b.connectionId, userId: "u")?.channelId == "c-b")
        #expect(registry.navigationTarget(connectionId: a.connectionId, userId: "u") == nil)
        #expect(registry.activeConnectionId == b.connectionId)
    }

    @Test func oneNavigationTargetAndOneBindingPerConnectionAndIdentity() throws {
        var registry = ConnectionRegistry()
        let c = registry.addFlowConnection(origin: try origin("https://flow.example.com"))
        let id = c.connectionId
        registry.setNavigationTarget(NavigationTarget(
            connectionId: id, userId: "u1", workspaceId: "ws-1", channelId: "c1"
        ))
        registry.setNavigationTarget(NavigationTarget(
            connectionId: id, userId: "u2", workspaceId: "ws-9", channelId: "c9"
        ))
        registry.setNavigationTarget(NavigationTarget(
            connectionId: id, userId: "u1", workspaceId: "ws-1", channelId: "c2"
        ))
        #expect(registry.navigation.count == 2)
        #expect(registry.navigationTarget(connectionId: id, userId: "u1")?.channelId == "c2")
        #expect(registry.navigationTarget(connectionId: id, userId: "u2")?.channelId == "c9")

        registry.setBinding(WorkspaceBinding(connectionId: id, userId: "u1", workspaceId: "ws", name: "Acme"))
        registry.setBinding(WorkspaceBinding(connectionId: id, userId: "u1", workspaceId: "ws", name: "Acme HQ"))
        #expect(registry.bindings.count == 1)
        #expect(registry.bindings[0].name == "Acme HQ")
    }
}

// MARK: - Migration

@Suite struct ConnectionMigrationTests {
    /// A throwaway defaults domain per test — never the app's own.
    private func defaults(_ name: String = UUID().uuidString) -> UserDefaults {
        UserDefaults(suiteName: "flow.tests.\(name)")!
    }

    private let legacyServer = URL(string: "https://app.freeflow.im")!

    @Test func adoptsTheLegacySlotInPlaceRatherThanCopyingAnything() throws {
        let d = defaults()
        defer { d.removePersistentDomain(forName: d.description) }
        let registry = ConnectionStore.loadOrMigrate(
            from: d, server: legacyServer, hasLegacyCredential: true
        )
        let c = try #require(registry.connections.first)
        #expect(c.provider == .flow)
        #expect(c.origin == "https://app.freeflow.im")
        #expect(registry.activeConnectionId == c.connectionId)

        let session = try #require(registry.session(c.connectionId))
        #expect(session.storageKey == StorageScope.legacyKey)
        #expect(session.credentialRef == "session-token" + Profile.suffix)
        #expect(StorageScope(storageKey: session.storageKey).databaseDirectoryName == "Flow" + Profile.suffix)
        #expect(session.status == .authenticated)
        // The identity is committed by /v1/me, not claimed by migration.
        #expect(session.userId == nil)
    }

    @Test func startsSignedOutWhenThereWasNoLegacyCredential() {
        let d = defaults()
        let registry = ConnectionStore.loadOrMigrate(
            from: d, server: legacyServer, hasLegacyCredential: false
        )
        #expect(registry.sessions.first?.status == .signedOut)
    }

    @Test func isIdempotent() throws {
        let d = defaults()
        let first = ConnectionStore.loadOrMigrate(from: d, server: legacyServer, hasLegacyCredential: true)
        let second = ConnectionStore.loadOrMigrate(from: d, server: legacyServer, hasLegacyCredential: true)
        #expect(second.connections.count == 1)
        #expect(second.connections[0].connectionId == first.connections[0].connectionId)
    }

    @Test func reRunsCleanlyWhenInterruptedBeforeTheMarkerLanded() throws {
        let d = defaults()
        let first = ConnectionStore.loadOrMigrate(from: d, server: legacyServer, hasLegacyCredential: true)
        // Crash between committing the registry and writing the marker.
        d.removeObject(forKey: ConnectionStore.migrationMarkerKey)
        let again = ConnectionStore.loadOrMigrate(from: d, server: legacyServer, hasLegacyCredential: true)
        #expect(again.connections.count == 1)
        #expect(again.connections[0].connectionId == first.connections[0].connectionId)
        #expect(again.session(again.connections[0].connectionId)?.credentialRef
            == "session-token" + Profile.suffix)
    }

    @Test func reRunsCleanlyWhenInterruptedBeforeTheRegistryLanded() throws {
        let d = defaults()
        // Nothing was written at all: the install is untouched, so the next
        // launch simply migrates.
        let registry = ConnectionStore.loadOrMigrate(from: d, server: legacyServer, hasLegacyCredential: true)
        #expect(registry.connections.count == 1)
        #expect(registry.sessions[0].status == .authenticated)
    }

    @Test func discardsACorruptOrFutureVersionedRegistryRatherThanHalfReadingIt() throws {
        let d = defaults()
        d.set(Data("not json".utf8), forKey: ConnectionStore.defaultsKey)
        #expect(ConnectionStore.load(from: d) == nil)

        var future = ConnectionRegistry()
        future.version = 99
        d.set(try JSONEncoder().encode(future), forKey: ConnectionStore.defaultsKey)
        #expect(ConnectionStore.load(from: d) == nil)

        // …and migration rebuilds the default connection over it.
        let registry = ConnectionStore.loadOrMigrate(from: d, server: legacyServer, hasLegacyCredential: true)
        #expect(registry.connections.count == 1)
    }

    @Test func roundTripsThroughDefaults() throws {
        let d = defaults()
        var registry = ConnectionStore.loadOrMigrate(from: d, server: legacyServer, hasLegacyCredential: true)
        let id = registry.connections[0].connectionId
        registry.updateSession(id) { $0.authGeneration = 3 }
        ConnectionStore.save(registry, to: d)
        #expect(ConnectionStore.load(from: d)?.session(id)?.authGeneration == 3)
    }

    @Test func discardingAScopeRemovesEveryDefaultsKeyItOwns() throws {
        let d = defaults()
        let scope = StorageScope.fresh()
        for name in ConnectionStore.scopedDefaultsNames { d.set("x", forKey: scope.key(name)) }
        let other = StorageScope.fresh()
        d.set("keep", forKey: other.key("currentUserId"))

        ConnectionStore.clear(scope: scope, in: d)
        for name in ConnectionStore.scopedDefaultsNames {
            #expect(d.string(forKey: scope.key(name)) == nil)
        }
        #expect(d.string(forKey: other.key("currentUserId")) == "keep")
    }
}

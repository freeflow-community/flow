import Foundation

/// Owns one session runtime per connection (docs/specs/multi-server-workspaces.md,
/// "Runtime architecture"). A runtime is everything that belongs to one backend
/// session: its API client bound to that origin, its socket, its GRDB cache, its
/// sync engine, its identity, and the storage scopes those live in.
///
/// One connection exists today — the migrated default. The switcher that adds
/// more is phase 3; what this ticket delivers is that nothing in the app talks
/// to "the server" any more. It talks to *a runtime*, and an operation that
/// captured one at start cannot be retargeted by a later switch.
@MainActor
final class ConnectionRuntime {
    let connection: ServerConnection
    /// Scope that rotates with identity: credentials, defaults, sync cursors,
    /// navigation entries, read markers.
    private(set) var sessionScope: StorageScope
    /// Scope stable for the life of the connection: the GRDB cache directory.
    var connectionScope: StorageScope { connection.connectionScope }

    let api: APIClient
    let socket: SocketClient
    let db: AppDatabase
    let engine: SyncEngine

    init(connection: ServerConnection, sessionScope: StorageScope, db: AppDatabase) {
        self.connection = connection
        self.sessionScope = sessionScope
        self.db = db
        let origin = connection.canonicalOrigin
        let baseURL = origin?.url ?? connection.url
        self.api = APIClient(baseURL: baseURL)
        self.socket = SocketClient(url: origin?.socketURL ?? Server.wsURL)
        self.engine = SyncEngine(
            db: db, api: api, socket: socket,
            connectionId: connection.connectionId, scope: sessionScope
        )
    }

    func adopt(sessionScope: StorageScope) {
        self.sessionScope = sessionScope
    }
}

@MainActor
final class ConnectionManager {
    static let shared = ConnectionManager()

    private(set) var registry: ConnectionRegistry
    private var runtimes: [String: ConnectionRuntime] = [:]
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        // Reads the *configured* server (env var, Info.plist, or the local dev
        // default) — the native equivalent of the web client's page origin.
        self.registry = ConnectionStore.loadOrMigrate(
            from: defaults,
            server: Server.baseURL,
            hasLegacyCredential: Keychain.hasToken(account: StorageScope.legacy.keychainAccount)
        )
    }

    private func commit(_ registry: ConnectionRegistry) {
        self.registry = registry
        ConnectionStore.save(registry, to: defaults)
    }

    var activeConnection: ServerConnection? {
        registry.activeConnectionId.flatMap { registry.connection($0) }
            ?? registry.connections.first
    }

    /// Scope every *view-level* stored preference that belongs to the signed-in
    /// session uses (`WindowState`'s navigation entries, collapsed images). The
    /// engine and the runtime hold their own copy rather than reading this, so
    /// a background operation cannot pick up a scope that changed under it.
    var activeSessionScope: StorageScope {
        guard let id = activeConnection?.connectionId,
              let session = registry.session(id)
        else { return .legacy }
        return StorageScope(storageKey: session.storageKey)
    }

    /// The runtime for a connection, built on first use.
    func runtime(_ connectionId: String) -> ConnectionRuntime? {
        if let existing = runtimes[connectionId] { return existing }
        guard let connection = registry.connection(connectionId),
              let session = registry.session(connectionId)
        else { return nil }
        let db: AppDatabase
        do {
            db = try AppDatabase.open(scope: connection.connectionScope)
        } catch {
            fatalError("Cannot open local database for \(connection.label): \(error)")
        }
        let runtime = ConnectionRuntime(
            connection: connection,
            sessionScope: StorageScope(storageKey: session.storageKey),
            db: db
        )
        runtimes[connectionId] = runtime
        return runtime
    }

    /// The runtime the app is currently pointed at.
    func active() -> ConnectionRuntime {
        if let id = activeConnection?.connectionId, let runtime = runtime(id) { return runtime }
        // Only reachable if the registry was emptied under us; rebuilding the
        // default connection beats refusing to launch.
        var next = registry
        let connection = next.addFlowConnection(
            origin: CanonicalOrigin.originOf(Server.baseURL)
                ?? CanonicalOrigin.originOf(Server.defaultLocal)!
        )
        next.activeConnectionId = connection.connectionId
        commit(next)
        return runtime(connection.connectionId)!
    }

    /// Commit a *validated* identity for a connection. A different identity
    /// rotates the session scope and discards the previous one's credential and
    /// defaults; the cache is wiped in place by the sign-out that preceded it.
    func bindIdentity(connectionId: String, userId: String) {
        var next = registry
        let abandoned = next.bindIdentity(connectionId, userId: userId)
        commit(next)
        if let session = next.session(connectionId) {
            runtimes[connectionId]?.adopt(sessionScope: StorageScope(storageKey: session.storageKey))
        }
        guard let abandoned else { return }
        ConnectionStore.clear(scope: abandoned, in: defaults)
        Keychain.deleteToken(account: abandoned.keychainAccount)
    }

    func markSignedOut(connectionId: String) {
        var next = registry
        next.updateSession(connectionId) { $0.status = .signedOut }
        commit(next)
    }

    /// The backend rejected this connection's bearer. The runtime only reports
    /// it when the auth generation still matches, so a 401 answering a
    /// pre-refresh request never reaches here.
    func markUnauthorized(connectionId: String) {
        var next = registry
        next.updateSession(connectionId) { $0.status = .unauthorized }
        commit(next)
    }

    func noteTokenReplaced(connectionId: String, generation: Int) {
        var next = registry
        next.updateSession(connectionId) { $0.authGeneration = generation }
        commit(next)
    }

    /// Remember where a connection+identity is parked, so each session lands
    /// where it was rather than sharing one global "last channel".
    func rememberNavigation(_ target: NavigationTarget) {
        var next = registry
        next.setNavigationTarget(target)
        commit(next)
    }

    func navigationTarget(connectionId: String, userId: String) -> NavigationTarget? {
        registry.navigationTarget(connectionId: connectionId, userId: userId)
    }

    func setBinding(_ binding: WorkspaceBinding) {
        var next = registry
        next.setBinding(binding)
        commit(next)
    }

    /// Forget a connection entirely: its runtime, its credential, its defaults,
    /// its cache and its registry records. Every other connection is untouched.
    func remove(connectionId: String) {
        guard let connection = registry.connection(connectionId) else { return }
        let session = registry.session(connectionId)
        runtimes.removeValue(forKey: connectionId)
        var next = registry
        next.removeConnection(connectionId)
        commit(next)
        if let session {
            let scope = StorageScope(storageKey: session.storageKey)
            ConnectionStore.clear(scope: scope, in: defaults)
            Keychain.deleteToken(account: scope.keychainAccount)
        }
        AppDatabase.destroy(scope: connection.connectionScope)
    }
}

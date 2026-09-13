import Foundation

/// The connection registry's record types
/// (docs/specs/multi-server-workspaces.md, "Connection and identity model").
/// The origin rules they lean on live in `CanonicalOrigin.swift`.
///
/// Shared by macOS and iOS. Nothing here touches storage or the network — it is
/// the value layer that `ConnectionStore` persists and `ConnectionManager` runs.

/// Providers a connection can speak. Only `flow` is created today; the field
/// exists from the start so the persisted schema does not have to change when
/// Slack connections arrive.
enum ConnectionProvider: String, Codable, Sendable {
    case flow
    case slack
}

enum SlackConnectionError: Error, Equatable {
    /// The team is already recorded with a different connector; remove it first.
    case connectorChanged
}

enum SessionStatus: String, Codable, Sendable {
    case authenticated
    case unauthorized
    case signedOut
}

struct ServerConnection: Codable, Identifiable, Equatable, Sendable {
    /// Local and stable. Not an authentication claim: a server cannot declare
    /// itself equivalent to another connection through discovery metadata.
    let connectionId: String
    let provider: ConnectionProvider
    /// The canonical origin for `flow`; for `slack` it will be the
    /// `(environment, enterpriseId?, teamId)` tuple that workstream serializes.
    let providerIdentity: String
    /// Canonical origin / transport endpoint this connection's runtime dials.
    let origin: String
    /// Storage scope stable for the life of the *connection*, as opposed to the
    /// session scope that rotates with identity. It owns the one thing a live
    /// handle cannot follow through a rotation: the GRDB cache directory. An
    /// identity change wipes that cache in place — which every sign-out path
    /// already does — rather than orphaning a directory a `DatabasePool` still
    /// has open. V1 is one account per Flow server, so the two never diverge in
    /// practice; the split exists so neither can leak into the other.
    var connectionStorageKey: String = StorageScope.legacyKey
    var label: String
    /// `protocolVersion` from `GET /v1/client-info`, nil until discovery runs —
    /// the migrated default connection predates discovery.
    var apiVersion: Int?
    var capabilities: [String: Bool]
    let addedAt: Date

    var id: String { connectionId }

    var url: URL { URL(string: origin) ?? Server.defaultLocal }
    var canonicalOrigin: CanonicalOrigin? { CanonicalOrigin.originOf(url) }
    /// How this connection names itself in the UI — the switcher sheet's rows
    /// and the iOS sidebar header both use it, so they can't drift (#563).
    var displayLabel: String {
        provider == .slack ? "Slack · \(label)" : canonicalOrigin?.label ?? origin
    }
    var connectionScope: StorageScope { StorageScope(storageKey: connectionStorageKey) }
}

/// Never holds a credential — only the *reference* to where one lives. That is
/// what makes migration a copy-free act and makes "never copy a token to
/// another origin" true by construction.
struct ServerSession: Codable, Equatable, Sendable {
    let connectionId: String
    /// Server-issued user id. Nil until the first `/v1/me` has validated the
    /// token; migration deliberately does not claim one.
    var userId: String?
    /// Keychain account the bearer lives under.
    var credentialRef: String
    /// Namespace for this connection+identity's database, defaults and caches.
    var storageKey: String
    /// Bumped on every token replacement so a 401 from a pre-refresh request
    /// cannot invalidate the session that replaced it.
    var authGeneration: Int
    var status: SessionStatus
}

struct WorkspaceBinding: Codable, Equatable, Sendable {
    let connectionId: String
    let userId: String
    let workspaceId: String
    var name: String
    var hidden: Bool?
    var order: Int?
}

struct NavigationTarget: Codable, Equatable, Sendable {
    let connectionId: String
    let userId: String
    var workspaceId: String
    var channelId: String?
    var messageId: String?
    var threadRootId: String?
    var artifactId: String?
}

struct ConnectionRegistry: Codable, Equatable, Sendable {
    static let currentVersion = 1

    var version: Int = ConnectionRegistry.currentVersion
    var connections: [ServerConnection] = []
    var sessions: [ServerSession] = []
    var bindings: [WorkspaceBinding] = []
    var navigation: [NavigationTarget] = []
    var activeConnectionId: String?

    func connection(_ id: String) -> ServerConnection? {
        connections.first { $0.connectionId == id }
    }

    func session(_ id: String) -> ServerSession? {
        sessions.first { $0.connectionId == id }
    }

    mutating func updateSession(_ id: String, _ mutate: (inout ServerSession) -> Void) {
        guard let index = sessions.firstIndex(where: { $0.connectionId == id }) else { return }
        mutate(&sessions[index])
    }

    /// Bind a *validated* identity. A different identity gets a fresh storage
    /// namespace: cached state whose ownership we can no longer establish is
    /// discarded and refetched, never handed to another user. Returns the
    /// namespace that was abandoned, if any.
    @discardableResult
    mutating func bindIdentity(_ id: String, userId: String) -> StorageScope? {
        guard let session = session(id) else { return nil }
        if session.userId == userId {
            updateSession(id) { $0.status = .authenticated }
            return nil
        }
        // First identity on a namespace nobody has used yet: adopt it as-is.
        // That is what keeps the migrated legacy namespace attached to its user.
        if session.userId == nil {
            updateSession(id) {
                $0.userId = userId
                $0.status = .authenticated
            }
            return nil
        }
        bindings.removeAll { $0.connectionId == id }
        navigation.removeAll { $0.connectionId == id }
        let abandoned = StorageScope(storageKey: session.storageKey)
        let scope = StorageScope.fresh()
        updateSession(id) {
            $0.userId = userId
            $0.storageKey = scope.storageKey
            $0.credentialRef = scope.keychainAccount
            $0.status = .authenticated
        }
        return abandoned
    }

    /// Add a Flow connection for `origin`, or return the one already on it.
    /// Changing an origin creates a *new* connection in V1.
    @discardableResult
    mutating func addFlowConnection(origin: CanonicalOrigin, label: String? = nil) -> ServerConnection {
        if let existing = connections.first(where: { $0.provider == .flow && $0.origin == origin.origin }) {
            return existing
        }
        let scope = StorageScope.fresh()
        let connection = ServerConnection(
            connectionId: UUID().uuidString,
            provider: .flow,
            providerIdentity: origin.origin,
            origin: origin.origin,
            connectionStorageKey: StorageScope.fresh().storageKey,
            label: label ?? origin.label,
            apiVersion: nil,
            capabilities: [:],
            addedAt: Date()
        )
        connections.append(connection)
        sessions.append(ServerSession(
            connectionId: connection.connectionId,
            userId: nil,
            credentialRef: scope.keychainAccount,
            storageKey: scope.storageKey,
            authGeneration: 0,
            status: .signedOut
        ))
        if activeConnectionId == nil { activeConnectionId = connection.connectionId }
        return connection
    }

    /// Add a Slack team authorized through a connector, or refresh the one
    /// already recorded for that identity (#545). Identity is the immutable
    /// `(environment, enterpriseId?, teamId, userId)` tuple — never the team
    /// domain or name — so two teams at slack.com stay two connections and a
    /// renamed workspace keeps its record. Changing the connector for an
    /// existing team is refused: remove it first. Each team is its own single
    /// workspace in the switcher, bound by the team id.
    @discardableResult
    mutating func addSlackConnection(
        connectorOrigin: String, enterpriseId: String?, teamId: String, userId: String,
        teamName: String, userName: String, capabilities: [String: Bool]
    ) throws -> ServerConnection {
        let identity = SlackIdentity.identityString(enterpriseId: enterpriseId, teamId: teamId, userId: userId)
        let label = "\(teamName) · \(userName)"
        if let index = connections.firstIndex(where: { $0.provider == .slack && $0.providerIdentity == identity }) {
            if connections[index].origin != connectorOrigin {
                throw SlackConnectionError.connectorChanged
            }
            connections[index].label = label
            connections[index].capabilities = capabilities
            setBinding(WorkspaceBinding(connectionId: connections[index].connectionId, userId: userId, workspaceId: teamId, name: teamName, hidden: false, order: nil))
            return connections[index]
        }
        let scope = StorageScope.fresh()
        let connection = ServerConnection(
            connectionId: UUID().uuidString,
            provider: .slack,
            providerIdentity: identity,
            origin: connectorOrigin,
            connectionStorageKey: StorageScope.fresh().storageKey,
            label: label,
            apiVersion: 1,
            capabilities: capabilities,
            addedAt: Date()
        )
        connections.append(connection)
        sessions.append(ServerSession(
            connectionId: connection.connectionId,
            userId: userId,
            credentialRef: scope.keychainAccount,
            storageKey: scope.storageKey,
            authGeneration: 0,
            status: .authenticated
        ))
        setBinding(WorkspaceBinding(connectionId: connection.connectionId, userId: userId, workspaceId: teamId, name: teamName, hidden: false, order: nil))
        return connection
    }

    /// Forget a connection and every record scoped to it. The caller disposes
    /// the live runtime and its storage; this is only the durable half.
    mutating func removeConnection(_ id: String) {
        connections.removeAll { $0.connectionId == id }
        sessions.removeAll { $0.connectionId == id }
        bindings.removeAll { $0.connectionId == id }
        navigation.removeAll { $0.connectionId == id }
        if activeConnectionId == id { activeConnectionId = connections.first?.connectionId }
    }

    mutating func setBinding(_ binding: WorkspaceBinding) {
        bindings.removeAll {
            $0.connectionId == binding.connectionId
                && $0.userId == binding.userId
                && $0.workspaceId == binding.workspaceId
        }
        bindings.append(binding)
    }

    /// One remembered destination per connection+identity — where that session
    /// lands on the next launch.
    mutating func setNavigationTarget(_ target: NavigationTarget) {
        navigation.removeAll { $0.connectionId == target.connectionId && $0.userId == target.userId }
        navigation.append(target)
    }

    func navigationTarget(connectionId: String, userId: String) -> NavigationTarget? {
        navigation.first { $0.connectionId == connectionId && $0.userId == userId }
    }
}

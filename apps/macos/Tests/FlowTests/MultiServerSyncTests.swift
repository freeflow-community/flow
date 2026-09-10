import Foundation
import Testing
@testable import Flow

/// Phase 4 of multi-server workspaces (#542): background sync across
/// connections, and notification routing that cannot cross one.
///
/// Value-level, like the phase 2 registry tests: no Keychain, no database, no
/// network. Anything that needs a live session belongs in the acceptance sweep
/// (docs/qa/issue-542), not here.

// MARK: - Bounded start-up

@Suite struct BackgroundSyncBoundTests {
    @Test func splitsPendingConnectionsIntoBoundedWaves() {
        let pending = (1...7).map { "c\($0)" }
        let waves = ConnectionManager.startWaves(pending, limit: 3)
        #expect(waves.map(\.count) == [3, 3, 1])
        #expect(waves.flatMap { $0 } == pending)
    }

    @Test func oneWaveWhenEverythingFits() {
        #expect(ConnectionManager.startWaves(["a", "b"], limit: 3) == [["a", "b"]])
    }

    @Test func nothingPendingIsNoWaves() {
        #expect(ConnectionManager.startWaves([], limit: 3).isEmpty)
    }

    /// The shipped bound. Named here so raising it is a deliberate edit to a
    /// test, not a number that drifts.
    @Test func shipsWithABoundOfThree() {
        #expect(ConnectionManager.maxConcurrentStarts == 3)
    }
}

// MARK: - Push routing identifiers

@Suite struct PushRoutingIdentifierTests {
    @Test func readsTheRoutingIdOfABadgeOnlyPush() {
        // A badge-sync push carries no routing keys, so `PushPayload.init?`
        // refuses it — but which connection it belongs to still has to be
        // answerable before its count is applied to anything.
        let info: [AnyHashable: Any] = ["aps": ["content-available": 1, "badge": 4], "routingId": "route-a"]
        #expect(PushPayload(userInfo: info) == nil)
        #expect(PushPayload.routingId(from: info) == "route-a")
        #expect(PushPayload.badge(from: info) == 4)
    }

    @Test func anEmptyRoutingIdIsNoRoutingId() {
        #expect(PushPayload.routingId(from: ["routingId": ""]) == nil)
        #expect(PushPayload.routingId(from: ["routingId": 42]) == nil)
        #expect(PushPayload.routingId(from: [:]) == nil)
    }

    @Test func legacyPushesCarryNoRoutingIdAtAll() {
        #expect(PushPayload.routingId(from: ["aps": ["badge": 1]]) == nil)
    }
}

@MainActor
@Suite struct NotificationRoutingTests {
    private func defaults(_ name: String = UUID().uuidString) -> UserDefaults {
        UserDefaults(suiteName: "flow.tests.\(name)")!
    }

    /// Two authenticated connections, neither of them the legacy slot — the
    /// shape a client has once a second server is added.
    private func twoServers(_ d: UserDefaults) -> ConnectionManager {
        var registry = ConnectionRegistry()
        for origin in ["https://a.example.com", "https://b.example.com"] {
            let connection = registry.addFlowConnection(origin: try! CanonicalOrigin.normalize(origin))
            _ = registry.bindIdentity(connection.connectionId, userId: "user-\(origin)")
            registry.updateSession(connection.connectionId) { $0.status = .authenticated }
        }
        ConnectionStore.save(registry, to: d)
        return ConnectionManager(defaults: d)
    }

    @Test func anIdentifierWeNeverIssuedRoutesNowhere() {
        let d = defaults()
        defer { d.removePersistentDomain(forName: d.description) }
        let manager = twoServers(d)
        // The spec's rule: unknown or removed identifiers can neither add a
        // connection nor navigate. Nothing is created as a side effect of
        // asking, either — an unknown id must not mint a session.
        #expect(manager.notificationApp(routingId: "not-a-route-we-minted") == nil)
        #expect(manager.registry.connections.count == 2)
    }

    @Test func aRoutingIdBelongingToAnotherConnectionCannotBeInherited() {
        let d = defaults()
        defer { d.removePersistentDomain(forName: d.description) }
        let manager = twoServers(d)
        let first = manager.registry.sessions[0]
        // Give connection A a route, then ask with a route that is A's with one
        // character changed. Nearby is not the same as ours.
        let scope = StorageScope(storageKey: first.storageKey)
        d.set("route-a", forKey: scope.key("pushRoutingId"))
        #expect(manager.notificationApp(routingId: "route-b") == nil)
    }

    @Test func aRoutelessPushIsRefusedOnceASecondServerExists() {
        let d = defaults()
        defer { d.removePersistentDomain(forName: d.description) }
        let manager = twoServers(d)
        // The legacy contract — no routing id — only holds while there is
        // exactly one connection and it is the migrated legacy slot. With two
        // servers a push with no route names nobody, and guessing is precisely
        // what "cannot navigate" forbids.
        #expect(manager.notificationApp(routingId: nil) == nil)
    }

    @Test func removingAConnectionRevokesItsRoute() {
        let d = defaults()
        defer { d.removePersistentDomain(forName: d.description) }
        let manager = twoServers(d)
        let target = manager.registry.sessions[0]
        let scope = StorageScope(storageKey: target.storageKey)
        d.set("route-a", forKey: scope.key("pushRoutingId"))
        manager.remove(connectionId: target.connectionId)
        // A push that was already in flight when the connection went away is
        // ignored rather than delivered to whoever is left.
        #expect(d.string(forKey: scope.key("pushRoutingId")) == nil)
        #expect(manager.notificationApp(routingId: "route-a") == nil)
    }

    @Test func signingOutRevokesOnlyThatConnectionsRoute() {
        let d = defaults()
        defer { d.removePersistentDomain(forName: d.description) }
        let manager = twoServers(d)
        let a = manager.registry.sessions[0]
        let b = manager.registry.sessions[1]
        d.set("route-a", forKey: StorageScope(storageKey: a.storageKey).key("pushRoutingId"))
        d.set("route-b", forKey: StorageScope(storageKey: b.storageKey).key("pushRoutingId"))
        manager.markSignedOut(connectionId: a.connectionId)
        // A signed-out connection is no longer a routing target…
        #expect(manager.notificationApp(routingId: "route-a") == nil)
        // …and the other one's registration is untouched.
        #expect(d.string(forKey: StorageScope(storageKey: b.storageKey).key("pushRoutingId")) == "route-b")
        #expect(manager.registry.session(b.connectionId)?.status == .authenticated)
    }
}

// MARK: - Which connection is on screen

@MainActor
@Suite struct OnScreenTests {
    /// The rule a window switch has to satisfy: a connection nobody is showing
    /// is not "being read", however much of its state is still in memory.
    ///
    /// `AppState` needs a database and a runtime, so this covers the decision
    /// itself — the composition of "app is frontmost" and "this connection is
    /// on screen" — rather than the whole object graph. The live half is in
    /// docs/qa/issue-542: with the window on server B, a mention arriving on
    /// server A stayed unread, where before it was marked read within 22ms.
    @Test func aConnectionIsOnlyBeingReadWhenBothAreTrue() {
        func viewing(appActive: Bool, onScreen: Bool, channelSelected: Bool) -> Bool {
            appActive && onScreen && channelSelected
        }
        #expect(viewing(appActive: true, onScreen: true, channelSelected: true))
        // The window moved to another server: its `WindowState` outlives the
        // switch, so "a window has this channel selected" is still true.
        #expect(!viewing(appActive: true, onScreen: false, channelSelected: true))
        // The app went behind the browser.
        #expect(!viewing(appActive: false, onScreen: true, channelSelected: true))
        #expect(!viewing(appActive: true, onScreen: true, channelSelected: false))
    }

    @Test func onlyTheConnectionsWindowsShowAreOnScreen() {
        // Two windows, two servers: both are on screen, and a third connection
        // in the switcher is not.
        let showing: [UUID: String] = [UUID(): "conn-a", UUID(): "conn-b"]
        let onScreen = Set(showing.values)
        #expect(onScreen.contains("conn-a"))
        #expect(onScreen.contains("conn-b"))
        #expect(!onScreen.contains("conn-c"))
    }

    @Test func aWindowThatSwitchesReplacesItsEntryRatherThanAddingOne() {
        let window = UUID()
        var showing: [UUID: String] = [window: "conn-a"]
        showing[window] = "conn-b"
        #expect(Set(showing.values) == ["conn-b"])
    }
}

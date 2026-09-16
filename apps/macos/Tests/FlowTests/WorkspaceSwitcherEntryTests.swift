import Testing
@testable import Flow

/// One workspace list across every connection (#592 on web, ported): the rail,
/// the sidebar menu and the chooser all draw `switcherEntries`, so the rules
/// about what appears — and where it says it lives — are tested here once.
@Suite struct WorkspaceSwitcherEntryTests {
    private func workspace(_ id: String, _ name: String, slug: String? = nil, avatarUrl: String? = nil, unread: Int? = nil) -> Workspace {
        var ws = Workspace(
            id: id, slug: slug ?? id, name: name, createdBy: "u1", createdAt: "2026-09-15T00:00:00Z",
            role: "member", sidebarColor: nil, avatarUrl: avatarUrl
        )
        ws.unreadCount = unread
        return ws
    }

    /// Home (Flow), a Slack team and another Flow server, all authenticated.
    private func registry() -> ConnectionRegistry {
        var registry = ConnectionRegistry()
        registry.connections = [
            ServerConnection(connectionId: "home", provider: .flow, providerIdentity: "https://app.freeflow.im",
                             origin: "https://app.freeflow.im", label: "app.freeflow.im", apiVersion: 1, capabilities: [:], addedAt: .distantPast),
            ServerConnection(connectionId: "slack", provider: .slack, providerIdentity: #"["slack",null,"T1","U1"]"#,
                             origin: "https://slack.freeflow.im", label: "BizTrip · scottp", apiVersion: 1, capabilities: [:], addedAt: .distantPast),
            ServerConnection(connectionId: "other", provider: .flow, providerIdentity: "https://flow.example.com",
                             origin: "https://flow.example.com", label: "flow.example.com", apiVersion: 1, capabilities: [:], addedAt: .distantPast),
        ]
        registry.sessions = ["home": "u1", "slack": "U1", "other": "u9"].map { id, userId in
            ServerSession(connectionId: id, userId: userId, credentialRef: "ref.\(id)", storageKey: id, authGeneration: 0, status: .authenticated)
        }
        registry.bindings = [
            WorkspaceBinding(connectionId: "home", userId: "u1", workspaceId: "stale", name: "Stale binding"),
            WorkspaceBinding(connectionId: "slack", userId: "U1", workspaceId: "T1", name: "BizTrip", avatarUrl: "/v1/files/team-icon:T1"),
            WorkspaceBinding(connectionId: "other", userId: "u9", workspaceId: "w9", name: "Partner"),
            WorkspaceBinding(connectionId: "other", userId: "u9", workspaceId: "hid", name: "Hidden", hidden: true),
        ]
        return registry
    }

    @Test func listsSlackTeamsAndOtherServersBesideTheForegroundWorkspaces() {
        let entries = registry().switcherEntries(
            foregroundConnectionId: "home", foregroundWorkspaces: [workspace("w1", "Flow Home")]
        )
        #expect(entries.map(\.name) == ["Flow Home", "BizTrip", "Partner"])
        #expect(entries.map(\.source) == ["app.freeflow.im", "Slack", "flow.example.com"])
        #expect(entries.map(\.foreground) == [true, false, false])
        // A hidden workspace stays hidden, and the foreground connection's
        // stale binding gives way to its live list.
        #expect(!entries.contains { $0.name == "Hidden" || $0.name == "Stale binding" })
    }

    @Test func fallsBackToBindingsUntilTheForegroundListLoads() {
        let entries = registry().switcherEntries(foregroundConnectionId: "slack", foregroundWorkspaces: nil)
        #expect(entries.first { $0.foreground }?.name == "BizTrip")
        #expect(entries.map(\.name).contains("Stale binding"))
    }

    @Test func leavesOutConnectionsThatNeedSigningInAgain() {
        var registry = registry()
        registry.updateSession("other") { $0.status = .unauthorized }
        let entries = registry.switcherEntries(foregroundConnectionId: "home", foregroundWorkspaces: [])
        #expect(entries.map(\.connectionId) == ["slack"])
    }

    @Test func badgesComeFromEachConnectionsOwnCount() {
        let entries = registry().switcherEntries(
            foregroundConnectionId: "home",
            foregroundWorkspaces: [workspace("w1", "Flow Home", unread: 2)],
            // The foreground connection's aggregate counts notifications, not
            // the unread messages the rail shows: the live row still wins.
            unreadByWorkspace: ["other": ["w9": 3], "home": ["w1": 9]]
        )
        #expect(entries.first { $0.workspaceId == "w1" }?.unread == 2)
        #expect(entries.first { $0.workspaceId == "w9" }?.unread == 3)
        // Nothing known about the Slack team's count is not a zero guess — it
        // is simply no badge.
        #expect(entries.first { $0.workspaceId == "T1" }?.unread == 0)
    }

    @Test func rowsKeepTheirIdentifiersAndAvatarRules() {
        let entries = registry().switcherEntries(
            foregroundConnectionId: "home",
            foregroundWorkspaces: [workspace("w1", "Flow Home", slug: "flow-home", avatarUrl: "/v1/avatars/a1.webp")]
        )
        let home = entries[0]
        // The rail names a live row by its slug, as it always did.
        #expect(home.key == "flow-home")
        #expect(home.id == "home:w1")
        #expect(home.avatarImagePath == "/v1/avatars/a1.webp")
        #expect(home.role == "member")
        // A team icon is fetchable; a row we only know from a binding has no slug.
        let slack = try! #require(entries.first { $0.provider == .slack })
        #expect(slack.avatarImagePath == "/v1/files/team-icon:T1")
        #expect(slack.key == "T1")
        #expect(slack.role == nil)
    }

    @Test func namesTheSourceOnlyWhenThereIsMoreThanOnePlace() {
        let many = registry().switcherEntries(foregroundConnectionId: "home", foregroundWorkspaces: [workspace("w1", "A")])
        #expect(switcherShowsSource(many))
        var single = registry()
        single.connections = [single.connections[0]]
        let one = single.switcherEntries(
            foregroundConnectionId: "home", foregroundWorkspaces: [workspace("w1", "A"), workspace("w2", "B")]
        )
        #expect(!switcherShowsSource(one))
        #expect(one.count == 2)
    }

    // MARK: - Bindings kept in step with the live list

    @Test func recordsNamesAndAvatarsSoAnotherConnectionCanDrawThem() throws {
        let bindings = try #require(registry().syncedBindings(
            connectionId: "home", userId: "u1",
            workspaces: [workspace("w1", "Flow Home", avatarUrl: "/v1/avatars/a1.webp")]
        ))
        var next = registry()
        next.bindings = bindings
        #expect(next.bindings.filter { $0.connectionId == "home" }.map(\.name) == ["Flow Home"])
        // Seen from another connection, the row now carries its mark.
        let seen = try #require(next.switcherEntries(foregroundConnectionId: "slack").first { $0.workspaceId == "w1" })
        #expect(seen.avatarImagePath == "/v1/avatars/a1.webp")
        #expect(seen.name == "Flow Home")
    }

    @Test func keepsHiddenHiddenAndReportsNoChangeWhenNothingMoved() throws {
        let unchanged = registry().syncedBindings(
            connectionId: "other", userId: "u9", workspaces: [workspace("w9", "Partner"), workspace("hid", "Hidden")]
        )
        #expect(unchanged == nil)
        let renamed = try #require(registry().syncedBindings(
            connectionId: "other", userId: "u9", workspaces: [workspace("w9", "Partner Co"), workspace("hid", "Hidden")]
        ))
        #expect(renamed.first { $0.workspaceId == "w9" }?.name == "Partner Co")
        #expect(renamed.first { $0.workspaceId == "hid" }?.hidden == true)
        // Another connection's bindings are untouched.
        #expect(renamed.filter { $0.connectionId == "slack" } == registry().bindings.filter { $0.connectionId == "slack" })
    }

    @Test func dropsWorkspacesTheAccountHasLeft() throws {
        let next = try #require(registry().syncedBindings(connectionId: "other", userId: "u9", workspaces: [workspace("w9", "Partner")]))
        #expect(next.filter { $0.connectionId == "other" }.map(\.workspaceId) == ["w9"])
    }
}

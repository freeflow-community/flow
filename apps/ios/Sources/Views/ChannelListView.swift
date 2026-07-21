import SwiftUI
import GRDB

/// Sidebar equivalent: the active workspace's channels and DMs, plus a
/// workspace switcher and sign-out in the toolbar.
struct ChannelListView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var channels = DBObserved<[Channel]>(initial: [])
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])
    @StateObject private var users = DBObserved<[User]>(initial: [])

    private var usersById: [String: User] { Dictionary(users.value.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var standard: [Channel] { channels.value.filter { $0.kind == "standard" && $0.archivedAt == nil } }
    private var dms: [Channel] { channels.value.filter { $0.isDM } }
    private var workspaceName: String {
        workspaces.value.first { $0.id == app.selectedWorkspaceId }?.name ?? "Flow"
    }

    var body: some View {
        List {
            if !standard.isEmpty {
                Section("Channels") {
                    ForEach(standard) { ch in row(ch, title: "# \(ch.name ?? "channel")") }
                }
            }
            if !dms.isEmpty {
                Section("Direct Messages") {
                    ForEach(dms) { ch in
                        row(ch, title: ch.displayTitle(
                            userNames: usersById.mapValues { $0.displayNameWithBadge },
                            currentUserId: app.currentUser?.id))
                    }
                }
            }
            if standard.isEmpty && dms.isEmpty {
                Text("No channels yet").foregroundStyle(MC.muted)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(workspaceName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    ForEach(workspaces.value) { ws in
                        Button {
                            app.selectWorkspace(ws.id)
                        } label: {
                            Label(ws.name, systemImage: ws.id == app.selectedWorkspaceId ? "checkmark" : "")
                        }
                    }
                } label: { Image(systemName: "square.grid.2x2") }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let u = app.currentUser {
                        Text(u.displayName)
                        Text(u.email).font(.caption)
                    }
                    Divider()
                    Button("Sign Out", role: .destructive) {
                        Task { await app.engine.logout() }
                    }
                } label: { Image(systemName: "person.crop.circle") }
            }
        }
        .task {
            users.start(db: app.db) { try User.fetchAll($0) }
            reloadChannels()
        }
        .onChange(of: app.selectedWorkspaceId) { _, _ in reloadChannels() }
    }

    private func reloadChannels() {
        guard let wsId = app.selectedWorkspaceId else { return }
        channels.start(db: app.db, reset: []) { db in
            try Channel
                .filter(Column("workspaceId") == wsId && Column("isMember") == true)
                .order(Column("name"))
                .fetchAll(db)
        }
        workspaces.start(db: app.db) { try Workspace.order(Column("name")).fetchAll($0) }
    }

    @ViewBuilder
    private func row(_ ch: Channel, title: String) -> some View {
        NavigationLink(value: ch.id) {
            HStack {
                Text(title).foregroundStyle(MC.ink).lineLimit(1)
                Spacer()
                if ch.unreadCount > 0 {
                    Text("\(ch.unreadCount)")
                        .font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Capsule().fill(MC.unread))
                }
            }
        }
    }
}

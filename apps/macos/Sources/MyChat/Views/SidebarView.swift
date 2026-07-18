import GRDB
import SwiftUI

/// Row model for the members section (member ⋈ user).
struct MemberInfo: Decodable, FetchableRecord, Equatable, Sendable, Identifiable {
    var userId: String
    var displayName: String
    var role: String
    var id: String { userId }
}

struct SidebarView: View {
    @EnvironmentObject private var app: AppState
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])
    @StateObject private var channels = DBObserved<[Channel]>(initial: [])
    @StateObject private var members = DBObserved<[MemberInfo]>(initial: [])

    @State private var showCreateChannel = false
    @State private var showInvite = false
    @State private var showCreateWorkspace = false
    @State private var showAcceptInvite = false

    private var currentWorkspace: Workspace? {
        workspaces.value.first { $0.id == app.selectedWorkspaceId }
    }

    private var joinedChannels: [Channel] {
        channels.value.filter(\.isMember)
    }

    private var browsableChannels: [Channel] {
        channels.value.filter { !$0.isMember && !$0.isPrivate }
    }

    var body: some View {
        VStack(spacing: 0) {
            workspaceMenu
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            Divider()

            List(selection: Binding(
                get: { app.selectedChannelId },
                set: { app.selectChannel($0) }
            )) {
                Section("Channels") {
                    ForEach(joinedChannels) { channel in
                        HStack(spacing: 6) {
                            Image(systemName: channel.isPrivate ? "lock" : "number")
                                .foregroundStyle(.secondary)
                                .frame(width: 14)
                            Text(channel.name)
                                .fontWeight(channel.unreadCount > 0 ? .bold : .regular)
                            Spacer()
                            if channel.unreadCount > 0 {
                                Text("\(channel.unreadCount)")
                                    .font(.caption2.bold())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(.red))
                                    .foregroundStyle(.white)
                            }
                        }
                        .tag(Optional(channel.id))
                    }
                }

                if !browsableChannels.isEmpty {
                    Section("Browse") {
                        ForEach(browsableChannels) { channel in
                            HStack(spacing: 6) {
                                Image(systemName: "number")
                                    .foregroundStyle(.tertiary)
                                    .frame(width: 14)
                                Text(channel.name)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button("Join") {
                                    Task {
                                        do {
                                            let ch = try await app.engine.joinChannel(channel.id)
                                            app.selectChannel(ch.id)
                                        } catch {
                                            app.showError(error.localizedDescription)
                                        }
                                    }
                                }
                                .buttonStyle(.borderless)
                                .font(.caption)
                            }
                        }
                    }
                }

                Section("Members") {
                    ForEach(members.value) { member in
                        HStack(spacing: 6) {
                            Circle()
                                .fill(app.presence[member.userId] == true ? .green : Color.gray.opacity(0.5))
                                .frame(width: 8, height: 8)
                            Text(member.displayName)
                                .lineLimit(1)
                            if member.userId == app.currentUser?.id {
                                Text("(you)").font(.caption2).foregroundStyle(.tertiary)
                            }
                            Spacer()
                            if member.role != "member" {
                                Text(member.role)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .selectionDisabled()
                    }
                }
            }
            .listStyle(.sidebar)

            Divider()
            HStack(spacing: 6) {
                Circle()
                    .fill(app.connection == .connected ? .green : .orange)
                    .frame(width: 7, height: 7)
                Text(app.connection.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    showCreateChannel = true
                } label: {
                    Image(systemName: "plus.circle")
                }
                .buttonStyle(.borderless)
                .help("Create a channel")
            }
            .padding(8)
        }
        .task {
            workspaces.start(db: app.db) { db in
                try Workspace.order(Column("name").collating(.nocase)).fetchAll(db)
            }
        }
        .task(id: app.selectedWorkspaceId) {
            guard let wsId = app.selectedWorkspaceId else { return }
            channels.start(db: app.db, reset: []) { db in
                try Channel
                    .filter(Column("workspaceId") == wsId && Column("archivedAt") == nil)
                    .order(Column("name").collating(.nocase))
                    .fetchAll(db)
            }
            members.start(db: app.db, reset: []) { db in
                try MemberInfo.fetchAll(
                    db,
                    sql: """
                        SELECT m.userId AS userId, u.displayName AS displayName, m.role AS role
                        FROM member m JOIN user u ON u.id = m.userId
                        WHERE m.workspaceId = ?
                        ORDER BY u.displayName COLLATE NOCASE
                        """,
                    arguments: [wsId]
                )
            }
        }
        .sheet(isPresented: $showCreateChannel) {
            if let wsId = app.selectedWorkspaceId {
                CreateChannelSheet(workspaceId: wsId)
            }
        }
        .sheet(isPresented: $showInvite) {
            if let wsId = app.selectedWorkspaceId {
                InviteSheetView(workspaceId: wsId)
            }
        }
        .sheet(isPresented: $showCreateWorkspace) { CreateWorkspaceSheet() }
        .sheet(isPresented: $showAcceptInvite) { AcceptInviteSheet() }
    }

    private var workspaceMenu: some View {
        Menu {
            ForEach(workspaces.value) { ws in
                Button {
                    app.selectWorkspace(ws.id)
                } label: {
                    if ws.id == app.selectedWorkspaceId {
                        Label(ws.name, systemImage: "checkmark")
                    } else {
                        Text(ws.name)
                    }
                }
            }
            Divider()
            Button("Create Workspace…") { showCreateWorkspace = true }
            Button("Accept Invite…") { showAcceptInvite = true }
            Button("Invite People…") { showInvite = true }
            Divider()
            Button("All Workspaces") { app.selectWorkspace(nil) }
            Button("Sign Out") {
                Task { await app.engine.logout() }
            }
        } label: {
            HStack {
                Text(currentWorkspace?.name ?? "Workspace")
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.caption)
            }
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
    }
}

struct CreateChannelSheet: View {
    let workspaceId: String
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var topic = ""
    @State private var isPrivate = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Create Channel").font(.headline)
            TextField("Name (lowercase, a-z 0-9 - _)", text: $name)
                .textFieldStyle(.roundedBorder)
            TextField("Topic (optional)", text: $topic)
                .textFieldStyle(.roundedBorder)
            Toggle("Private channel", isOn: $isPrivate)
            if let error {
                Text(error).font(.callout).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Create") {
                    busy = true
                    error = nil
                    Task {
                        defer { busy = false }
                        do {
                            let normalized = name.lowercased()
                                .replacingOccurrences(of: " ", with: "-")
                            let ch = try await app.engine.createChannel(
                                workspaceId: workspaceId,
                                name: normalized,
                                topic: topic.isEmpty ? nil : topic,
                                isPrivate: isPrivate
                            )
                            dismiss()
                            app.selectChannel(ch.id)
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 360)
    }
}

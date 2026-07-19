import GRDB
import SwiftUI

struct WorkspaceSwitcherView: View {
    @EnvironmentObject private var app: AppState
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])
    @State private var showCreate = false
    @State private var showAcceptInvite = false

    var body: some View {
        VStack(spacing: 16) {
            Text("Choose a Workspace")
                .font(.title.bold())
                .padding(.top, 24)

            if workspaces.value.isEmpty {
                Text("You're not in any workspace yet.\nCreate one, or accept an invite.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            } else {
                List(workspaces.value) { ws in
                    Button {
                        app.selectWorkspace(ws.id)
                    } label: {
                        HStack {
                            RoundedRectangle(cornerRadius: 6)
                                .fill(.tint)
                                .frame(width: 32, height: 32)
                                .overlay(
                                    Text(String(ws.name.prefix(1)).uppercased())
                                        .font(.headline)
                                        .foregroundStyle(.white)
                                )
                            VStack(alignment: .leading) {
                                Text(ws.name).font(.headline)
                                Text(ws.slug).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let role = ws.role {
                                Text(role)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Image(systemName: "chevron.right")
                                .foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 2)
                }
                .frame(maxWidth: 440)
                .scrollContentBackground(.hidden)
            }

            HStack(spacing: 12) {
                Button("Create Workspace…") { showCreate = true }
                Button("Accept Invite…") { showAcceptInvite = true }
            }

            Button("Sign Out", role: .destructive) {
                Task { await app.engine.logout() }
            }
            .buttonStyle(.link)
            .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            await app.engine.refreshWorkspaces()
            workspaces.start(db: app.db) { db in
                try Workspace.order(Column("name").collating(.nocase)).fetchAll(db)
            }
        }
        .sheet(isPresented: $showCreate) { CreateWorkspaceSheet() }
        .sheet(isPresented: $showAcceptInvite) { AcceptInviteSheet() }
    }
}

struct CreateWorkspaceSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var slug = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Create Workspace").font(.headline)
            TextField("Name (e.g. Acme Inc)", text: $name)
                .textFieldStyle(.roundedBorder)
                .onChange(of: name) { _, new in
                    slug = Self.slugify(new)
                }
            TextField("Slug (url-safe, immutable)", text: $slug)
                .textFieldStyle(.roundedBorder)
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
                            let ws = try await app.engine.createWorkspace(name: name, slug: slug)
                            dismiss()
                            app.selectWorkspace(ws.id)
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || name.isEmpty || slug.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 360)
    }

    static func slugify(_ s: String) -> String {
        s.lowercased()
            .map { $0.isLetter || $0.isNumber ? String($0) : "-" }
            .joined()
            .replacingOccurrences(of: "-+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }
}

struct AcceptInviteSheet: View {
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var tokenText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Accept Invite").font(.headline)
            Text("Paste an invite token or a full flow://invite/… link.")
                .font(.callout)
                .foregroundStyle(.secondary)
            TextField("flow://invite/… or token", text: $tokenText)
                .textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Accept") {
                    app.acceptInvite(tokenText)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(tokenText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 400)
    }
}

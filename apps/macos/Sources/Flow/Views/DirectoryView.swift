import GRDB
import SwiftUI

/// The Directory (#432) — the macOS twin of the web client's `DirectoryView`
/// (#430): a browsable grid of everyone in the workspace, with a search box
/// that narrows by name as you type. Reached from the sidebar entry under
/// Direct messages and from the workspace menu.
///
/// Same "covers the content pane, the channel stays selected behind it" shape
/// as the Activity feed and the Scheduled panel, which is what puts it in the
/// back/forward history for free.
///
/// Clicking a card opens `MemberProfileSheet` — the card the app already has,
/// which is where Message lives, so starting a DM from here needed nothing new.
struct DirectoryView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    @StateObject private var rows = DBObserved<[DirectoryRow]>(initial: [])
    @State private var query = ""
    /// Distinguishes "the cache is empty because the fetch hasn't landed" from
    /// "this workspace really has nobody in it" — two different things to say.
    @State private var loading = true
    @State private var profileUserId: String?

    private var shown: [DirectoryRow] { Directory.filter(rows.value, query: query) }

    /// userId → display name, for resolving an agent's sponsor off the same
    /// roster rather than one fetch per card.
    private var namesById: [String: String] {
        Dictionary(uniqueKeysWithValues: rows.value.map { ($0.userId, $0.displayName) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            searchBar
            Divider().opacity(0.5)
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(MC.base)
        .task(id: win.selectedWorkspaceId) {
            guard let wsId = win.selectedWorkspaceId else {
                rows.stop()
                loading = false
                return
            }
            loading = true
            rows.start(db: app.db, reset: []) { db in
                try DirectoryRow.fetchAll(
                    db, sql: DirectoryRow.rosterSQL,
                    arguments: [wsId]
                )
            }
            // The observation serves the cache immediately; this refreshes it
            // behind the grid, and is also what fills in `sponsorId` for a
            // client whose cache predates it being carried on the roster.
            await app.engine.refreshMembers(workspaceId: wsId)
            loading = false
        }
        .sheet(item: Binding(
            get: { profileUserId.map { ProfileTarget(userId: $0) } },
            set: { profileUserId = $0?.userId }
        )) { target in
            MemberProfileSheet(userId: target.userId)
        }
    }

    // MARK: - Chrome

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text("👥").foregroundStyle(MC.muted)
                    Text("Directory")
                }
                .flowFont(size: 15, weight: .bold)
                .accessibilityIdentifier("directory.header")
                Text("Everyone in this workspace")
                    .flowFont(.caption)
                    .foregroundStyle(MC.muted)
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 22)
        .frame(height: 60)
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            TextField("Search people…", text: $query)
                .textFieldStyle(.roundedBorder)
                .flowFont(.callout)
                .frame(maxWidth: 280)
                .accessibilityIdentifier("directory.search")
                .accessibilityLabel("Search people")
            Spacer()
            Text(Directory.countLabel(shown.count))
                .flowFont(.caption2)
                .foregroundStyle(MC.faint)
                .accessibilityIdentifier("directory.count")
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 7)
    }

    @ViewBuilder
    private var content: some View {
        if let state = Directory.emptyState(
            total: rows.value.count, shown: shown.count, loading: loading, query: query
        ) {
            Text(state.message)
                .flowFont(.callout)
                .foregroundStyle(MC.faint)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier(
                    state == .loading ? "directory.loading" : "directory.empty"
                )
        } else {
            ScrollView {
                // `adaptive` rather than a fixed column count: the pane is
                // resizable and shares the window with the sidebar and the side
                // panel, so the grid has to reflow rather than clip.
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 220), spacing: 12, alignment: .top)],
                    alignment: .leading,
                    spacing: 12
                ) {
                    ForEach(shown) { member in
                        card(member)
                    }
                }
                .padding(16)
            }
            .accessibilityIdentifier("directory.grid")
        }
    }

    // MARK: - Card

    private func card(_ m: DirectoryRow) -> some View {
        let online = app.isOnline(m.userId, in: win.selectedWorkspaceId)
        let contact = Directory.contactLine(
            m, sponsorName: m.sponsorId.flatMap { namesById[$0] }
        )
        return Button {
            profileUserId = m.userId
        } label: {
            HStack(alignment: .top, spacing: 10) {
                avatar(m, online: online)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 3) {
                        Text(m.displayName)
                            .flowFont(.callout, weight: .bold)
                            .foregroundStyle(MC.ink)
                            .lineLimit(1)
                        if m.userId == app.currentUser?.id {
                            Text("(you)").flowFont(.caption).foregroundStyle(MC.faint)
                        }
                        if m.isAgent == true {
                            Text("🤖").flowFont(.caption).help("AI agent")
                        }
                    }
                    // #434: the member's own line, under the name and above the
                    // role. Absent when unset — no reserved blank line.
                    if let title = Directory.titleLine(m) {
                        Text(title)
                            .flowFont(.caption)
                            .foregroundStyle(MC.inkSoft)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .help(title)
                            .accessibilityIdentifier("directory.card.title")
                    }
                    Text(Directory.kindLabel(m))
                        .flowFont(.caption)
                        .foregroundStyle(MC.muted)
                        .lineLimit(1)
                    if let status = statusLine(m) {
                        Text(status)
                            .flowFont(.caption)
                            .foregroundStyle(MC.inkSoft)
                            .lineLimit(1)
                            .padding(.top, 2)
                    }
                    if !contact.isEmpty {
                        Text(contact)
                            .flowFont(.caption2)
                            .foregroundStyle(MC.faint)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .padding(.top, 2)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(MC.chat))
            .overlay(
                RoundedRectangle(cornerRadius: 12).strokeBorder(MC.hairline2, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .help("Open \(m.displayName)’s profile")
        .accessibilityIdentifier("directory.card.\(m.displayName)")
        .accessibilityValue(online ? "online" : "offline")
    }

    private func statusLine(_ m: DirectoryRow) -> String? {
        let line = "\(m.statusEmoji ?? "") \(m.statusText ?? "")"
            .trimmingCharacters(in: .whitespaces)
        return line.isEmpty ? nil : line
    }

    private func avatar(_ m: DirectoryRow, online: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        return Group {
            if let path = m.avatarUrl, path.hasPrefix("/v1/avatars/") {
                AuthImage(path: path) { shape.fill(MC.hairline) }
                    .scaledToFill()
                    .frame(width: 44, height: 44)
                    .clipShape(shape)
            } else {
                shape
                    .fill(MC.hairline)
                    .frame(width: 44, height: 44)
                    .overlay(
                        Text(initials(m.displayName))
                            .flowFont(.callout, weight: .bold)
                            .foregroundStyle(MC.inkSoft)
                    )
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Circle()
                .fill(online ? MC.online : MC.hairline2)
                .frame(width: 12, height: 12)
                .overlay(Circle().strokeBorder(MC.chat, lineWidth: 2))
                .offset(x: 3, y: 3)
        }
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

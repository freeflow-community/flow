import GRDB
import SwiftUI

/// The Directory (#432) — the iOS twin of the web client's `DirectoryView`
/// (#430) and the macOS `DirectoryView`: a browsable grid of everyone in the
/// workspace, narrowed by a search field.
///
/// It takes the content pane the way the Activity feed and the Scheduled list
/// do (`app.showDirectory`), so on iOS it *is* the screen — reached from the
/// drawer's Directory row under Direct Messages, or the workspace menu — rather
/// than a pane beside a conversation. Tapping a card presents the app's
/// existing `MemberProfileSheet`, which is where Message lives, so starting a
/// DM from here needed nothing new.
///
/// The filter, the labels, the sponsor line and the three empty states are the
/// shared `Directory` model, so the phone narrows, sorts and labels exactly as
/// the Mac and the browser do.
struct DirectoryScreen: View {
    @EnvironmentObject private var app: AppState

    @StateObject private var rows = DBObserved<[DirectoryRow]>(initial: [])
    @State private var query = ""
    /// Distinguishes "the cache is empty because the fetch hasn't landed" from
    /// "this workspace really has nobody in it" — two different things to say.
    @State private var loading = true
    @State private var profileRoute: ProfileRoute?

    private var shown: [DirectoryRow] { Directory.filter(rows.value, query: query) }

    /// userId → display name, for resolving an agent's sponsor off the same
    /// roster rather than one fetch per card.
    private var namesById: [String: String] {
        Dictionary(uniqueKeysWithValues: rows.value.map { ($0.userId, $0.displayName) })
    }

    var body: some View {
        VStack(spacing: 0) {
            searchBar
            content
        }
        .background(MC.base)
        .navigationTitle("Directory")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: app.selectedWorkspaceId) {
            guard let wsId = app.selectedWorkspaceId else {
                loading = false
                return
            }
            loading = true
            rows.start(db: app.db, reset: []) { db in
                try DirectoryRow.fetchAll(db, sql: DirectoryRow.rosterSQL, arguments: [wsId])
            }
            // The observation serves the cache immediately; this refreshes it
            // behind the grid, and is also what fills in `sponsorId` for a
            // client whose cache predates it riding on the roster.
            await app.engine.refreshMembers(workspaceId: wsId)
            loading = false
        }
        .sheet(item: $profileRoute) { route in
            MemberProfileSheet(userId: route.userId)
        }
    }

    /// Search field and live count, pinned under the title — the same row macOS
    /// and web draw.
    ///
    /// A plain `TextField` rather than `.searchable`: on iOS 26 the system field
    /// only takes the navigation bar when the view also declares a toolbar item,
    /// and otherwise drops to a floating bar at the bottom of the screen, over
    /// the last card. Rather than hold a system affordance in a particular
    /// position by accident, the Directory draws the field it means to draw —
    /// which also keeps the three clients' layouts the same.
    private var searchBar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14))
                    .foregroundStyle(MC.muted)
                TextField("Search people…", text: $query)
                    .font(.system(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .accessibilityIdentifier("directory.search")
                    .accessibilityLabel("Search people")
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(MC.muted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 10).fill(MC.chat))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(MC.hairline2, lineWidth: 1))

            Text(Directory.countLabel(shown.count))
                .font(.system(size: 13))
                .foregroundStyle(MC.muted)
                .fixedSize()
                .accessibilityIdentifier("directory.count")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var content: some View {
        if let state = Directory.emptyState(
            total: rows.value.count, shown: shown.count, loading: loading, query: query
        ) {
            Text(state.message)
                .font(.system(size: 15))
                .foregroundStyle(MC.faint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier(
                    state == .loading ? "directory.loading" : "directory.empty"
                )
        } else {
            ScrollView {
                // Adaptive rather than a fixed column count: one column on a
                // phone in portrait, two or three on a wide phone or an iPad.
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 260), spacing: 10, alignment: .top)],
                    alignment: .leading,
                    spacing: 10
                ) {
                    ForEach(shown) { member in
                        card(member)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 14)
            }
            .accessibilityIdentifier("directory.grid")
        }
    }

    // MARK: - Card

    private func card(_ m: DirectoryRow) -> some View {
        let online = app.isOnline(m.userId, in: app.selectedWorkspaceId)
        let contact = Directory.contactLine(m, sponsorName: m.sponsorId.flatMap { namesById[$0] })
        return Button {
            profileRoute = ProfileRoute(userId: m.userId)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                avatar(m, online: online)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 3) {
                        Text(m.displayName)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(MC.ink)
                            .lineLimit(1)
                        if m.userId == app.currentUser?.id {
                            Text("(you)")
                                .font(.system(size: 13))
                                .foregroundStyle(MC.faint)
                        }
                        if m.isAgent == true {
                            Text("🤖").font(.system(size: 13))
                        }
                    }
                    // #434: the member's own line, under the name and above the
                    // role. Absent when unset — no reserved blank line.
                    if let title = Directory.titleLine(m) {
                        Text(title)
                            .font(.system(size: 13))
                            .foregroundStyle(MC.inkSoft)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    Text(Directory.kindLabel(m))
                        .font(.system(size: 13))
                        .foregroundStyle(MC.muted)
                        .lineLimit(1)
                    if let status = statusLine(m) {
                        Text(status)
                            .font(.system(size: 13))
                            .foregroundStyle(MC.inkSoft)
                            .lineLimit(1)
                            .padding(.top, 2)
                    }
                    if !contact.isEmpty {
                        Text(contact)
                            .font(.system(size: 12))
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
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(MC.hairline2, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
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
        // Fall back to the app's cached avatar map, so a face already on screen
        // in a conversation doesn't redraw as a placeholder here.
        let path = [m.avatarUrl, app.avatarPaths[m.userId]]
            .compactMap { $0 }
            .first { $0.hasPrefix("/v1/avatars/") }
        return Group {
            if let path {
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
                            .font(.system(size: 15, weight: .bold))
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
        let letters = name.split(separator: " ").prefix(2)
            .compactMap { $0.first }
            .map(String.init)
            .joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }
}

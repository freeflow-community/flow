import GRDB
import SwiftUI

/// A person the picker can start a DM with — the `member ⋈ user` join macOS
/// reads into `MemberInfo` (`SidebarView.swift:5`). That type lives in an
/// AppKit-only Views file which the iOS target excludes, so the row model is
/// declared again here rather than moved: the two clients read the same two
/// tables, which is what has to stay in step.
struct DmCandidate: Decodable, FetchableRecord, Equatable, Sendable, Identifiable {
    var userId: String
    var displayName: String
    var isAgent: Bool?
    var id: String { userId }
}

/// Start a direct message (#257) — the iOS counterpart of macOS's `NewDMSheet`
/// (`PeopleViews.swift:6`). Until this existed, an iOS-only user could reach a
/// DM only after another client created it or the other person wrote first.
///
/// Multi-select, because `createDm` takes `userIds: [String]` and a group DM is
/// a real thing on every other client; the 8-person cap is macOS's, kept
/// identical so the two clients can't disagree about what is creatable.
///
/// Picking someone who already has a DM is not a special case: the server route
/// is an upsert that "returns the existing channel for this member set or
/// creates it", so the sheet simply opens the existing conversation. There is
/// deliberately no client-side pre-check — it would only be a second, staler
/// answer to a question the server already settles.
struct NewDmSheet: View {
    let workspaceId: String
    /// Called with the DM's channel id once the server has answered.
    let onCreated: (String) -> Void

    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var candidates = DBObserved<[DmCandidate]>(initial: [])
    @State private var query = ""
    @State private var selected: Set<String> = []
    @State private var busy = false
    @State private var error: String?

    /// macOS's group-DM cap.
    private static let maxMembers = 8

    /// Everyone in the workspace except me. Your own DM is the self-DM, which
    /// the drawer already keeps pinned at the foot of the list.
    private var people: [DmCandidate] {
        let me = app.currentUser?.id
        let needle = query.trimmingCharacters(in: .whitespaces)
        return candidates.value.filter { person in
            guard person.userId != me else { return false }
            guard !needle.isEmpty else { return true }
            return person.displayName.range(of: needle, options: .caseInsensitive) != nil
        }
    }

    private var canCreate: Bool {
        !busy && !selected.isEmpty && selected.count <= Self.maxMembers
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField
                Divider()
                list
            }
            .background(MC.base)
            .navigationTitle(selected.count > 1 ? "New Group DM" : "New Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Start") { create() }
                        .disabled(!canCreate)
                        .accessibilityIdentifier("newDm.create")
                }
            }
        }
        .task {
            candidates.start(db: app.db, reset: []) { db in
                try DmCandidate.fetchAll(
                    db,
                    sql: """
                        SELECT m.userId AS userId, u.displayName AS displayName,
                               u.isAgent AS isAgent
                        FROM member m JOIN user u ON u.id = m.userId
                        WHERE m.workspaceId = ?
                        ORDER BY u.displayName COLLATE NOCASE
                        """,
                    arguments: [workspaceId]
                )
            }
        }
        // QA hook: select those people and press Start, through this sheet's
        // own create path — so a broken sheet still fails the check.
        .modifier(DebugNewDmCreate(app: app) { ids in
            selected = Set(ids)
            create(userIds: ids)
        })
    }

    // MARK: - Pieces

    /// The identifier sits on the `TextField` itself, not on the row around it:
    /// an identifier on a container makes XCUITest treat the whole thing as one
    /// element and hides the field inside it.
    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundStyle(MC.faint)
            TextField("Search people", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("newDm.search")
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(MC.faint)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("newDm.clearSearch")
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder private var list: some View {
        if let error {
            Text(error)
                .font(.system(size: 13))
                .foregroundStyle(.red)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .accessibilityIdentifier("newDm.error")
        }
        if people.isEmpty {
            Text(query.isEmpty ? "No one else is in this workspace yet." : "No one matches “\(query)”.")
                .font(.system(size: 14))
                .foregroundStyle(MC.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(MC.base)
        } else {
            List(people) { person in
                row(person)
                    .listRowBackground(MC.base)
            }
            .listStyle(.plain)
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func row(_ person: DmCandidate) -> some View {
        let on = selected.contains(person.userId)
        return Button {
            toggle(person.userId)
        } label: {
            HStack(spacing: 10) {
                AvatarChip(
                    userId: person.userId,
                    name: person.displayName,
                    avatarPath: avatarPath(person.userId),
                    size: 34,
                    radius: 10
                )
                Text(person.displayName + (person.isAgent == true ? " 🤖" : ""))
                    .font(.system(size: 15, weight: on ? .semibold : .regular))
                    .foregroundStyle(MC.ink)
                    .lineLimit(1)
                if app.isOnline(person.userId, in: workspaceId) {
                    Circle().fill(MC.online).frame(width: 8, height: 8)
                }
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 19))
                    .foregroundStyle(on ? MC.accent : MC.faint)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("newDm.user.\(person.userId)")
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    private func avatarPath(_ userId: String) -> String? {
        let path = app.avatarPaths[userId]
        return path?.hasPrefix("/v1/avatars/") == true ? path : nil
    }

    // MARK: - Actions

    private func toggle(_ userId: String) {
        if selected.contains(userId) {
            selected.remove(userId)
        } else if selected.count < Self.maxMembers {
            selected.insert(userId)
        } else {
            error = "A group DM holds at most \(Self.maxMembers) people."
        }
    }

    private func create() { create(userIds: Array(selected)) }

    private func create(userIds: [String]) {
        guard !userIds.isEmpty else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let ch = try await app.engine.createDm(workspaceId: workspaceId, userIds: userIds)
                dismiss()
                onCreated(ch.id)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

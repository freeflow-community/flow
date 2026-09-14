import GRDB
import SwiftUI

/// Add workspace members to a channel — the iOS counterpart of macOS's
/// `AddMemberSheet` (`PeopleViews.swift`) and web's "Invite to channel" list
/// in the channel modal. Until this existed the phone could only get *you*
/// into a public channel (Browse → Join); bringing someone else in meant
/// opening another client.
///
/// The list is the workspace roster minus people already in the channel
/// (`GET /v1/channels/:id/members`, the same fetch web and macOS use) and
/// minus me. Each row has its own Add button and flips to a checkmark on
/// success, so several people can be added without closing the sheet. The
/// server is the authority on who may add whom (private channels: members
/// only) — a refusal shows as the error line, not as a hidden row.
struct InviteToChannelSheet: View {
    let channel: Channel

    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @StateObject private var roster = DBObserved<[DmCandidate]>(initial: [])
    /// Who is in the channel already. `nil` until the server has answered —
    /// the list shows a spinner rather than a roster that is about to shrink.
    @State private var memberIds: Set<String>?
    @State private var query = ""
    @State private var busy: Set<String> = []
    @State private var added: Set<String> = []
    @State private var error: String?

    private var candidates: [DmCandidate] {
        let me = app.currentUser?.id
        let inChannel = memberIds ?? []
        let needle = query.trimmingCharacters(in: .whitespaces)
        return roster.value.filter { person in
            guard person.userId != me else { return false }
            // Keep the ones added from this sheet so their checkmark stays.
            guard !inChannel.contains(person.userId) || added.contains(person.userId) else { return false }
            guard !needle.isEmpty else { return true }
            return person.displayName.range(of: needle, options: .caseInsensitive) != nil
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField
                Divider()
                list
            }
            .background(MC.base)
            .navigationTitle("Invite to #\(channel.name ?? "")")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("inviteChannel.done")
                }
            }
        }
        .task {
            roster.start(db: app.db, reset: []) { db in
                try DmCandidate.fetchAll(
                    db,
                    sql: """
                        SELECT m.userId AS userId, u.displayName AS displayName,
                               u.isAgent AS isAgent
                        FROM member m JOIN user u ON u.id = m.userId
                        WHERE m.workspaceId = ?
                        ORDER BY u.displayName COLLATE NOCASE
                        """,
                    arguments: [channel.workspaceId]
                )
            }
            memberIds = Set(await app.engine.channelMemberIds(channelId: channel.id))
        }
    }

    // MARK: - Pieces

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundStyle(MC.faint)
            TextField("Search people", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("inviteChannel.search")
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(MC.faint)
                }
                .buttonStyle(.plain)
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
                .accessibilityIdentifier("inviteChannel.error")
        }
        if memberIds == nil {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(MC.base)
        } else if candidates.isEmpty {
            Text(query.isEmpty ? "Everyone is here." : "No one matches “\(query)”.")
                .font(.system(size: 14))
                .foregroundStyle(MC.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(MC.base)
                .accessibilityIdentifier("inviteChannel.empty")
        } else {
            List(candidates) { person in
                row(person)
                    .listRowBackground(MC.base)
            }
            .listStyle(.plain)
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func row(_ person: DmCandidate) -> some View {
        HStack(spacing: 10) {
            AvatarChip(
                userId: person.userId,
                name: person.displayName,
                avatarPath: avatarPath(person.userId),
                size: 34,
                radius: 10
            )
            Text(person.displayName + (person.isAgent == true ? " 🤖" : ""))
                .font(.system(size: 15))
                .foregroundStyle(MC.ink)
                .lineLimit(1)
            if app.isOnline(person.userId, in: channel.workspaceId) {
                Circle().fill(MC.online).frame(width: 8, height: 8)
            }
            Spacer(minLength: 0)
            if added.contains(person.userId) {
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.green)
                    .accessibilityIdentifier("inviteChannel.added.\(person.userId)")
            } else {
                Button("Add") { add(person.userId) }
                    .buttonStyle(.bordered)
                    .font(.system(size: 14, weight: .semibold))
                    .disabled(busy.contains(person.userId))
                    .accessibilityIdentifier("inviteChannel.add.\(person.userId)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("inviteChannel.user.\(person.userId)")
    }

    private func avatarPath(_ userId: String) -> String? {
        let path = app.avatarPaths[userId]
        return path?.hasPrefix("/v1/avatars/") == true ? path : nil
    }

    // MARK: - Actions

    private func add(_ userId: String) {
        busy.insert(userId)
        error = nil
        Task {
            defer { busy.remove(userId) }
            do {
                try await app.engine.addMember(channelId: channel.id, userId: userId)
                added.insert(userId)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

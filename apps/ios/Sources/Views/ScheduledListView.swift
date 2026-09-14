import GRDB
import SwiftUI

/// The Scheduled list (#424) — iOS's half of the scheduled-messages panel, the
/// same single list web and macOS show, adapted to a phone: rows stack their
/// metadata instead of spreading it across a wide row, and the author/admin
/// actions live behind a swipe and a `…` menu rather than four small buttons.
///
/// Reached from the drawer's clock, beside the Activity bell — the same place
/// the other clients put it.
struct ScheduledListView: View {
    /// Replaces the nav stack with a channel, for "view output" — the same
    /// hand-off the Activity feed uses.
    var onOpenChannel: (String) -> Void = { _ in }

    @EnvironmentObject private var app: AppState

    @State private var rows: [ScheduledMessage] = []
    @State private var channels: [Channel] = []
    @State private var userNames: [String: String] = [:]
    @State private var mine = false
    @State private var loading = true
    @State private var running: String?
    @State private var editor: ScheduleEditorTarget?
    /// Row awaiting delete confirmation. An alert rather than the desktop's
    /// two-click arm: a swipe is easy to overshoot.
    @State private var pendingDelete: ScheduledMessage?
    /// Tapped row's "Posted automatically" detail is the badge's job; here a
    /// tap on a failed row's pill shows why it stopped.
    @State private var errorDetail: String?

    var body: some View {
        Group {
            if loading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    Section {
                        Toggle("Owned by me", isOn: $mine)
                            .flowFont(.callout)
                            .accessibilityIdentifier("scheduled.mineFilter")
                    }
                    if rows.isEmpty {
                        Section { emptyState }
                    } else {
                        Section {
                            ForEach(rows) { row in rowView(row) }
                        } footer: {
                            Text("🔒 Personal scheduled messages are visible only to you. Ones "
                                 + "posting to a channel appear for every member of that channel. "
                                 + "They run as their owner, with their permissions.")
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Scheduled")
        .navigationBarTitleDisplayMode(.inline)
        .flowBarToolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editor = .creating(body: "", channelId: app.selectedChannelId)
                } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New scheduled message")
                    .accessibilityIdentifier("scheduled.new")
            }
        }
        .task(id: ListKey(workspaceId: app.selectedWorkspaceId, mine: mine)) { await reload() }
        .sheet(item: $editor) { target in
            NavigationStack {
                ScheduleMessageSheet(workspaceId: app.selectedWorkspaceId, target: target) { saved in
                    if let index = rows.firstIndex(where: { $0.id == saved.id }) {
                        rows[index] = saved
                    } else {
                        Task { await reload() }
                    }
                }
                .environmentObject(app)
            }
        }
        .alert("Delete this scheduled message?", isPresented: .init(
            get: { pendingDelete != nil },
            set: { if !$0 { pendingDelete = nil } }
        )) {
            Button("Delete", role: .destructive) {
                if let row = pendingDelete { Task { await remove(row) } }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: {
            Text("It stops running immediately. Messages it already posted stay put.")
        }
        .alert("This schedule stopped", isPresented: .init(
            get: { errorDetail != nil }, set: { if !$0 { errorDetail = nil } }
        )) {
            Button("OK", role: .cancel) { errorDetail = nil }
        } message: {
            Text(errorDetail ?? "")
        }
    }

    private struct ListKey: Equatable {
        let workspaceId: String?
        let mine: Bool
    }

    private func reload() async {
        guard let workspaceId = app.selectedWorkspaceId else {
            rows = []
            loading = false
            return
        }
        defer { loading = false }
        rows = (try? await app.engine.fetchScheduledMessages(workspaceId: workspaceId, mine: mine)) ?? []
        channels = (try? await app.db.reader.read { db in
            try Channel.filter(Column("workspaceId") == workspaceId).fetchAll(db)
        }) ?? []
        userNames = (try? await app.db.reader.read { db in
            try Dictionary(
                uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayNameWithBadge) }
            )
        }) ?? [:]
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text(mine
                ? "You haven’t scheduled any messages yet."
                : "Nothing is scheduled here yet.")
                .flowFont(.callout)
                .foregroundStyle(MC.faint)
                .multilineTextAlignment(.center)
            Text("Write a message once and Flow posts it as you — a standup prompt every "
                 + "weekday, a digest every 12 hours, a reminder to yourself next Tuesday.")
                .flowFont(.caption)
                .foregroundStyle(MC.faint)
                .multilineTextAlignment(.center)
            Button("Schedule a message") {
                editor = .creating(body: "", channelId: app.selectedChannelId)
            }
            .buttonStyle(.borderedProminent)
            .tint(MC.accent)
            .padding(.top, 4)
            .accessibilityIdentifier("scheduled.emptyCta")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .accessibilityIdentifier("scheduled.empty")
    }

    // MARK: - A row

    private func destinationLabel(_ channelId: String) -> String {
        guard let c = channels.first(where: { $0.id == channelId }) else { return "a conversation" }
        if c.isSelfDm(me: app.currentUser?.id) { return "🔒 Just me" }
        return c.isDM
            ? c.displayTitle(userNames: userNames, currentUserId: app.currentUser?.id)
            : "# \(c.name ?? "")"
    }

    @ViewBuilder
    private func rowView(_ row: ScheduledMessage) -> some View {
        let isRunning = running == row.id
        let status = ScheduledStatus.of(row, running: isRunning)
        let owner = userNames[row.authorUserId] ?? "Someone"
        let preview = MentionRendering.plainText(row.body, names: userNames)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        HStack(alignment: .top, spacing: 10) {
            AvatarChip(
                userId: row.authorUserId, name: owner,
                avatarPath: app.avatarPaths[row.authorUserId], size: 32, radius: 9
            )
            VStack(alignment: .leading, spacing: 3) {
                Text(preview.isEmpty ? "(empty message)" : preview)
                    .flowFont(.callout, weight: .semibold)
                    .foregroundStyle(preview.isEmpty ? MC.faint : MC.ink)
                    .lineLimit(2)
                Text("\(ScheduleFormat.describe(row.recurrence, timezone: row.timezone)) · posts to "
                     + destinationLabel(row.channelId))
                    .flowFont(.caption)
                    .foregroundStyle(MC.muted)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    statusPill(status)
                        .onTapGesture {
                            if status == .failed { errorDetail = row.lastError }
                        }
                    Text(timestampLabel(row))
                        .flowFont(.caption2)
                        .foregroundStyle(MC.faint)
                    if let messageId = row.lastMessageId {
                        Button("view output ↗") {
                            app.jumpToMessage(channelId: row.channelId, messageId: messageId)
                            onOpenChannel(row.channelId)
                        }
                        .buttonStyle(.plain)
                        .flowFont(size: 11, weight: .semibold)
                        .foregroundStyle(MC.accentSoft)
                        .accessibilityIdentifier("scheduled.viewOutput.\(row.id)")
                    }
                }
            }
            Spacer(minLength: 0)
            // Actions are the author's and admins' only — the server decides
            // with `canManage`, and a non-owner's row simply has no menu.
            if row.canManage {
                Menu {
                    Button("Run now") { Task { await runNow(row) } }
                    Button(row.enabled ? "Pause" : "Resume") { Task { await toggle(row) } }
                    Button("Edit") { editor = .editing(row) }
                    Button("Delete", role: .destructive) { pendingDelete = row }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(MC.muted)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Actions")
                .accessibilityIdentifier("scheduled.actions.\(row.id)")
            }
        }
        .opacity(row.enabled ? 1 : 0.6)
        .accessibilityIdentifier("scheduled.row.\(row.id)")
        .accessibilityValue(row.enabled ? "enabled" : "paused")
        // The same four actions as a swipe, for the thumb. Both halves are
        // gated on `canManage`, so a row you can only read never reveals one.
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if row.canManage {
                // Explicit tint: inside a swipe action the destructive role
                // alone picks up the app's accent, and a delete that reads
                // violet like every other affordance isn't a warning.
                Button(role: .destructive) { pendingDelete = row } label: {
                    Label("Delete", systemImage: "trash")
                }
                .tint(.red)
                Button { editor = .editing(row) } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .tint(MC.accentSoft)
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if row.canManage {
                Button { Task { await runNow(row) } } label: {
                    Label("Run now", systemImage: "play.fill")
                }
                .tint(MC.accent)
                Button { Task { await toggle(row) } } label: {
                    Label(row.enabled ? "Pause" : "Resume",
                          systemImage: row.enabled ? "pause.fill" : "play.circle")
                }
                .tint(MC.muted)
            }
        }
    }

    private func statusPill(_ status: ScheduledStatus) -> some View {
        let (fg, bg): (Color, Color) = switch status {
        case .running: (MC.accentDeep, MC.accent.opacity(0.12))
        case .failed: (MC.danger, MC.danger.opacity(0.1))
        case .succeeded: (Color(hex: 0x2F7A45), Color(hex: 0x2F7A45).opacity(0.1))
        case .paused, .scheduled: (MC.muted, MC.daypill)
        }
        return Text(status.label)
            .flowFont(size: 10, weight: .semibold)
            .foregroundStyle(fg)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 4).fill(bg))
    }

    private func timestampLabel(_ row: ScheduledMessage) -> String {
        if let lastRunAt = row.lastRunAt { return ISO8601.displayTime(lastRunAt) }
        if let nextRunAt = row.nextRunAt { return "Next \(ISO8601.displayTime(nextRunAt))" }
        return "—"
    }

    // MARK: - Mutations

    private func runNow(_ row: ScheduledMessage) async {
        await act(row) { try await app.engine.runScheduledMessageNow(id: row.id) }
    }

    private func toggle(_ row: ScheduledMessage) async {
        await act(row) {
            try await app.engine.setScheduledMessageEnabled(id: row.id, enabled: !row.enabled)
        }
    }

    /// Settle the server's updated row in place — no reload, so the list reacts
    /// immediately (AC #3).
    private func act(_ row: ScheduledMessage, _ work: @escaping () async throws -> ScheduledMessage) async {
        running = row.id
        defer { running = nil }
        do {
            let updated = try await work()
            if let index = rows.firstIndex(where: { $0.id == row.id }) { rows[index] = updated }
        } catch {
            app.showError(error.localizedDescription)
        }
    }

    private func remove(_ row: ScheduledMessage) async {
        do {
            try await app.engine.deleteScheduledMessage(id: row.id)
            rows.removeAll { $0.id == row.id }
        } catch {
            app.showError(error.localizedDescription)
        }
    }
}

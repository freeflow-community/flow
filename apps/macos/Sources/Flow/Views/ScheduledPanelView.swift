import GRDB
import SwiftUI

/// The Scheduled panel (#424) — the macOS twin of the web's `ScheduledView`.
/// A workspace-wide list behind the clock next to the sidebar's Activity bell,
/// in the same "covers the content pane, channel stays selected behind it"
/// shape as the Activity feed.
///
/// One list, not tabs: the server already decides what you may see (your own
/// rows plus rows destined for channels you're in), so a personal/shared split
/// would re-explain the same fact twice. "Owned by me" is the one filter that
/// narrows to a genuinely different question.
struct ScheduledPanelView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    @State private var rows: [ScheduledMessage] = []
    @State private var channels: [Channel] = []
    @State private var userNames: [String: String] = [:]
    @State private var mine = false
    @State private var loading = true
    /// Row a run-now is in flight for — the one moment the client knows
    /// something the row itself doesn't yet.
    @State private var running: String?
    /// Row whose delete is armed. Two clicks, like the web's, rather than an
    /// alert: deleting a schedule is undoable by re-creating it.
    @State private var confirmingDelete: String?
    @State private var editor: ScheduleEditorTarget?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            filterBar
            Divider().opacity(0.5)
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(MC.base)
        .task(id: ListKey(workspaceId: win.selectedWorkspaceId, mine: mine)) {
            await reload()
        }
        .sheet(item: $editor) { target in
            ScheduleMessageSheet(workspaceId: win.selectedWorkspaceId, target: target) { saved in
                // Settle the saved row in place; a brand-new one has no row to
                // settle, so that case reloads.
                if let index = rows.firstIndex(where: { $0.id == saved.id }) {
                    rows[index] = saved
                } else {
                    Task { await reload() }
                }
            }
            .environmentObject(app)
        }
    }

    /// Refetch trigger: a workspace switch is a different list, and so is
    /// flipping the filter (which the server applies, not us).
    private struct ListKey: Equatable {
        let workspaceId: String?
        let mine: Bool
    }

    private func reload() async {
        guard let workspaceId = win.selectedWorkspaceId else {
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

    // MARK: - Chrome

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text("🕐").foregroundStyle(MC.muted)
                    Text("Scheduled")
                }
                .flowFont(size: 15, weight: .bold)
                .accessibilityIdentifier("scheduled.header")
                Text("Messages Flow posts for you, on a schedule")
                    .flowFont(.caption)
                    .foregroundStyle(MC.muted)
            }
            Spacer(minLength: 8)
            Button {
                editor = .creating(body: "", channelId: win.selectedChannelId)
            } label: {
                Text("+ New scheduled message")
                    .flowFont(size: 12, weight: .semibold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(MC.accent))
            }
            .buttonStyle(.plain)
            .disabled(win.selectedWorkspaceId == nil)
            .accessibilityIdentifier("scheduled.new")
        }
        .padding(.horizontal, 22)
        .frame(height: 60)
    }

    private var filterBar: some View {
        HStack(spacing: 8) {
            Toggle(isOn: $mine) {
                Text("Owned by me").flowFont(.callout).foregroundStyle(MC.inkSoft)
            }
            .toggleStyle(.checkbox)
            .accessibilityIdentifier("scheduled.mineFilter")
            Spacer()
            Text("\(rows.count) scheduled")
                .flowFont(.caption2)
                .foregroundStyle(MC.faint)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 7)
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if rows.isEmpty {
            emptyState
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(rows) { row in
                        rowView(row)
                    }
                    footerNote
                }
                .padding(16)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Text(mine
                ? "You haven’t scheduled any messages yet."
                : "Nothing is scheduled here yet.")
                .flowFont(.callout)
                .foregroundStyle(MC.faint)
            Text("Write a message once and Flow posts it as you — a standup prompt every "
                 + "weekday, a digest every 12 hours, a reminder to yourself next Tuesday.")
                .flowFont(.callout)
                .foregroundStyle(MC.faint)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            Button {
                editor = .creating(body: "", channelId: win.selectedChannelId)
            } label: {
                Text("Schedule a message")
                    .flowFont(size: 13, weight: .semibold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 8).fill(MC.accent))
            }
            .buttonStyle(.plain)
            .padding(.top, 8)
            .accessibilityIdentifier("scheduled.emptyCta")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("scheduled.empty")
    }

    private var footerNote: some View {
        Text("🔒 Personal scheduled messages are visible only to you. Ones posting to a channel "
             + "appear for every member of that channel. They run as their owner, with their "
             + "permissions.")
            .flowFont(.caption)
            .foregroundStyle(MC.muted)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(MC.daypill.opacity(0.5)))
            .padding(.top, 8)
    }

    // MARK: - A row

    /// How a row names its destination: `# channel`, or the lock for "Just me".
    private func destinationLabel(_ channelId: String) -> String {
        guard let c = channels.first(where: { $0.id == channelId }) else { return "a conversation" }
        if c.isSelfDm(me: app.currentUser?.id) { return "🔒 Just me" }
        return c.isDM
            ? c.displayTitle(userNames: userNames, currentUserId: app.currentUser?.id)
            : "# \(c.name ?? "")"
    }

    private func rowView(_ row: ScheduledMessage) -> some View {
        let isRunning = running == row.id
        let status = ScheduledStatus.of(row, running: isRunning)
        let owner = userNames[row.authorUserId] ?? "Someone"
        let preview = MentionRendering.plainText(row.body, names: userNames)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return HStack(spacing: 12) {
            Text("🕐")
                .flowFont(size: 17)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 8).fill(MC.daypill))

            VStack(alignment: .leading, spacing: 2) {
                Text(preview.isEmpty ? "(empty message)" : preview)
                    .flowFont(.callout, weight: .bold)
                    .foregroundStyle(preview.isEmpty ? MC.faint : MC.ink)
                    .lineLimit(1)
                    .help(preview)
                (
                    Text(ScheduleFormat.describe(row.recurrence, timezone: row.timezone))
                        + Text(" · posts to ")
                        + Text(destinationLabel(row.channelId)).foregroundColor(MC.accentSoft).bold()
                )
                .flowFont(.caption)
                .foregroundStyle(MC.muted)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 2) {
                statusPill(status)
                HStack(spacing: 4) {
                    Text(timestampLabel(row))
                        .flowFont(.caption2)
                        .foregroundStyle(MC.faint)
                    if let messageId = row.lastMessageId {
                        Button("view output ↗") {
                            win.jumpToMessage(channelId: row.channelId, messageId: messageId)
                        }
                        .buttonStyle(.plain)
                        .flowFont(size: 11, weight: .semibold)
                        .foregroundStyle(MC.accentSoft)
                        .accessibilityIdentifier("scheduled.viewOutput.\(row.id)")
                    }
                }
            }

            AvatarChip(
                userId: row.authorUserId, name: owner,
                avatarPath: app.avatarPaths[row.authorUserId], size: 28, radius: 8
            )
            .help("Runs as \(owner)")

            // Actions are the author's and admins' only — everyone else reads
            // the row. `canManage` is the server's answer, not ours.
            if row.canManage {
                HStack(spacing: 4) {
                    rowButton("▶", help: "Run now", id: "run", row: row, disabled: isRunning) {
                        await act(row) { try await app.engine.runScheduledMessageNow(id: row.id) }
                    }
                    rowButton(row.enabled ? "⏸" : "⏵",
                              help: row.enabled ? "Pause" : "Resume", id: "toggle", row: row) {
                        await act(row) {
                            try await app.engine.setScheduledMessageEnabled(
                                id: row.id, enabled: !row.enabled
                            )
                        }
                    }
                    Button {
                        editor = .editing(row)
                    } label: { rowButtonLabel("✏️") }
                        .buttonStyle(.plain)
                        .help("Edit")
                        .accessibilityIdentifier("scheduled.edit.\(row.id)")
                    Button {
                        if confirmingDelete == row.id {
                            confirmingDelete = nil
                            Task { await remove(row) }
                        } else {
                            confirmingDelete = row.id
                        }
                    } label: { rowButtonLabel(confirmingDelete == row.id ? "✓" : "🗑") }
                        .buttonStyle(.plain)
                        .help(confirmingDelete == row.id ? "Click again to delete" : "Delete")
                        .accessibilityIdentifier("scheduled.delete.\(row.id)")
                }
                .accessibilityIdentifier("scheduled.actions.\(row.id)")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.white)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(MC.hairline))
        )
        .opacity(row.enabled ? 1 : 0.6)
        .accessibilityIdentifier("scheduled.row.\(row.id)")
        .accessibilityValue(row.enabled ? "enabled" : "paused")
    }

    private func statusPill(_ status: ScheduledStatus) -> some View {
        let (fg, bg): (Color, Color) = switch status {
        case .running: (MC.accentDeep, MC.accent.opacity(0.12))
        case .failed: (MC.danger, MC.danger.opacity(0.1))
        case .succeeded: (Color(hex: 0x2F7A45), Color(hex: 0x2F7A45).opacity(0.1))
        case .paused, .scheduled: (MC.muted, MC.daypill)
        }
        return Text(status.label)
            .flowFont(size: 11, weight: .semibold)
            .foregroundStyle(fg)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 4).fill(bg))
    }

    /// What the row's small print says: when it last ran, else when it will
    /// next, else nothing has happened yet.
    private func timestampLabel(_ row: ScheduledMessage) -> String {
        if let lastRunAt = row.lastRunAt { return ISO8601.displayTime(lastRunAt) }
        if let nextRunAt = row.nextRunAt { return "Next \(ISO8601.displayTime(nextRunAt))" }
        return "—"
    }

    private func rowButton(
        _ glyph: String, help: String, id: String, row: ScheduledMessage,
        disabled: Bool = false, action: @escaping () async -> Void
    ) -> some View {
        Button { Task { await action() } } label: { rowButtonLabel(glyph) }
            .buttonStyle(.plain)
            .disabled(disabled)
            .opacity(disabled ? 0.4 : 1)
            .help(help)
            .accessibilityLabel(help)
            .accessibilityIdentifier("scheduled.\(id).\(row.id)")
    }

    private func rowButtonLabel(_ glyph: String) -> some View {
        Text(glyph)
            .flowFont(size: 11)
            .frame(width: 24, height: 20)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(MC.hairline))
            )
            .contentShape(Rectangle())
    }

    // MARK: - Mutations

    /// Run an action that returns the server's updated row and settle it in
    /// place. No reload: the panel must react immediately (AC #3), and the
    /// response already *is* the new truth.
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

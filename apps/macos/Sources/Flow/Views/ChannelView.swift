import GRDB
import SwiftUI

struct ChannelView: View {
    let channelId: String
    @EnvironmentObject private var app: AppState

    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @StateObject private var messages = DBObserved<[Message]>(initial: [])
    @StateObject private var userNames = DBObserved<[String: String]>(initial: [:])
    @StateObject private var userStatuses = DBObserved<[String: String]>(initial: [:])
    @StateObject private var memberIds = DBObserved<[String]>(initial: [])
    @State private var editingMessage: Message?
    @State private var profileUserId: String?
    @State private var showChannelEdit = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            MessageListView(
                messages: messages.value,
                userNames: userNames.value,
                userStatuses: userStatuses.value,
                currentUserId: app.currentUser?.id,
                hasMore: app.hasMore[channelId] ?? false,
                showThreadAffordances: true,
                onLoadOlder: {
                    Task { await app.engine.loadOlder(channelId: channelId) }
                },
                onOpenThread: { rootId in
                    app.openThread(rootId)
                },
                onEdit: { message in
                    editingMessage = message
                },
                onDelete: { message in
                    Task { await app.engine.deleteMessage(id: message.id) }
                },
                onOpenProfile: { userId in
                    profileUserId = userId
                },
                scrollKey: channelId
            )

            TypingIndicatorView(channelId: channelId, userNames: userNames.value)

            if channel.value?.archivedAt != nil {
                Text("This channel is archived and read-only.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(12)
            } else {
                ComposerView(
                    channelId: channelId,
                    workspaceId: channel.value?.workspaceId,
                    threadRootId: nil,
                    placeholder: "Message \(headerTitle)",
                    onEditLast: { startEditingLastMessage() }
                )
            }
        }
        .task(id: channelId) {
            channel.start(db: app.db, reset: nil) { db in
                try Channel.fetchOne(db, key: channelId)
            }
            messages.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("channelId") == channelId && Column("threadRootId") == nil)
                    .order(Column("id"))
                    .fetchAll(db)
            }
            userNames.start(db: app.db, reset: [:]) { db in
                try Dictionary(
                    uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayNameWithBadge) }
                )
            }
            userStatuses.start(db: app.db, reset: [:]) { db in
                try Dictionary(
                    uniqueKeysWithValues: User.fetchAll(db).compactMap { u in
                        (u.statusEmoji?.isEmpty == false) ? (u.id, u.statusEmoji!) : nil
                    }
                )
            }
            if let wsId = app.selectedWorkspaceId {
                memberIds.start(db: app.db, reset: []) { db in
                    try String.fetchAll(
                        db,
                        sql: """
                            SELECT m.userId FROM member m JOIN user u ON u.id = m.userId
                            WHERE m.workspaceId = ? ORDER BY u.displayName COLLATE NOCASE
                            """,
                        arguments: [wsId]
                    )
                }
            }
        }
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
        .sheet(item: Binding(
            get: { profileUserId.map { ProfileTarget(userId: $0) } },
            set: { profileUserId = $0?.userId }
        )) { target in
            MemberProfileSheet(userId: target.userId)
        }
        .sheet(isPresented: $showChannelEdit) {
            if let c = channel.value {
                ChannelEditSheet(channel: c)
            }
        }
    }

    /// ↑-to-edit (ui_nits item 4): only when my message is the newest.
    private func startEditingLastMessage() -> Bool {
        guard let last = messages.value.last,
              last.userId == app.currentUser?.id,
              !last.isDeleted, !last.pending else { return false }
        editingMessage = last
        return true
    }

    /// The non-me member of a 1:1 DM (falls back to me for a self-DM).
    private var dmOtherUserId: String? {
        guard channel.value?.kind == "dm" else { return nil }
        let ids = channel.value?.memberIds ?? []
        return ids.first { $0 != app.currentUser?.id } ?? ids.first
    }

    private var headerTitle: String {
        guard let c = channel.value else { return "" }
        return c.isDM
            ? c.displayTitle(userNames: userNames.value, currentUserId: app.currentUser?.id)
            : "#\(c.name ?? "")"
    }

    private var header: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Image(systemName: headerIcon)
                        .font(.system(size: 13))
                        .foregroundStyle(MC.muted)
                    // Ruling 4: a 1:1 DM's header title opens the other
                    // member's profile card.
                    if let otherId = dmOtherUserId {
                        Button {
                            profileUserId = otherId
                        } label: {
                            Text(headerTitle)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(MC.ink)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("View profile")
                    } else if channel.value?.kind == "standard" {
                        // Clicking a channel's name opens the name/topic editor
                        // (ui_nits item 5).
                        Button {
                            showChannelEdit = true
                        } label: {
                            Text(channel.value?.name ?? "")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(MC.ink)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Edit name & topic")
                        .accessibilityIdentifier("channel.editHeader")
                    } else {
                        Text(headerTitle)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(MC.ink)
                    }
                }
                if let topic = channel.value?.topic, !topic.isEmpty {
                    Text(topic)
                        .font(.system(size: 12))
                        .foregroundStyle(MC.muted)
                        .lineLimit(1)
                }
            }
            Spacer()
            headerAvatars
        }
        .padding(.horizontal, 22)
        .frame(height: 60)
        .background(MC.base)
    }

    /// Design 3a: overlapping member avatars + "+N" at the header's right edge
    /// (channel members for DMs, workspace members otherwise).
    private var headerAvatars: some View {
        let ids = (channel.value?.isDM == true ? channel.value?.memberIds : nil) ?? memberIds.value
        let shown = Array(ids.prefix(3))
        let extra = ids.count - shown.count
        return HStack(spacing: 4) {
            HStack(spacing: -10) {
                ForEach(shown, id: \.self) { id in
                    AvatarChip(
                        userId: id,
                        name: userNames.value[id] ?? "?",
                        avatarPath: app.avatarPaths[id],
                        size: 26,
                        radius: 13
                    )
                    .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(MC.base, lineWidth: 2))
                }
            }
            if extra > 0 {
                Text("+\(extra)")
                    .font(.system(size: 12))
                    .foregroundStyle(MC.muted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("channel.memberAvatars")
        .accessibilityValue("\(ids.count) members")
    }

    private var headerIcon: String {
        guard let c = channel.value else { return "number" }
        if c.kind == "dm" { return "person" }
        if c.kind == "group_dm" { return "person.2" }
        return c.isPrivate ? "lock" : "number"
    }
}

struct TypingIndicatorView: View {
    let channelId: String
    /// nil = the channel's main composer; set = that thread's composer, so the
    /// two never show each other's typists.
    var threadRootId: String? = nil
    let userNames: [String: String]
    @EnvironmentObject private var app: AppState

    var body: some View {
        let ids = app.typingUserIds(channelId: channelId, threadRootId: threadRootId)
        HStack {
            if !ids.isEmpty {
                Text(typingText(ids))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("typing.indicator")
            }
            Spacer()
        }
        .frame(height: 16)
        .padding(.horizontal, 16)
    }

    /// An agent at work "thinks" rather than "types" (ui_nits).
    private func typingText(_ ids: [String]) -> String {
        let names = ids.map { userNames[$0] ?? "Someone" }
        switch ids.count {
        case 1:
            let verb = app.agentIds.contains(ids[0]) ? "thinking" : "typing"
            return "\(names[0]) is \(verb)…"
        case 2: return "\(names[0]) and \(names[1]) are typing…"
        default: return "Several people are typing…"
        }
    }
}

struct EditMessageSheet: View {
    let message: Message
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var text: String

    init(message: Message) {
        self.message = message
        _text = State(initialValue: message.body)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Edit Message").font(.headline)
            TextField("Message", text: $text, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...10)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction) // Esc cancels (ui_nits item 4)
                Button("Save") {
                    Task { await app.engine.editMessage(id: message.id, body: text) }
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}

/// Edit a standard channel's name + topic (ui_nits item 5); any member.
/// Empty topic clears the sub-headline; #general keeps its name.
struct ChannelEditSheet: View {
    let channel: Channel
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var topic: String
    @State private var error: String?
    @State private var saving = false

    init(channel: Channel) {
        self.channel = channel
        _name = State(initialValue: channel.name ?? "")
        _topic = State(initialValue: channel.topic ?? "")
    }

    private var isGeneral: Bool { channel.name == "general" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Channel settings").font(.headline)
            VStack(alignment: .leading, spacing: 4) {
                Text("Name").font(.caption).foregroundStyle(.secondary)
                TextField("name (lowercase, a-z 0-9 - _)", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isGeneral)
                    .help(isGeneral ? "#general cannot be renamed" : "")
                    .accessibilityIdentifier("channel.edit.name")
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Topic").font(.caption).foregroundStyle(.secondary)
                TextField("What's this channel about?", text: $topic)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("channel.edit.topic")
            }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") { save() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(saving || (!isGeneral && name.trimmingCharacters(in: .whitespaces).isEmpty))
                    .accessibilityIdentifier("channel.edit.save")
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func save() {
        saving = true
        let newName = name.lowercased().replacingOccurrences(of: " ", with: "-")
        Task {
            defer { saving = false }
            do {
                try await app.engine.updateChannel(
                    channelId: channel.id,
                    name: isGeneral ? nil : newName,
                    topic: topic // "" clears
                )
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

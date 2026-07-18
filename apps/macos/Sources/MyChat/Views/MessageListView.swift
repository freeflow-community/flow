import AppKit
import SwiftUI

struct MessageListView: View {
    let messages: [Message] // ascending by id
    let userNames: [String: String]
    let currentUserId: String?
    let hasMore: Bool
    let showThreadAffordances: Bool
    let onLoadOlder: () -> Void
    let onOpenThread: (String) -> Void
    let onEdit: (Message) -> Void
    let onDelete: (Message) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if hasMore {
                        HStack {
                            Spacer()
                            Button("Load earlier messages", action: onLoadOlder)
                                .buttonStyle(.link)
                                .font(.callout)
                            Spacer()
                        }
                        .padding(.vertical, 8)
                    }
                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                        MessageRow(
                            message: message,
                            userNames: userNames,
                            currentUserId: currentUserId,
                            showHeader: showsHeader(at: index),
                            showThreadAffordances: showThreadAffordances,
                            onOpenThread: onOpenThread,
                            onEdit: onEdit,
                            onDelete: onDelete
                        )
                        .id(message.id)
                    }
                }
                .padding(.vertical, 8)
            }
            .onChange(of: messages.last?.id) { _, newId in
                if let newId {
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(newId, anchor: .bottom)
                    }
                }
            }
            .onAppear {
                if let last = messages.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    /// Slack-style grouping: show the author header when the sender changes
    /// or more than 5 minutes passed since the previous message.
    private func showsHeader(at index: Int) -> Bool {
        guard index > 0 else { return true }
        let prev = messages[index - 1]
        let cur = messages[index]
        if prev.userId != cur.userId { return true }
        guard let prevDate = ISO8601.parse(prev.createdAt),
              let curDate = ISO8601.parse(cur.createdAt) else { return true }
        return curDate.timeIntervalSince(prevDate) > 300
    }
}

struct MessageRow: View {
    let message: Message
    let userNames: [String: String]
    let currentUserId: String?
    let showHeader: Bool
    let showThreadAffordances: Bool
    let onOpenThread: (String) -> Void
    let onEdit: (Message) -> Void
    let onDelete: (Message) -> Void

    @EnvironmentObject private var app: AppState
    @State private var hovering = false
    @State private var showReactionPicker = false

    private var senderName: String { userNames[message.userId] ?? "Unknown" }
    private var isMine: Bool { message.userId == currentUserId }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if showHeader {
                avatar
            } else {
                Color.clear.frame(width: 30, height: 1)
            }

            VStack(alignment: .leading, spacing: 2) {
                if showHeader {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(senderName).font(.callout.bold())
                        Text(ISO8601.displayTime(message.createdAt))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }

                if message.isDeleted {
                    Text("This message was deleted")
                        .font(.callout)
                        .italic()
                        .foregroundStyle(.tertiary)
                } else {
                    if !message.body.trimmingCharacters(in: .whitespaces).isEmpty {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text(MentionRendering.attributed(
                                message.body, names: userNames, currentUserId: currentUserId
                            ))
                            .font(.callout)
                            .textSelection(.enabled)
                            if message.editedAt != nil {
                                Text("(edited)")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            if message.pending {
                                ProgressView()
                                    .controlSize(.mini)
                            }
                        }
                    } else if message.pending {
                        ProgressView().controlSize(.mini)
                    }

                    ForEach(message.files) { file in
                        AttachmentView(file: file)
                    }

                    if !message.reactions.isEmpty {
                        reactionChips
                    }
                }

                if showThreadAffordances, message.replyCount > 0 {
                    Button {
                        onOpenThread(message.id)
                    } label: {
                        Label(
                            "\(message.replyCount) \(message.replyCount == 1 ? "reply" : "replies")",
                            systemImage: "bubble.left.and.bubble.right"
                        )
                        .font(.caption)
                    }
                    .buttonStyle(.link)
                }
            }
            Spacer(minLength: 0)

            // The button must stay mounted while the picker is open: it is the
            // popover's anchor, and moving the mouse toward the popover leaves
            // the row (hovering -> false) — unmounting the anchor would tear
            // the popover down (operator-reported bug at the item-6 checkpoint).
            if hovering || showReactionPicker, !message.isDeleted, !message.pending {
                Button {
                    showReactionPicker = true
                } label: {
                    Image(systemName: "face.smiling")
                }
                .buttonStyle(.borderless)
                .help("Add reaction")
                .accessibilityIdentifier("msg.addReaction")
                .popover(isPresented: $showReactionPicker) {
                    EmojiPickerView { emoji in
                        showReactionPicker = false
                        Task { await app.engine.toggleReaction(messageId: message.id, emoji: emoji) }
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, showHeader ? 8 : 1)
        .padding(.bottom, 1)
        .opacity(message.pending ? 0.55 : 1)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .contextMenu {
            if !message.isDeleted, !message.pending {
                ForEach(Array(EmojiCatalog.quickReactions.prefix(6)), id: \.self) { emoji in
                    Button(emoji) {
                        Task { await app.engine.toggleReaction(messageId: message.id, emoji: emoji) }
                    }
                }
                Divider()
            }
            if showThreadAffordances {
                Button("Reply in Thread") {
                    onOpenThread(message.threadRootId ?? message.id)
                }
            }
            if isMine, !message.isDeleted, !message.pending {
                Button("Edit…") { onEdit(message) }
                Button("Delete", role: .destructive) { onDelete(message) }
            }
        }
    }

    private var reactionChips: some View {
        HStack(spacing: 4) {
            ForEach(message.reactions, id: \.emoji) { agg in
                let mine = currentUserId.map { agg.userIds.contains($0) } ?? false
                Button {
                    Task { await app.engine.toggleReaction(messageId: message.id, emoji: agg.emoji) }
                } label: {
                    HStack(spacing: 3) {
                        Text(agg.emoji).font(.system(size: 12))
                        Text("\(agg.count)").font(.caption2.bold())
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule().fill(mine ? Color.accentColor.opacity(0.25) : Color.secondary.opacity(0.12))
                    )
                    .overlay(
                        Capsule().strokeBorder(
                            mine ? Color.accentColor : .clear, lineWidth: 1
                        )
                    )
                }
                .buttonStyle(.plain)
                .help((agg.userIds.compactMap { userNames[$0] }).joined(separator: ", "))
                .accessibilityIdentifier("msg.reaction.\(agg.emoji)")
                .accessibilityValue("\(agg.count)\(mine ? " including you" : "")")
            }
        }
        .padding(.top, 2)
    }

    private var avatar: some View {
        Group {
            if let path = avatarPath {
                AuthImage(path: path) {
                    fallbackAvatar
                }
                .scaledToFill()
                .frame(width: 30, height: 30)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                fallbackAvatar
            }
        }
    }

    private var avatarPath: String? {
        // Avatar URLs are API-relative (/v1/avatars/<key>); cached user rows carry them.
        app.avatarPaths[message.userId]
    }

    private var fallbackAvatar: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(avatarColor)
            .frame(width: 30, height: 30)
            .overlay(
                Text(initials)
                    .font(.caption.bold())
                    .foregroundStyle(.white)
            )
    }

    private var initials: String {
        let parts = senderName.split(separator: " ")
        let chars = parts.prefix(2).compactMap(\.first)
        return chars.isEmpty ? "?" : String(chars).uppercased()
    }

    private var avatarColor: Color {
        let palette: [Color] = [.blue, .purple, .pink, .orange, .teal, .indigo, .mint, .brown]
        var hash = 0
        for scalar in message.userId.unicodeScalars {
            hash = (hash &* 31 &+ Int(scalar.value)) & 0x7fffffff
        }
        return palette[hash % palette.count]
    }
}

// MARK: - Attachments

struct AttachmentView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var opening = false

    var body: some View {
        Group {
            if file.isImage {
                AuthImage(path: "/v1/files/\(file.id)/thumb") {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(.secondary.opacity(0.1))
                        .overlay(ProgressView().controlSize(.small))
                }
                .scaledToFit()
                .frame(maxWidth: 280, maxHeight: thumbHeight)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
                .onTapGesture(perform: open)
            } else {
                Button(action: open) {
                    HStack(spacing: 8) {
                        Image(systemName: iconName)
                            .font(.title2)
                            .foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(file.name)
                                .font(.callout)
                                .lineLimit(1)
                            Text(file.sizeLabel)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        if opening {
                            ProgressView().controlSize(.mini)
                        }
                    }
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 8).fill(.secondary.opacity(0.08)))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.quaternary, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 3)
        .help("\(file.name) (\(file.sizeLabel))")
        .accessibilityIdentifier("msg.file.\(file.name)")
    }

    private var thumbHeight: CGFloat {
        guard let w = file.width, let h = file.height, w > 0 else { return 200 }
        return min(240, 280 * CGFloat(h) / CGFloat(w))
    }

    private var iconName: String {
        switch file.mimeType {
        case let m where m.hasPrefix("image/"): "photo"
        case let m where m.hasPrefix("video/"): "film"
        case let m where m.hasPrefix("audio/"): "waveform"
        case "application/pdf": "doc.richtext"
        case "application/zip": "doc.zipper"
        case let m where m.hasPrefix("text/"): "doc.text"
        default: "doc"
        }
    }

    private func open() {
        guard !opening else { return }
        opening = true
        Task {
            defer { opening = false }
            do {
                let url = try await app.engine.downloadFile(file)
                NSWorkspace.shared.open(url)
            } catch {
                app.showError("Couldn't open \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Emoji picker (reactions)

struct EmojiPickerView: View {
    let onPick: (String) -> Void
    @State private var search = ""

    private var results: [String] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return EmojiCatalog.quickReactions }
        var seen = Set<String>()
        return EmojiCatalog.shortcodes
            .filter { $0.key.contains(q) }
            .sorted { ($0.key.count, $0.key) < ($1.key.count, $1.key) }
            .compactMap { seen.insert($0.value).inserted ? $0.value : nil }
    }

    var body: some View {
        VStack(spacing: 8) {
            TextField("Search emoji", text: $search)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("emoji.search")
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(30)), count: 8), spacing: 4) {
                    ForEach(results, id: \.self) { emoji in
                        Button(emoji) { onPick(emoji) }
                            .buttonStyle(.plain)
                            .font(.system(size: 20))
                    }
                }
            }
            .frame(height: 140)
        }
        .padding(10)
        .frame(width: 300)
    }
}

import AppKit
import SwiftUI

struct MessageListView: View {
    let messages: [Message] // ascending by id
    let userNames: [String: String]
    var userStatuses: [String: String] = [:] // userId -> status emoji
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
                        VStack(alignment: .leading, spacing: 0) {
                            if startsNewDay(at: index) {
                                DayDividerView(iso: message.createdAt)
                            }
                            MessageRow(
                                message: message,
                                userNames: userNames,
                                userStatuses: userStatuses,
                                currentUserId: currentUserId,
                                showHeader: showsHeader(at: index),
                                showThreadAffordances: showThreadAffordances,
                                onOpenThread: onOpenThread,
                                onEdit: onEdit,
                                onDelete: onDelete
                            )
                        }
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
            // First open must land on the newest message: scrollTo from
            // onAppear runs before the lazy rows are laid out and
            // under-scrolls, so anchor the scroll view at the bottom instead
            // (also keeps the list pinned while attachments finish sizing).
            .defaultScrollAnchor(.bottom)
        }
    }

    /// Slack-style grouping: show the author header when the sender changes
    /// or more than 5 minutes passed since the previous message.
    private func showsHeader(at index: Int) -> Bool {
        guard index > 0 else { return true }
        if startsNewDay(at: index) { return true }
        let prev = messages[index - 1]
        let cur = messages[index]
        if prev.userId != cur.userId { return true }
        guard let prevDate = ISO8601.parse(prev.createdAt),
              let curDate = ISO8601.parse(cur.createdAt) else { return true }
        return curDate.timeIntervalSince(prevDate) > 300
    }

    private func startsNewDay(at index: Int) -> Bool {
        guard index > 0 else { return true }
        guard let prev = ISO8601.parse(messages[index - 1].createdAt),
              let cur = ISO8601.parse(messages[index].createdAt) else { return false }
        return !Calendar.current.isDate(prev, inSameDayAs: cur)
    }
}

/// Centered "Today" / date pill between days (design 3a).
struct DayDividerView: View {
    let iso: String

    var body: some View {
        HStack {
            Spacer()
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(MC.faint)
                .padding(.horizontal, 12)
                .padding(.vertical, 3)
                .background(Capsule().fill(MC.daypill))
            Spacer()
        }
        .padding(.vertical, 6)
    }

    private var label: String {
        guard let date = ISO8601.parse(iso) else { return "" }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.month(.wide).day())
    }
}

struct MessageRow: View {
    let message: Message
    let userNames: [String: String]
    var userStatuses: [String: String] = [:]
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
                AvatarChip(
                    userId: message.userId,
                    name: senderName,
                    avatarPath: avatarPath,
                    size: 38,
                    radius: 11
                )
            } else {
                Color.clear.frame(width: 38, height: 1)
            }

            VStack(alignment: .leading, spacing: 2) {
                if showHeader {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(senderName)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(MC.ink)
                        if let emoji = userStatuses[message.userId], !emoji.isEmpty {
                            Text(emoji).font(.system(size: 14))
                        }
                        Text(ISO8601.displayTime(message.createdAt))
                            .font(.system(size: 11))
                            .foregroundStyle(MC.faint)
                    }
                }

                if message.isDeleted {
                    Text("This message was deleted")
                        .font(.callout)
                        .italic()
                        .foregroundStyle(.tertiary)
                } else {
                    let segments = MarkdownBlocks.segments(message.body)
                    if !segments.isEmpty {
                        bodyContent(segments)
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
                        HStack(spacing: 6) {
                            // First-4 reply-author avatars (phase 5 item 7).
                            if !message.replyParticipantUserIds.isEmpty {
                                HStack(spacing: -6) {
                                    ForEach(message.replyParticipantUserIds, id: \.self) { uid in
                                        AvatarChip(
                                            userId: uid,
                                            name: userNames[uid] ?? "Unknown",
                                            avatarPath: app.avatarPaths[uid],
                                            size: 20,
                                            radius: 6
                                        )
                                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white, lineWidth: 1.5))
                                    }
                                }
                                .accessibilityIdentifier("msg.threadParticipants")
                                .accessibilityLabel(
                                    message.replyParticipantUserIds
                                        .map { userNames[$0] ?? "Unknown" }.joined(separator: ", ")
                                )
                            }
                            Label(
                                "\(message.replyCount) \(message.replyCount == 1 ? "reply" : "replies")",
                                systemImage: "bubble.left.and.bubble.right"
                            )
                            .font(.caption)
                        }
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
        .padding(.horizontal, 22)
        .padding(.top, showHeader ? 10 : 1)
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

    // MARK: - Body blocks (phase-3.5 ruling 2)

    /// Block-level body rendering: paragraphs keep the existing inline
    /// attributed pass (mention pills, inline markdown); quote runs get a
    /// 3pt accent bar with "> " markers stripped; fenced code renders as
    /// monospaced text in a warm block with the fence markers hidden (no
    /// pills or markdown inside code).
    @ViewBuilder
    private func bodyContent(_ segments: [MarkdownBlocks.Segment]) -> some View {
        if segments.count == 1, case .paragraph(let text) = segments[0] {
            // Fast path: single plain paragraph keeps the original inline
            // layout (baseline-aligned edited/pending markers).
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                paragraphText(text)
                trailingMarkers
            }
        } else {
            HStack(alignment: .bottom, spacing: 4) {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                        segmentView(segment)
                    }
                }
                trailingMarkers
            }
        }
    }

    @ViewBuilder
    private func segmentView(_ segment: MarkdownBlocks.Segment) -> some View {
        switch segment {
        case .paragraph(let text):
            paragraphText(text)
        case .quote(let text):
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(MC.accent.opacity(0.55))
                    .frame(width: 3)
                paragraphText(text)
                    .foregroundStyle(MC.inkSoft)
            }
            .accessibilityIdentifier("msg.quoteBlock")
        case .code(let text):
            Text(text.isEmpty ? " " : text)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(MC.ink)
                .textSelection(.enabled)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 8).fill(MC.codeBg))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
                .accessibilityIdentifier("msg.codeBlock")
        }
    }

    private func paragraphText(_ text: String) -> some View {
        Text(MentionRendering.attributed(text, names: userNames, currentUserId: currentUserId))
            .font(.callout)
            .textSelection(.enabled)
    }

    @ViewBuilder
    private var trailingMarkers: some View {
        if message.editedAt != nil {
            Text("(edited)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        if message.pending {
            ProgressView().controlSize(.mini)
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
                        Text("\(agg.count)")
                            .font(.caption2.bold())
                            .foregroundStyle(mine ? MC.accentSoft : MC.inkSoft)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(.white))
                    .overlay(
                        Capsule().strokeBorder(
                            mine ? MC.accentSoft.opacity(0.4) : MC.hairline, lineWidth: 1
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

    private var avatarPath: String? {
        // Avatar URLs are API-relative (/v1/avatars/<key>); cached user rows carry them.
        app.avatarPaths[message.userId]
    }
}

// MARK: - Attachments

/// Collapsed-image state (phase 5 ruling): persisted per device, capped list.
enum CollapsedImages {
    private static let key = "collapsedImages" + Profile.suffix
    private static let cap = 500

    static func contains(_ fileId: String) -> Bool {
        (UserDefaults.standard.stringArray(forKey: key) ?? []).contains(fileId)
    }

    static func set(_ fileId: String, collapsed: Bool) {
        var ids = (UserDefaults.standard.stringArray(forKey: key) ?? []).filter { $0 != fileId }
        if collapsed { ids.append(fileId) }
        UserDefaults.standard.set(Array(ids.suffix(cap)), forKey: key)
    }
}

struct AttachmentView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var opening = false
    @State private var saving = false
    @State private var hovering = false
    @State private var collapsed: Bool
    @State private var showLightbox = false

    init(file: FileAttachment) {
        self.file = file
        _collapsed = State(initialValue: CollapsedImages.contains(file.id))
    }

    var body: some View {
        Group {
            if file.isImage {
                imageAttachment
            } else if file.isPDF {
                PdfAttachmentView(file: file)
            } else if file.isTextPreviewable {
                TextAttachmentView(file: file)
            } else {
                fileChip
            }
        }
        .padding(.top, 3)
        .help("\(file.name) (\(file.sizeLabel))")
        .accessibilityIdentifier("msg.file.\(file.name)")
    }

    private var isGif: Bool { file.mimeType == "image/gif" }

    // MARK: image attachments

    private var imageAttachment: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Button {
                    collapsed.toggle()
                    CollapsedImages.set(file.id, collapsed: collapsed)
                } label: {
                    Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .frame(width: 12)
                }
                .buttonStyle(.plain)
                .foregroundStyle(MC.faint)
                .help(collapsed ? "Show image" : "Hide image")
                .accessibilityIdentifier("msg.file.collapse.\(file.name)")
                Text(file.name)
                    .font(.system(size: 11))
                    .foregroundStyle(MC.faint)
                    .lineLimit(1)
            }
            if !collapsed {
                imageBody
            }
        }
    }

    private var imageBody: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                // GIFs skip the static webp thumb and animate from the original.
                if isGif {
                    AnimatedAuthImage(path: "/v1/files/\(file.id)")
                } else {
                    AuthImage(path: "/v1/files/\(file.id)/thumb") {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(.secondary.opacity(0.1))
                            .overlay(ProgressView().controlSize(.small))
                    }
                    .scaledToFit()
                }
            }
            .frame(width: displaySize.width, height: displaySize.height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
            .onTapGesture { showLightbox = true }

            if hovering || saving {
                downloadButton
                    .padding(6)
            }
        }
        .onHover { hovering = $0 }
        .sheet(isPresented: $showLightbox) {
            ImageLightboxView(file: file)
        }
    }

    private var displaySize: CGSize {
        guard let w = file.width, let h = file.height, w > 0, h > 0 else {
            return CGSize(width: 240, height: 180)
        }
        let scale = min(1, 280 / CGFloat(w), 240 / CGFloat(h))
        return CGSize(width: max(60, CGFloat(w) * scale), height: max(60, CGFloat(h) * scale))
    }

    // MARK: non-image chip

    private var fileChip: some View {
        HStack(spacing: 6) {
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
            if hovering || saving {
                downloadButton
            }
        }
        .onHover { hovering = $0 }
    }

    private var downloadButton: some View {
        Button(action: saveToDownloads) {
            Group {
                if saving {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: "arrow.down.to.line")
                        .font(.system(size: 12, weight: .semibold))
                }
            }
            .frame(width: 24, height: 24)
            .background(RoundedRectangle(cornerRadius: 6).fill(.white.opacity(0.92)))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(MC.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help("Download")
        .accessibilityIdentifier("msg.file.download.\(file.name)")
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

    private func saveToDownloads() {
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                let dest = try await app.engine.saveToDownloads(file)
                NSWorkspace.shared.activateFileViewerSelecting([dest])
            } catch {
                app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

/// In-app image popup (phase 5 item 5): original bytes, open-external and
/// download as icon buttons. Esc / ✕ closes.
struct ImageLightboxView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Text(file.name)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                if busy { ProgressView().controlSize(.mini) }
                Spacer()
                Button(action: openExternal) {
                    Image(systemName: "arrow.up.right.square")
                }
                .help("Open external")
                .accessibilityIdentifier("lightbox.openExternal")
                Button(action: download) {
                    Image(systemName: "arrow.down.to.line")
                }
                .help("Download")
                .accessibilityIdentifier("lightbox.download")
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .help("Close")
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("lightbox.close")
            }
            .buttonStyle(.borderless)

            Group {
                if file.mimeType == "image/gif" {
                    AnimatedAuthImage(path: "/v1/files/\(file.id)")
                } else {
                    AuthImage(path: "/v1/files/\(file.id)") {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(.secondary.opacity(0.1))
                            .overlay(ProgressView())
                    }
                    .scaledToFit()
                }
            }
            .frame(width: displaySize.width, height: displaySize.height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .padding(14)
        .accessibilityIdentifier("lightbox")
    }

    private var displaySize: CGSize {
        guard let w = file.width, let h = file.height, w > 0, h > 0 else {
            return CGSize(width: 640, height: 480)
        }
        let scale = min(1, 860 / CGFloat(w), 600 / CGFloat(h))
        return CGSize(width: max(280, CGFloat(w) * scale), height: max(200, CGFloat(h) * scale))
    }

    private func openExternal() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let url = try await app.engine.downloadFile(file)
                NSWorkspace.shared.open(url)
            } catch {
                app.showError("Couldn't open \(file.name): \(error.localizedDescription)")
            }
        }
    }

    private func download() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let dest = try await app.engine.saveToDownloads(file)
                NSWorkspace.shared.activateFileViewerSelecting([dest])
            } catch {
                app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
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

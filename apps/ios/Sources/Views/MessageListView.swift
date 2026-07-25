import SwiftUI
import UIKit

/// iOS port of the macOS message list (Views/MessageListView.swift): day
/// dividers, Slack-style author grouping (5-minute rule), markdown block
/// rendering via the shared MarkdownBlocks segmentation, and mention pills
/// via the shared MentionRendering. Used by both the channel screen and the
/// thread screen.
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
    /// Jump-to-message target (phase 12): scroll it into view + flash it once
    /// it's in the list, then call onFocused. Nil in the normal case.
    var focusMessageId: String? = nil
    var onFocused: () -> Void = {}

    /// The row currently flashing after a jump (fades out on a timer).
    @State private var flashId: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if hasMore {
                        HStack {
                            Spacer()
                            Button("Load earlier messages", action: onLoadOlder)
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
                            if message.systemKind != nil {
                                SystemLineView(text: message.body)
                            } else {
                                MessageRow(
                                    message: message,
                                    userNames: userNames,
                                    userStatuses: userStatuses,
                                    currentUserId: currentUserId,
                                    showHeader: showsHeader(at: index),
                                    showThreadAffordances: showThreadAffordances,
                                    highlighted: message.id == flashId,
                                    onOpenThread: onOpenThread,
                                    onEdit: onEdit,
                                    onDelete: onDelete
                                )
                            }
                        }
                        .id(message.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.vertical, 8)
            }
            .onChange(of: messages.last?.id) { _, newId in
                // A pending jump owns the scroll position — don't yank to bottom.
                guard focusMessageId == nil, newId != nil else { return }
                withAnimation(.easeOut(duration: 0.15)) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            // First open must land on the newest message (same rationale as
            // macOS: scrollTo from onAppear runs before lazy rows lay out).
            // Async avatar/attachment loads grow row heights after the
            // initial layout, so settle-scroll once shortly after the list
            // populates or changes — unless a jump owns the scroll position.
            .task(id: messages.count) {
                guard focusMessageId == nil else { return }
                try? await Task.sleep(for: .milliseconds(350))
                proxy.scrollTo("bottom", anchor: .bottom)
            }
            .defaultScrollAnchor(.bottom)
            // Drag the list down and the keyboard follows your finger (#69) —
            // the tap-to-dismiss handler on the list covers the discrete case.
            .scrollDismissesKeyboard(.interactively)
            // Jump-to-message (phase 12): center + flash the target once it's in
            // the list (older history pages in via ChannelScreen), then release.
            .onChange(of: focusMessageId) { _, _ in tryFocus(proxy) }
            .onChange(of: messages.count) { _, _ in tryFocus(proxy) }
            .onAppear { tryFocus(proxy) }
        }
    }

    private func tryFocus(_ proxy: ScrollViewProxy) {
        guard let fid = focusMessageId, messages.contains(where: { $0.id == fid }) else { return }
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(fid, anchor: .center)
        }
        flashId = fid
        onFocused()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            withAnimation(.easeOut(duration: 0.6)) {
                if flashId == fid { flashId = nil }
            }
        }
    }

    /// Slack-style grouping: show the author header when the sender changes
    /// or more than 5 minutes passed since the previous message.
    private func showsHeader(at index: Int) -> Bool {
        guard index > 0 else { return true }
        if startsNewDay(at: index) { return true }
        let prev = messages[index - 1]
        let cur = messages[index]
        // A system line (join/leave) breaks a run — the next message re-shows its header.
        if prev.systemKind != nil { return true }
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

/// A channel event line (join/leave) — centered, muted, no avatar/header.
/// The text is the pre-rendered sentence ("Alice joined the channel").
struct SystemLineView: View {
    let text: String

    var body: some View {
        HStack {
            Spacer()
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(MC.faint)
                .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 12)
    }
}

struct MessageRow: View {
    let message: Message
    let userNames: [String: String]
    var userStatuses: [String: String] = [:]
    let currentUserId: String?
    let showHeader: Bool
    let showThreadAffordances: Bool
    /// Flashing after a jump-to-message (phase 12).
    var highlighted: Bool = false
    let onOpenThread: (String) -> Void
    let onEdit: (Message) -> Void
    let onDelete: (Message) -> Void

    @EnvironmentObject private var app: AppState
    @State private var showReactionPicker = false
    @State private var showDeleteConfirm = false

    private var senderName: String { userNames[message.userId] ?? "Unknown" }
    private var isMine: Bool { message.userId == currentUserId }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if showHeader {
                AvatarChip(
                    userId: message.userId,
                    name: senderName,
                    avatarPath: app.avatarPaths[message.userId],
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
                    } else if message.pending, message.files.isEmpty {
                        ProgressView().controlSize(.mini)
                    }

                    ForEach(message.files) { file in
                        AttachmentView(file: file)
                    }

                    // Phase 11: link previews sit below the body/attachments
                    // and above reactions. Only the author may remove one.
                    ForEach(message.unfurls) { unfurl in
                        UnfurlCardView(
                            unfurl: unfurl,
                            canRemove: message.userId == currentUserId,
                            onRemove: {
                                Task {
                                    await app.engine.deleteUnfurl(
                                        messageId: message.id, urlHash: unfurl.urlHash)
                                }
                            }
                        )
                    }

                    if !message.reactions.isEmpty {
                        reactionChips
                    }
                }

                if showThreadAffordances, message.replyCount > 0 {
                    threadAffordance
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.top, showHeader ? 10 : 1)
        .padding(.bottom, 1)
        .background(highlighted ? MC.unread.opacity(0.16) : Color.clear)
        .animation(.easeOut(duration: 0.6), value: highlighted)
        .opacity(message.pending ? 0.55 : 1)
        .contentShape(Rectangle())
        // Long-press context menu: iOS's answer to the macOS hover menu —
        // quick reactions, full picker, reply-in-thread, edit/delete (own).
        .contextMenu {
            if !message.isDeleted, !message.pending {
                ControlGroup {
                    ForEach(Array(EmojiCatalog.quickReactions.prefix(4)), id: \.self) { emoji in
                        Button(emoji) {
                            Task { await app.engine.toggleReaction(messageId: message.id, emoji: emoji) }
                        }
                    }
                }
                .controlGroupStyle(.compactMenu)
                Button {
                    showReactionPicker = true
                } label: {
                    Label("Add Reaction…", systemImage: "face.smiling")
                }
                if showThreadAffordances {
                    Button {
                        onOpenThread(message.threadRootId ?? message.id)
                    } label: {
                        Label("Reply in Thread", systemImage: "bubble.left.and.bubble.right")
                    }
                }
                if !message.body.isEmpty {
                    Button {
                        UIPasteboard.general.string = message.body
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                }
                if isMine {
                    Button {
                        onEdit(message)
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .confirmationDialog(
            "Delete this message?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { onDelete(message) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This can't be undone.")
        }
        .sheet(isPresented: $showReactionPicker) {
            EmojiPickerView { emoji in
                showReactionPicker = false
                Task { await app.engine.toggleReaction(messageId: message.id, emoji: emoji) }
            }
            .presentationDetents([.height(340)])
        }
    }

    /// Reply count + first-4 participant avatar stack; tap pushes the thread.
    private var threadAffordance: some View {
        Button {
            onOpenThread(message.id)
        } label: {
            HStack(spacing: 6) {
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
                .foregroundStyle(MC.accent)
            }
        }
        .buttonStyle(.plain)
        .padding(.top, 3)
        .accessibilityIdentifier("msg.openThread")
    }

    /// Reaction chips with counts; tap toggles the caller's reaction.
    private var reactionChips: some View {
        HStack(spacing: 4) {
            ForEach(message.reactions, id: \.emoji) { agg in
                let mine = currentUserId.map { agg.userIds.contains($0) } ?? false
                Button {
                    Task { await app.engine.toggleReaction(messageId: message.id, emoji: agg.emoji) }
                } label: {
                    HStack(spacing: 3) {
                        Text(agg.emoji).font(.system(size: 13))
                        Text("\(agg.count)")
                            .font(.caption2.bold())
                            .foregroundStyle(mine ? MC.accentSoft : MC.inkSoft)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(mine ? MC.accent.opacity(0.10) : .white))
                    .overlay(
                        Capsule().strokeBorder(
                            mine ? MC.accentSoft.opacity(0.4) : MC.hairline, lineWidth: 1
                        )
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("msg.reaction.\(agg.emoji)")
                .accessibilityValue("\(agg.count)\(mine ? " including you" : "")")
            }
        }
        .padding(.top, 2)
    }

    // MARK: - Body blocks (shared MarkdownBlocks grammar, macOS-parity styling)

    /// Paragraphs keep the inline attributed pass (mention pills, inline
    /// markdown); quote runs get a 3pt accent bar with "> " markers stripped;
    /// fenced code renders monospaced in a warm block, fence markers hidden.
    @ViewBuilder
    private func bodyContent(_ segments: [MarkdownBlocks.Segment]) -> some View {
        if segments.count == 1, case .paragraph(let text) = segments[0] {
            // Fast path: single plain paragraph keeps baseline-aligned markers.
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
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text.isEmpty ? " " : text)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(MC.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
            }
            .background(RoundedRectangle(cornerRadius: 8).fill(MC.codeBg))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
            .accessibilityIdentifier("msg.codeBlock")
        case .table(let header, let align, let rows):
            MarkdownTableView(
                header: header, align: align, rows: rows,
                userNames: userNames, currentUserId: currentUserId
            )
        }
    }

    private func paragraphText(_ text: String) -> some View {
        Text(MentionRendering.attributed(text, names: userNames, currentUserId: currentUserId))
            .font(.callout)
            .foregroundStyle(MC.ink)
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
}

// MARK: - Emoji picker (reactions)

/// Grid + search picker (web parity), presented as a sheet from the
/// long-press menu. Reuses the shared EmojiCatalog.
struct EmojiPickerView: View {
    let onPick: (String) -> Void
    @State private var search = ""

    private var results: [String] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return EmojiCatalog.quickReactions }
        var seen = Set<String>()
        return EmojiCatalog.shortcodes
            .filter { $0.key.contains(q) }
            .sorted {
                ($0.key.hasPrefix(q) ? 0 : 1, $0.key.count, $0.key)
                    < ($1.key.hasPrefix(q) ? 0 : 1, $1.key.count, $1.key)
            }
            .compactMap { seen.insert($0.value).inserted ? $0.value : nil }
    }

    var body: some View {
        VStack(spacing: 10) {
            TextField("Search emoji", text: $search)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("emoji.search")
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 10) {
                    ForEach(results, id: \.self) { emoji in
                        Button(emoji) { onPick(emoji) }
                            .buttonStyle(.plain)
                            .font(.system(size: 28))
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(14)
    }
}

// MARK: - Edit sheet (operator-ruled: sheet editor, like macOS)

struct EditMessageSheet: View {
    let message: Message
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @FocusState private var focused: Bool

    init(message: Message) {
        self.message = message
        _text = State(initialValue: message.body)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                TextField("Message", text: $text, axis: .vertical)
                    .lineLimit(3...12)
                    .focused($focused)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(MC.base))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(MC.hairline2))
                    .padding(14)
            }
            .navigationTitle("Edit Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await app.engine.editMessage(id: message.id, body: text) }
                        dismiss()
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }
}

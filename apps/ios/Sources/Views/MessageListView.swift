import SwiftUI

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
            // First open must land on the newest message (same rationale as
            // macOS: scrollTo from onAppear runs before lazy rows lay out).
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
                    } else if message.pending {
                        ProgressView().controlSize(.mini)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.top, showHeader ? 10 : 1)
        .padding(.bottom, 1)
        .opacity(message.pending ? 0.55 : 1)
        .contentShape(Rectangle())
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

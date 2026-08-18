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
    /// The channel's history page is still in flight (#191). Drives the loading
    /// states below — an empty transcript with no explanation reads as a lost
    /// conversation, which on a slow link is what it was reported as.
    var isLoadingHistory: Bool = false
    let showThreadAffordances: Bool
    /// Thread roots holding an unread notification for me (#270) — their reply
    /// chips get a dot, so a reply that needs you is visible here and not only
    /// in the sidebar badge.
    var unreadThreadRootIds: Set<String> = []
    let onLoadOlder: () -> Void
    let onOpenThread: (String) -> Void
    let onEdit: (Message) -> Void
    let onDelete: (Message) -> Void
    /// Jump-to-message target (phase 12): scroll it into view + flash it once
    /// it's in the list, then call onFocused. Nil in the normal case.
    var focusMessageId: String? = nil
    var onFocused: () -> Void = {}
    /// Passed straight to each row: tapping a sender opens their card (#223).
    var onOpenProfile: (String) -> Void = { _ in }

    /// The row currently flashing after a jump (fades out on a timer).
    @State private var flashId: String?
    /// Bottom edge of the content and height of the viewport, both in the
    /// scroll view's own space — their difference is how far we are above the
    /// newest message (#111).
    @State private var contentBottom: CGFloat = 0
    @State private var viewportHeight: CGFloat = 0
    /// The list follows new messages down while this is true. Only a
    /// deliberate back-scroll clears it (see `reactToScroll`) — geometry
    /// churn from the keyboard or late-loading content must not, which is the
    /// bug that used to strand the list mid-history behind a jump button.
    @State private var pinToBottom = true
    /// True once the reader has actually dragged this list. Before that the
    /// list owns its own position and stays at the bottom no matter what the
    /// measurements say.
    @State private var hasDragged = false
    @State private var isDragging = false

    private static let scrollSpace = "messageScroll"
    /// Within this much of the end still counts as "at the bottom", so a
    /// part-scrolled last message doesn't raise the button.
    private static let bottomSlack: CGFloat = 120
    /// Back-scroll shorter than this is a nudge, not a decision to stop
    /// following the conversation.
    private static let minBackScroll: CGFloat = 200
    /// When to re-assert the bottom after a transcript first has content, in
    /// nanoseconds from the previous pass. Three passes across ~600ms covers a
    /// LazyVStack resolving its row estimates without a poll that outlives the
    /// settling.
    private static let settleDelays: [UInt64] = [50_000_000, 150_000_000, 400_000_000]

    /// How far the newest message sits below the viewport.
    private var distanceFromBottom: CGFloat { max(0, contentBottom - viewportHeight) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    // With something cached, the top of the list says the rest
                    // is still coming, instead of the transcript simply
                    // starting wherever the cache happens to end (#191). With
                    // nothing cached the centered state below speaks instead,
                    // so the two never both appear. Once the page lands this
                    // becomes the ordinary "Load earlier messages" affordance.
                    if isLoadingHistory, !messages.isEmpty {
                        loadingRow("Loading earlier messages…")
                    } else if hasMore {
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
                                    threadUnread: unreadThreadRootIds.contains(message.id),
                                    highlighted: message.id == flashId,
                                    onOpenThread: onOpenThread,
                                    onEdit: onEdit,
                                    onDelete: onDelete,
                                    onOpenProfile: onOpenProfile
                                )
                            }
                        }
                        .id(message.id)
                    }
                }
                .padding(.vertical, 8)
                .background(
                    GeometryReader { geo in
                        let frame = geo.frame(in: .named(Self.scrollSpace))
                        Color.clear
                            .onAppear { contentBottom = frame.maxY }
                            .onChange(of: frame) { old, new in
                                contentBottom = new.maxY
                                // Post-layout correction (#191), the same glue
                                // macOS uses. The id-driven follow above fires
                                // before the new geometry exists, and not at all
                                // when the *viewport* is what changed — which is
                                // the keyboard. Re-stick to the end here, once
                                // the numbers are real and the rows near the end
                                // are laid out, so a `LazyVStack`'s estimates for
                                // everything above can't put us in empty space.
                                //
                                // The gates are in TranscriptFollow, with the
                                // reasoning for each — chiefly that an ordinary
                                // scroll must not trigger this (#159), and that
                                // before the reader's first drag the list owns
                                // its position and corrects itself in either
                                // direction (#280).
                                guard TranscriptFollow.shouldRestick(
                                    pinned: pinToBottom,
                                    hasDragged: hasDragged,
                                    isDragging: isDragging,
                                    hasFocusTarget: focusMessageId != nil,
                                    old: old, new: new,
                                    viewportHeight: viewportHeight,
                                    bottomSlack: Self.bottomSlack
                                ), let lastId = messages.last?.id else { return }
                                proxy.scrollTo(lastId, anchor: .bottom)
                            }
                    }
                )
            }
            .coordinateSpace(name: Self.scrollSpace)
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { viewportHeight = geo.size.height }
                        .onChange(of: geo.size.height) { _, new in
                            viewportHeight = new
                            // The keyboard raising or dropping is a viewport
                            // change with no content change, so the glue above
                            // may not fire — re-stick explicitly (#191).
                            guard focusMessageId == nil, pinToBottom, !isDragging else { return }
                            if let lastId = messages.last?.id {
                                proxy.scrollTo(lastId, anchor: .bottom)
                            }
                        }
                }
            )
            .overlay { emptyTranscriptState }
            .overlay(alignment: .bottom) { jumpToLatest(proxy) }
            .animation(.easeOut(duration: 0.15), value: pinToBottom)
            // Only a finger on the glass may stop the list following the end.
            .simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { _ in
                        isDragging = true
                        hasDragged = true
                    }
                    .onEnded { _ in isDragging = false }
            )
            .onChange(of: distanceFromBottom) { _, _ in reactToScroll() }
            .onChange(of: messages.last?.id) { _, newId in
                guard focusMessageId == nil, newId != nil else { return }
                // My own message always wins. I just pressed send, so I mean to
                // see it land — being back-scrolled, or having the keyboard
                // resize the list out from under the measurements, doesn't
                // change that.
                if let me = currentUserId, messages.last?.userId == me {
                    pinToBottom = true
                }
                // Otherwise follow the end only when we were already there:
                // someone reading back-scroll keeps their place (#111).
                guard pinToBottom else { return }
                if let lastId = messages.last?.id {
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
            // The single scroll driver. Everything else that moves this list
            // targets the same bottom edge, so nothing can disagree with it —
            // macOS blanked its transcript exactly this way by installing a
            // second one (see the NOTE in its MessageListView).
            //
            // On iOS 18+ the anchor is scoped to initial offset + alignment
            // only. The default all-roles form also re-anchors on *content
            // size changes*, and a LazyVStack resizes mid-scroll as real row
            // heights replace its estimates — the framework itself yanked any
            // short back-pull (under `minBackScroll`) straight back to the
            // bottom on release. Following new messages is our follow/glue's
            // job, which respects the pin state; the anchor must not compete.
            .modifier(BottomAnchor())
            // Keyboard dismissal (tap + scroll) is applied by the screen that
            // owns the composer, so it can cover the whole chat area rather
            // than just this list — see ChannelScreen (#139).
            // Jump-to-message (phase 12): center + flash the target once it's in
            // the list (older history pages in via ChannelScreen), then release.
            .onChange(of: focusMessageId) { _, _ in tryFocus(proxy) }
            .onChange(of: messages.count) { _, _ in tryFocus(proxy) }
            .onAppear { tryFocus(proxy) }
            // Belt to the glue's braces (#280). The glue can only correct a bad
            // initial offset if the content frame moves; when the LazyVStack's
            // estimate is wrong and *stays* wrong, nothing fires and the list
            // sits in empty space until a drag clamps it — which is what the
            // report showed. Re-assert the end a few times while the layout is
            // still settling. Same target as every other driver here, so it
            // cannot disagree with them, and `hasDragged` means it stops the
            // moment the reader takes over.
            .task(id: messages.first?.id) {
                guard focusMessageId == nil, !messages.isEmpty else { return }
                for delay in Self.settleDelays {
                    try? await Task.sleep(nanoseconds: delay)
                    guard !hasDragged, pinToBottom, focusMessageId == nil,
                          let lastId = messages.last?.id else { return }
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            }
        }
    }

    /// Turns measured scroll position into the follow/don't-follow decision.
    /// Gated on an actual drag: before the reader touches the list, the
    /// measurements are just layout settling and mean nothing.
    private func reactToScroll() {
        guard hasDragged else { return }
        if distanceFromBottom > Self.minBackScroll {
            pinToBottom = false
        } else if distanceFromBottom <= Self.bottomSlack {
            pinToBottom = true
        }
    }

    /// A spinner and a line of text, for the two places the list has to say
    /// "still arriving" rather than render nothing (#191).
    private func loadingRow(_ text: String) -> some View {
        HStack(spacing: 8) {
            Spacer()
            ProgressView().controlSize(.small)
            Text(text)
                .font(.callout)
                .foregroundStyle(MC.faint)
            Spacer()
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("msg.loading")
    }

    /// Nothing to show yet. An empty transcript is two different situations —
    /// history still on its way, or a conversation with nothing in it — and the
    /// bug this fixes is that both used to render as bare background, so a slow
    /// link looked exactly like a lost conversation (#191).
    @ViewBuilder
    private var emptyTranscriptState: some View {
        if messages.isEmpty {
            if isLoadingHistory {
                loadingRow("Loading conversation…")
            } else {
                Text("No messages yet")
                    .font(.callout)
                    .foregroundStyle(MC.faint)
                    .accessibilityIdentifier("msg.emptyChannel")
            }
        }
    }

    /// Floating "Latest msgs ↓" pill, shown while the reader is above the end
    /// of the transcript (#111). Tapping it returns to the newest message.
    @ViewBuilder
    private func jumpToLatest(_ proxy: ScrollViewProxy) -> some View {
        if !pinToBottom, !messages.isEmpty {
            Button {
                pinToBottom = true
                if let lastId = messages.last?.id {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            } label: {
                Text("Latest msgs ↓")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(MC.accentSoft)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(.white).shadow(color: MC.ink.opacity(0.16), radius: 5, y: 1))
                    .overlay(Capsule().strokeBorder(MC.hairline, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .padding(.bottom, 12)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
            .accessibilityIdentifier("msg.jumpToLatest")
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

/// Bottom scroll anchor with the size-change role removed on iOS 18+ (see the
/// comment at the use site in MessageListView: the all-roles form re-anchors
/// on content size changes, which bounces a short back-pull). iOS 17 has no
/// role API and keeps the all-roles form.
struct BottomAnchor: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content
                .defaultScrollAnchor(.bottom, for: .initialOffset)
                .defaultScrollAnchor(.bottom, for: .alignment)
        } else {
            content.defaultScrollAnchor(.bottom)
        }
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
    /// This thread holds an unread notification for me (#270).
    var threadUnread: Bool = false
    /// Flashing after a jump-to-message (phase 12).
    var highlighted: Bool = false
    let onOpenThread: (String) -> Void
    let onEdit: (Message) -> Void
    let onDelete: (Message) -> Void
    /// Tapping the sender's avatar or name opens their profile card (#223).
    /// The presenting screen owns the sheet — a sheet per row would mean one
    /// presentation per message in the transcript.
    var onOpenProfile: (String) -> Void = { _ in }

    @EnvironmentObject private var app: AppState
    @State private var showReactionPicker = false
    @State private var showDeleteConfirm = false
    /// A pending row renders at full strength; it only dims (and shows the
    /// mini spinner) once the send has gone unconfirmed past this window.
    private static let pendingDimDelay: TimeInterval = 3
    @State private var pendingSlow = false

    private var senderName: String { userNames[message.userId] ?? "Unknown" }
    private var isMine: Bool { message.userId == currentUserId }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if showHeader {
                Button {
                    onOpenProfile(message.userId)
                } label: {
                    AvatarChip(
                        userId: message.userId,
                        name: senderName,
                        avatarPath: app.avatarPaths[message.userId],
                        size: 38,
                        radius: 11
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("msg.avatar.\(message.id)")
                .accessibilityLabel("\(senderName)'s profile")
            } else {
                Color.clear.frame(width: 38, height: 1)
            }

            VStack(alignment: .leading, spacing: 2) {
                if showHeader {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Button {
                            onOpenProfile(message.userId)
                        } label: {
                            Text(senderName)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(MC.ink)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("msg.sender.\(message.id)")
                        .accessibilityLabel("\(senderName)'s profile")
                        if let emoji = userStatuses[message.userId], !emoji.isEmpty {
                            Text(emoji).font(.system(size: 14))
                        }
                        Text(ISO8601.displayTime(message.createdAt))
                            .font(.system(size: 11))
                            .foregroundStyle(MC.faint)
                    }
                }

                if message.pinnedAt != nil, !message.isDeleted {
                    Label("Pinned", systemImage: "pin.fill")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(MC.accentSoft)
                        .accessibilityIdentifier("msg.pinned.\(message.id)")
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
                    } else if pendingSlow, message.files.isEmpty {
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

                    if isThinkingRow {
                        interruptButton
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
        .opacity(pendingSlow ? 0.55 : 1)
        // Keyed off createdAt so a row remount mid-wait doesn't restart the
        // clock; the id change on pending -> confirmed resets the state.
        .task(id: message.pending) {
            guard message.pending else {
                pendingSlow = false
                return
            }
            let elapsed = ISO8601.parse(message.createdAt)
                .map { Date().timeIntervalSince($0) } ?? 0
            let remaining = Self.pendingDimDelay - elapsed
            if remaining > 0 {
                try? await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
            }
            if !Task.isCancelled { pendingSlow = true }
        }
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
                if !message.failed {
                    Button {
                        Task { await app.engine.togglePin(message) }
                    } label: {
                        Label(
                            message.pinnedAt == nil ? "Pin Message" : "Unpin Message",
                            systemImage: message.pinnedAt == nil ? "pin" : "pin.slash"
                        )
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
                // A reply in here needs you (#270) — the sidebar badge says the
                // channel has something, this says which thread.
                if threadUnread {
                    Circle()
                        .fill(MC.unread)
                        .frame(width: 7, height: 7)
                        .accessibilityIdentifier("msg.threadUnread")
                        .accessibilityLabel("Unread reply")
                }
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

    /// An agent's live "thinking…" row carries its own stop control (#67).
    private var isThinkingRow: Bool {
        app.agentIds.contains(message.userId) && AgentStatus.isThinkingRow(message.body)
    }

    /// True once we've asked: the reaction is already ours, so the bridge has
    /// the signal and the turn is on its way down.
    private var stopping: Bool {
        guard let me = currentUserId else { return false }
        return message.reactions.contains { $0.emoji == AgentStatus.interruptEmoji && $0.userIds.contains(me) }
    }

    /// Interrupt: adds the 🛑 reaction the bridge maps back to the running turn.
    private var interruptButton: some View {
        Button {
            guard !stopping else { return }
            Task { await app.engine.toggleReaction(messageId: message.id, emoji: AgentStatus.interruptEmoji) }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "stop.circle")
                Text(stopping ? "Stopping…" : "Interrupt")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(stopping ? MC.faint : MC.inkSoft)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(.white))
            .overlay(Capsule().strokeBorder(MC.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(stopping)
        .accessibilityIdentifier("msg.interrupt.\(message.id)")
        .padding(.top, 3)
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
        Group {
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
        // Same row layout as macOS, so the same #161 hazard: the body shares a
        // VStack with unfurl cards and attachments, and is the only vertically
        // flexible child. Without this it is the one that gives way when the
        // row's ideal height exceeds what the list proposes.
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func segmentView(_ segment: MarkdownBlocks.Segment) -> some View {
        switch segment {
        case .paragraph(let text):
            paragraphText(text)
        case .quote(let text):
            // Same overlay-not-sibling fix as macOS (#195): a Shape sibling has
            // no ideal height, so it absorbed space the quoted text needed and
            // the bar ran on below the last line. See the macOS comment.
            paragraphText(text)
                .foregroundStyle(MC.inkSoft)
                .padding(.leading, 11)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(MC.accent.opacity(0.55))
                        .frame(width: 3)
                }
                .accessibilityIdentifier("msg.quoteBlock")
        case .heading(let level, let text):
            headingText(level: level, text: text)
        case .code(let text):
            // The copy button (#260) overlays the scroller, not its content —
            // pinned to the block's corner, it stays put while the code scrolls
            // under it, which is the whole point of it on a phone. Bottom
            // trailing to match macOS and web, where the row's hover menu owns
            // the top-trailing corner.
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text.isEmpty ? " " : text)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(MC.ink)
                    .padding(.leading, 10)
                    .padding(.trailing, 36)
                    .padding(.vertical, 8)
            }
            .background(RoundedRectangle(cornerRadius: 8).fill(MC.codeBg))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
            .overlay(alignment: .bottomTrailing) {
                CodeCopyButton(source: text).padding(4)
            }
            .accessibilityIdentifier("msg.codeBlock")
        case .mermaid(let source):
            MermaidDiagramView(source: source)
        case .table(let header, let align, let rows):
            MarkdownTableView(
                header: header, align: align, rows: rows,
                userNames: userNames, currentUserId: currentUserId
            )
        case .ulist(let items):
            listView(items.map { (marker: "•", text: $0) })
        case .olist(let start, let items):
            listView(items.enumerated().map { (marker: "\(start + $0.offset).", text: $0.element) })
        case .hr:
            Rectangle()
                .fill(MC.hairline)
                .frame(height: 1)
                .padding(.vertical, 3) // web's my-2 on <hr>
                .accessibilityIdentifier("msg.rule")
        }
    }

    /// macOS-parity lists: a marker column plus the normal inline pass on each
    /// item, so mentions and `**bold**` still render inside items. Markers are
    /// right-aligned in a fixed column to keep multi-digit numbers lined up.
    private func listView(_ items: [(marker: String, text: String)]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.marker)
                        .font(.callout)
                        .foregroundStyle(MC.inkSoft)
                        .frame(minWidth: 16, alignment: .trailing)
                    paragraphText(item.text)
                }
            }
        }
        .padding(.leading, 2)
        .accessibilityIdentifier("msg.list")
    }

    /// ATX headings at macOS parity, rebased on iOS's larger body text:
    /// `.callout` is 16pt here, so web's ratios put h1 at 21 and h2 at 19,
    /// with h3–h6 body-size and separated by weight (as `HEADING_CLASS` does).
    private func headingText(level: Int, text: String) -> some View {
        let size: CGFloat = level == 1 ? 21 : (level == 2 ? 19 : 16)
        return Text(MentionRendering.attributed(text, names: userNames, currentUserId: currentUserId))
            .font(.system(size: size, weight: level <= 3 ? .bold : .semibold))
            .foregroundStyle(MC.ink)
            .textSelection(.enabled)
            .padding(.top, level <= 2 ? 2 : 0) // web's mt-2 on h1/h2
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("msg.heading")
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
        if pendingSlow {
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

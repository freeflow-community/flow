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
    /// Tapping a sender's avatar opens their profile (ui_nits).
    var onOpenProfile: (String) -> Void = { _ in }
    /// Enables per-channel scroll-position memory (channels pass their id;
    /// threads omit it and always open at the newest reply).
    var scrollKey: String? = nil
    /// Jump-to-message target (phase 12): scroll it into view + flash it once
    /// it's in the list, then call onFocused. Nil in the normal case.
    var focusMessageId: String? = nil
    var onFocused: () -> Void = {}

    /// The scrollKey we've already applied a restore/bottom decision for, so a
    /// new message in the *current* channel doesn't re-trigger a restore.
    @State private var appliedKey: String?
    /// The row currently flashing after a jump (fades out on a timer).
    @State private var flashId: String?
    /// Bottom edge of the content and height of the viewport, both in the
    /// scroll view's own space — their difference is how far we are above the
    /// newest message (#111).
    @State private var contentBottom: CGFloat = 0
    @State private var viewportHeight: CGFloat = 0
    /// True while the follow is glued to the newest message. Ported from the
    /// web client's fix: distance-from-bottom alone can't tell "the user
    /// scrolled away" from "the content grew under us" — a tall message
    /// landing (or a row sizing late) flipped `atBottom` false before the
    /// follow scroll settled, latching the follow off with the jump pill up
    /// while new output piled in below. Growth never moves the content's top
    /// edge up, so only an upward scroll unpins; nearing the bottom re-pins.
    @State private var pinned = true

    private static let scrollSpace = "messageScroll"
    /// Slack-style slack: within this much of the end still counts as "at the
    /// bottom", so a part-scrolled last message doesn't raise the button.
    private static let bottomSlack: CGFloat = 120
    /// Within this much of the end, any scroll re-pins the follow (web parity).
    static let repinSlack: CGFloat = 40

    /// Purely geometric "near the end" — drives the jump pill, not the follow.
    private var atBottom: Bool { contentBottom - viewportHeight <= Self.bottomSlack }
    /// Raise the pill only when unpinned *and* visibly short of the end, so a
    /// tall message landing while pinned doesn't flicker it up mid-glue.
    private var showJump: Bool { !pinned && !atBottom }

    /// What a content-frame change (in the scroll view's space) means for the
    /// follow, in checking order. Pure so the tests can pin the semantics.
    enum FollowDecision: Equatable {
        case pin    // near the bottom → (re)pin the follow
        case unpin  // the content's top edge moved down: an upward scroll
        case glue   // content grew under a pinned reader → re-scroll to newest
        case none
    }

    static func followDecision(
        pinned: Bool, old: CGRect, new: CGRect, viewportHeight: CGFloat
    ) -> FollowDecision {
        if new.maxY - viewportHeight <= repinSlack { return .pin }
        if new.minY > old.minY + 1 { return .unpin }
        if pinned && new.height > old.height + 1 { return .glue }
        return .none
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if hasMore {
                        HStack {
                            Spacer()
                            Button("Load earlier messages", action: onLoadOlder)
                                .buttonStyle(.link)
                                .flowFont(.callout)
                                .pointingHandCursor()
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
                                    onDelete: onDelete,
                                    onOpenProfile: onOpenProfile
                                )
                            }
                        }
                        .id(message.id)
                    }
                }
                .padding(.vertical, 8)
                // Scroll tracking (#111) + the pinned follow. The glue scroll
                // below is the one sanctioned second driver: it only ever
                // targets the same bottom edge as .defaultScrollAnchor, so the
                // two can't disagree the way the removed scrollPosition(id:)
                // did (see the note below).
                .background(
                    GeometryReader { geo in
                        let frame = geo.frame(in: .named(Self.scrollSpace))
                        Color.clear
                            .onAppear { contentBottom = frame.maxY }
                            .onChange(of: frame) { old, new in
                                switch Self.followDecision(
                                    pinned: pinned, old: old, new: new,
                                    viewportHeight: viewportHeight
                                ) {
                                case .pin: pinned = true
                                case .unpin: pinned = false
                                case .glue:
                                    // Post-layout correction: the id-driven
                                    // follow fires before the new row has a
                                    // height (and not at all when an existing
                                    // row grows — a late image, async markdown
                                    // sizing), so re-glue here once geometry
                                    // is real.
                                    if focusMessageId == nil, let lastId = messages.last?.id {
                                        withAnimation(.easeOut(duration: 0.15)) {
                                            proxy.scrollTo(lastId, anchor: .bottom)
                                        }
                                    }
                                case .none: break
                                }
                                contentBottom = new.maxY
                            }
                    }
                )
            }
            .coordinateSpace(name: Self.scrollSpace)
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { viewportHeight = geo.size.height }
                        .onChange(of: geo.size.height) { _, new in viewportHeight = new }
                }
            )
            .overlay(alignment: .bottom) { jumpToLatest(proxy) }
            .animation(.easeOut(duration: 0.15), value: showJump)
            // NOTE (scroll-blanking fix): there used to be a
            // `.scrollPosition(id: $topVisibleId, anchor: .top)` here feeding
            // MessageScrollMemory. It never actually tracked anything —
            // scrollPosition(id:) only reports a position when the lazy stack
            // is marked `.scrollTargetLayout()`, which it isn't — so scroll
            // memory was already inert. What it *did* do was install a second
            // scroll driver alongside .defaultScrollAnchor(.bottom); when the
            // composer changed height (attachment tray, a draft wrapping to a
            // second line) the two disagreed, the content height ballooned and
            // the list scrolled into empty space, blanking the transcript.
            // Re-adding scroll memory means adding .scrollTargetLayout() and
            // reconciling it with the bottom anchor — not just this modifier.
            .onChange(of: messages.last?.id) { _, newId in
                // A pending jump owns the scroll position — skip both the
                // scroll-memory restore and the follow-to-bottom (tryFocus
                // handles the scroll, and marks appliedKey so this doesn't
                // re-fire a restore once the target is cleared).
                guard focusMessageId == nil, let newId else { return }
                if scrollKey != appliedKey {
                    // The channel just (re)loaded: restore a remembered position
                    // if it's fresh and still present, else land at the bottom.
                    appliedKey = scrollKey
                    if let key = scrollKey, let remembered = MessageScrollMemory.fresh(key),
                       messages.contains(where: { $0.id == remembered }) {
                        pinned = false // mid-history: don't let the glue yank us down
                        proxy.scrollTo(remembered, anchor: .top)
                    } else {
                        pinned = true
                        proxy.scrollTo(newId, anchor: .bottom)
                    }
                } else if pinned {
                    // A genuinely new message in the current channel → follow it
                    // down, but only while pinned: someone reading back-scroll
                    // keeps their place and gets the jump button instead (#111).
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
            .onChange(of: focusMessageId) { _, _ in tryFocus(proxy) }
            // A jump target may arrive only after older history pages in.
            .onChange(of: messages.count) { _, _ in tryFocus(proxy) }
            .onAppear { tryFocus(proxy) }
        }
    }

    /// Floating "Latest msgs ↓" pill, shown while the reader is above the end
    /// of the transcript (#111). Tapping it returns to the newest message.
    @ViewBuilder
    private func jumpToLatest(_ proxy: ScrollViewProxy) -> some View {
        if showJump, let lastId = messages.last?.id {
            Button {
                pinned = true
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            } label: {
                Text("Latest msgs ↓")
                    .flowFont(size: 12, weight: .semibold)
                    .foregroundStyle(MC.accentSoft)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Capsule().fill(.white).shadow(color: MC.ink.opacity(0.14), radius: 4, y: 1))
                    .overlay(Capsule().strokeBorder(MC.hairline, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
            .padding(.bottom, 10)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
            .accessibilityIdentifier("msg.jumpToLatest")
        }
    }

    /// Center + flash the jump target once it's actually in the list, then
    /// release the target (paging in ChannelView brings it in if it's old).
    private func tryFocus(_ proxy: ScrollViewProxy) {
        guard let fid = focusMessageId, messages.contains(where: { $0.id == fid }) else { return }
        pinned = false // stop the bottom-glue from fighting the centering scroll
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(fid, anchor: .center)
        }
        // The jump decided this channel's scroll position — mark it applied so
        // the scroll-memory restore doesn't yank away once focus is cleared.
        appliedKey = scrollKey
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
                .flowFont(size: 11)
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
                .flowFont(size: 11)
                .foregroundStyle(MC.faint)
            Spacer()
        }
        .padding(.vertical, 4)
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
    var onOpenProfile: (String) -> Void = { _ in }

    @EnvironmentObject private var app: AppState
    @Environment(\.textZoom) private var textZoom
    @State private var hovering = false
    @State private var showReactionPicker = false
    @State private var showDeleteConfirm = false
    @State private var hoverHideWork: DispatchWorkItem?

    private var senderName: String { userNames[message.userId] ?? "Unknown" }
    private var isMine: Bool { message.userId == currentUserId }

    /// Hover-menu hysteresis (ui_nits: menu "stutters"/blinks while hovering).
    /// The toolbar is an overlay pinned to the row's top-trailing edge, so the
    /// cursor travelling from the message text up onto the pill briefly leaves
    /// the row's hover region. Flipping `hovering` off synchronously unmounts
    /// the pill mid-travel — the cursor is then over empty space, the row
    /// re-hovers, and it flickers back. Debounce the hide (and cancel it the
    /// moment the cursor lands on the pill, which carries its own `.onHover`)
    /// so the menu holds still long enough to aim at.
    private func setHovering(_ inside: Bool) {
        hoverHideWork?.cancel()
        if inside {
            hovering = true
        } else {
            let work = DispatchWorkItem { hovering = false }
            hoverHideWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if showHeader {
                Button {
                    onOpenProfile(message.userId)
                } label: {
                    AvatarChip(
                        userId: message.userId,
                        name: senderName,
                        avatarPath: avatarPath,
                        size: 38,
                        radius: 11
                    )
                }
                .buttonStyle(.plain)
                .help("View \(senderName)'s profile")
                .accessibilityIdentifier("message.avatar.\(message.userId)")
            } else {
                Color.clear.frame(width: 38, height: 1)
            }

            VStack(alignment: .leading, spacing: 2) {
                if showHeader {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(senderName)
                            .flowFont(size: 14, weight: .bold)
                            .foregroundStyle(MC.ink)
                        if let emoji = userStatuses[message.userId], !emoji.isEmpty {
                            Text(emoji).flowFont(size: 14)
                        }
                        Text(ISO8601.displayTime(message.createdAt))
                            .flowFont(size: 11)
                            .foregroundStyle(MC.faint)
                    }
                }

                if message.pinnedAt != nil, !message.isDeleted {
                    Label("Pinned", systemImage: "pin.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(MC.accentSoft)
                        .help(pinnedHelp)
                        .accessibilityIdentifier("msg.pinned.\(message.id)")
                }

                if message.isDeleted {
                    Text("This message was deleted")
                        .flowFont(.callout)
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
                            },
                            onPin: { pinLinkAsArtifact(unfurl.target) }
                        )
                    }

                    if message.failed {
                        sendFailedFooter
                    }

                    if isThinkingRow {
                        interruptButton
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
                            .flowFont(.caption)
                        }
                    }
                    .buttonStyle(.link)
                    // Hand cursor on hover (ui_nits).
                    .pointingHandCursor()
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .padding(.top, showHeader ? 10 : 1)
        .padding(.bottom, 1)
        .background(highlighted ? MC.unread.opacity(0.16) : Color.clear)
        .animation(.easeOut(duration: 0.6), value: highlighted)
        .opacity(message.pending ? 0.55 : 1)
        .contentShape(Rectangle())
        .onHover { setHovering($0) }
        // Hover menu (web parity, ui_nits items 2+3): react / reply-in-thread,
        // plus edit + delete on the author's own messages. The menu must stay
        // mounted while the picker is open: the react button is the popover's
        // anchor, and moving the mouse toward the popover leaves the row
        // (hovering -> false) — unmounting the anchor would tear the popover
        // down (operator-reported bug at the item-6 checkpoint).
        .overlay(alignment: .topTrailing) {
            if hovering || showReactionPicker || showDeleteConfirm,
               !message.isDeleted, !message.pending, !message.failed {
                hoverMenu
                    .padding(.trailing, 22)
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
        .contextMenu {
            if !message.isDeleted, !message.pending, !message.failed {
                ForEach(Array(EmojiCatalog.quickReactions.prefix(6)), id: \.self) { emoji in
                    Button(emoji) {
                        Task { await app.engine.toggleReaction(messageId: message.id, emoji: emoji) }
                    }
                }
                Divider()
            }
            if message.failed {
                Button("Retry Send") { Task { await app.engine.retrySend(message) } }
                Button("Discard", role: .destructive) { Task { await app.engine.discardFailed(message) } }
                Divider()
            }
            if showThreadAffordances, !message.failed {
                Button("Reply in Thread") {
                    onOpenThread(message.threadRootId ?? message.id)
                }
            }
            if !message.body.isEmpty, !message.isDeleted, !message.pending {
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(message.body, forType: .string)
                }
            }
            if !message.isDeleted, !message.pending, !message.failed {
                Button(message.pinnedAt == nil ? "Pin Message" : "Unpin Message") {
                    Task { await app.engine.togglePin(message) }
                }
            }
            if !message.files.isEmpty, !message.isDeleted, !message.pending {
                Button("Pin as Artifact") { pinAsArtifact() }
            }
            if isMine, !message.isDeleted, !message.pending {
                Button("Edit…") { onEdit(message) }
                Button("Delete", role: .destructive) { showDeleteConfirm = true }
            }
        }
    }

    /// One-tap quick reactions shown first in the hover menu — same three
    /// glyphs and order as the web client's `QUICK_REACTIONS`.
    private static let quickReactions = ["👍", "👀", "🙌"]

    /// Web-parity hover menu card: white pill with hairline border, one
    /// borderless icon button per action (design 3a tokens). Buttons use the
    /// same emoji glyphs as the web client so the two menus read identically:
    /// three one-tap reactions, a hairline divider, then 🙂 / 💬 / 📋 / save /
    /// edit / delete gated by the same conditions.
    private var hoverMenu: some View {
        HStack(spacing: 2) {
            ForEach(Self.quickReactions, id: \.self) { emoji in
                MenuIconButton(help: "React \(emoji)") {
                    Task { await app.engine.toggleReaction(messageId: message.id, emoji: emoji) }
                } label: {
                    Text(emoji)
                }
                .accessibilityIdentifier("msg.quickReact.\(emoji)")
            }

            Rectangle()
                .fill(MC.hairline)
                .frame(width: 1, height: 22)
                .padding(.horizontal, 2)

            MenuIconButton(help: "Add reaction") {
                showReactionPicker = true
            } label: {
                Text("🙂")
            }
            .accessibilityIdentifier("msg.addReaction")
            .popover(isPresented: $showReactionPicker) {
                EmojiPickerView { emoji in
                    showReactionPicker = false
                    Task { await app.engine.toggleReaction(messageId: message.id, emoji: emoji) }
                }
            }

            if showThreadAffordances {
                MenuIconButton(help: "Reply in thread") {
                    onOpenThread(message.threadRootId ?? message.id)
                } label: {
                    Text("💬")
                }
                .accessibilityIdentifier("msg.replyInThread")
            }

            if !message.body.isEmpty {
                MenuIconButton(help: "Copy text") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(message.body, forType: .string)
                } label: {
                    Text("📋")
                }
                .accessibilityIdentifier("msg.copy")
            }

            MenuIconButton(help: message.pinnedAt == nil ? "Pin message" : "Unpin message") {
                Task { await app.engine.togglePin(message) }
            } label: {
                Image(systemName: message.pinnedAt == nil ? "pin" : "pin.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(message.pinnedAt == nil ? MC.inkSoft : MC.accentSoft)
            }
            .accessibilityIdentifier("msg.togglePin")

            if !message.files.isEmpty {
                MenuIconButton(help: "Pin as artifact", action: pinAsArtifact) {
                    // Web draws this one as an inline SVG (box + leaving arrow);
                    // the matching SF Symbol keeps the same open-external read.
                    Image(systemName: "arrow.up.right.square")
                        .flowFont(size: 15)
                        .foregroundStyle(MC.inkSoft)
                }
                .accessibilityIdentifier("msg.saveArtifact")
            }

            if isMine {
                MenuIconButton(help: "Edit") {
                    onEdit(message)
                } label: {
                    Text("✏️")
                }
                .accessibilityIdentifier("msg.edit")
                MenuIconButton(help: "Delete") {
                    showDeleteConfirm = true
                } label: {
                    Text("🗑")
                }
                .accessibilityIdentifier("msg.delete")
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.white)
                .shadow(color: MC.ink.opacity(0.08), radius: 2, y: 1)
        )
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(MC.hairline, lineWidth: 1))
        // The pill sits outside the row's tracked area, so it carries its own
        // hover: landing on it cancels the pending hide and keeps the menu up.
        .contentShape(Rectangle())
        .onHover { setHovering($0) }
    }

    private var pinnedHelp: String {
        guard let pinner = message.pinnedBy else { return "Pinned to this channel" }
        return "Pinned by \(userNames[pinner] ?? "a channel member")"
    }

    /// One borderless glyph button in the hover pill. Mirrors the web buttons'
    /// `rounded-md px-1.5 py-1 … hover:bg-daypill`: a rounded daypill highlight
    /// appears under the glyph on hover.
    ///
    /// The label is drawn as our own tooltip rather than with `.help()` (#110):
    /// AppKit help tags never appeared for these buttons — the pill is mounted
    /// on hover, so it isn't around when AppKit arms its tooltip rects — and
    /// the system delay is far too long for a menu you're only over for a
    /// moment. VoiceOver still gets the text as the button's label.
    private struct MenuIconButton<Label: View>: View {
        let help: String
        let action: () -> Void
        @ViewBuilder let label: () -> Label
        @State private var hovering = false
        @State private var showTip = false
        @State private var tipWork: DispatchWorkItem?

        var body: some View {
            Button {
                hideTip()
                action()
            } label: {
                label()
                    .flowFont(size: 15)
                    .frame(width: 26, height: 24)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(hovering ? MC.daypill : .clear)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(help)
            .onHover { inside in
                hovering = inside
                if inside { scheduleTip() } else { hideTip() }
            }
            .onDisappear { hideTip() }
            .overlay(alignment: .top) {
                if showTip { tooltip }
            }
            // Lift the tip above the neighbouring buttons in the pill.
            .zIndex(showTip ? 1 : 0)
        }

        private var tooltip: some View {
            Text(help)
                .flowFont(size: 11)
                .foregroundStyle(.white)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 6).fill(MC.ink.opacity(0.92)))
                .fixedSize()
                .offset(y: 30)
                .allowsHitTesting(false)
                .transition(.opacity)
                .accessibilityHidden(true)
        }

        private func scheduleTip() {
            tipWork?.cancel()
            let work = DispatchWorkItem { showTip = true }
            tipWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
        }

        private func hideTip() {
            tipWork?.cancel()
            tipWork = nil
            showTip = false
        }
    }

    /// Pins the message's attached file(s) as shared artifacts in this channel
    /// (phase 13, idempotent server-side); the newly created artifact opens in
    /// the side panel automatically.
    private func pinAsArtifact() {
        let files = message.files
        guard !files.isEmpty else { return }
        let channelId = message.channelId
        Task {
            do {
                var last: Artifact?
                for file in files {
                    last = try await app.engine.createArtifact(channelId: channelId, fileId: file.id)
                }
                if let last { app.selectArtifact(last.id) }
            } catch {
                app.showError("Couldn't pin artifact: \(error.localizedDescription)")
            }
        }
    }

    /// Pins a link from chat as a shared co-browsing artifact in this channel
    /// (link artifacts) and opens its mini-browser in the side panel.
    private func pinLinkAsArtifact(_ url: String) {
        let channelId = message.channelId
        Task {
            do {
                let artifact = try await app.engine.createLinkArtifact(channelId: channelId, url: url)
                app.selectArtifact(artifact.id)
            } catch {
                app.showError("Couldn't pin link: \(error.localizedDescription)")
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
        Group {
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
        // The body must never be the view that gives way (#161). It shares the
        // row's VStack with attachments, unfurl cards and reactions, and a
        // multiline `Text` is the only flexible one of them: when the row's
        // ideal height exceeds the height the message list proposes, SwiftUI
        // compresses the text and the body renders cut off partway through,
        // with the card below it sitting where the rest of the prose should
        // be. `fixedSize` vertically makes the body report its wrapped height
        // as its ideal *and* its minimum, so the row grows instead. Width
        // stays flexible, so wrapping is unchanged.
        .fixedSize(horizontal: false, vertical: true)
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
        case .heading(let level, let text):
            headingText(level: level, text: text)
        case .code(let text):
            Text(text.isEmpty ? " " : text)
                .flowFont(size: 12, design: .monospaced)
                .foregroundStyle(MC.ink)
                .textSelection(.enabled)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
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

    /// ATX headings, sized as the macOS analogue of web's scale rather than a
    /// copy of its Tailwind classes: body text is `.callout` (13pt), so h1/h2
    /// step up by web's own ratios (1.29×, 1.2×) and h3–h6 stay body-size,
    /// distinguished by weight — which is what `HEADING_CLASS` does. Sizes go
    /// through `flowFont(size:)` so text zoom (#105) still applies, and the
    /// inline pass runs inside the heading so mentions and `**bold**` work.
    private func headingText(level: Int, text: String) -> some View {
        let size: CGFloat = level == 1 ? 17 : (level == 2 ? 15.5 : 13)
        let attributed = MentionRendering.attributed(
            text, names: userNames, currentUserId: currentUserId, scale: textZoom
        )
        return Text(attributed)
            .flowFont(size: size, weight: level <= 3 ? .bold : .semibold)
            .foregroundStyle(MC.ink)
            .textSelection(.enabled)
            .linkCursor(attributed)
            .padding(.top, level <= 2 ? 2 : 0) // web's mt-2 on h1/h2
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("msg.heading")
    }

    private func paragraphText(_ text: String) -> some View {
        let attributed = MentionRendering.attributed(
            text, names: userNames, currentUserId: currentUserId, scale: textZoom
        )
        return Text(attributed)
            .flowFont(.callout)
            .textSelection(.enabled)
            // Hand cursor over hyperlinks (#81) — SwiftUI hit-tests nothing
            // inside a Text, so linkCursor re-lays the string to find them.
            .linkCursor(attributed)
    }

    @ViewBuilder
    private var trailingMarkers: some View {
        if message.editedAt != nil {
            Text("(edited)")
                .flowFont(.caption2)
                .foregroundStyle(.tertiary)
        }
        if message.pending {
            ProgressView().controlSize(.mini)
        }
    }

    /// Failed-send affordance: the message stays put with an error label and a
    /// Retry button (Discard drops it). Re-sends reuse the original clientMsgId,
    /// so the server dedupes if the first POST actually landed.
    private var sendFailedFooter: some View {
        HStack(spacing: 8) {
            Label("Failed to send", systemImage: "exclamationmark.circle.fill")
                .flowFont(.caption)
                .foregroundStyle(MC.danger)
            Button("Retry") { Task { await app.engine.retrySend(message) } }
                .buttonStyle(.link)
                .flowFont(.caption, weight: .semibold)
                .pointingHandCursor()
            Button("Discard") { Task { await app.engine.discardFailed(message) } }
                .buttonStyle(.link)
                .flowFont(.caption)
                .foregroundStyle(MC.muted)
                .pointingHandCursor()
        }
        .padding(.top, 1)
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
            .flowFont(.caption, weight: .semibold)
            .foregroundStyle(stopping ? MC.faint : MC.inkSoft)
            .padding(.horizontal, 9)
            .padding(.vertical, 2)
            .background(Capsule().fill(.white))
            .overlay(Capsule().strokeBorder(MC.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(stopping)
        .pointingHandCursor()
        .help(stopping ? "Stopping…" : "Stop this agent turn")
        .accessibilityIdentifier("msg.interrupt.\(message.id)")
        .padding(.top, 2)
    }

    private var reactionChips: some View {
        HStack(spacing: 4) {
            ForEach(message.reactions, id: \.emoji) { agg in
                let mine = currentUserId.map { agg.userIds.contains($0) } ?? false
                Button {
                    Task { await app.engine.toggleReaction(messageId: message.id, emoji: agg.emoji) }
                } label: {
                    HStack(spacing: 3) {
                        Text(agg.emoji).flowFont(size: 12)
                        Text("\(agg.count)")
                            .flowFont(.caption2, weight: .bold)
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
            } else if file.isPlayableVideo {
                // webm stays a chip: AVFoundation can't decode it (Parity note).
                VideoAttachmentView(file: file)
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
                        .flowFont(size: 9, weight: .semibold)
                        .frame(width: 12)
                }
                .buttonStyle(.plain)
                .foregroundStyle(MC.faint)
                .help(collapsed ? "Show image" : "Hide image")
                .accessibilityIdentifier("msg.file.collapse.\(file.name)")
                Text(file.name)
                    .flowFont(size: 11)
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

    /// ~2x preview (ui_nits item 1). Thumbs cap at 512px (server thumbMaxPx),
    /// so large images render upscaled/soft here — noted at review.
    private var displaySize: CGSize {
        guard let w = file.width, let h = file.height, w > 0, h > 0 else {
            return CGSize(width: 480, height: 360)
        }
        let scale = min(1, 560 / CGFloat(w), 480 / CGFloat(h))
        return CGSize(width: max(60, CGFloat(w) * scale), height: max(60, CGFloat(h) * scale))
    }

    // MARK: non-image chip

    private var fileChip: some View {
        HStack(spacing: 6) {
            Button(action: open) {
                HStack(spacing: 8) {
                    Image(systemName: iconName)
                        .flowFont(.title2)
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(file.name)
                            .flowFont(.callout)
                            .lineLimit(1)
                        Text(file.sizeLabel)
                            .flowFont(.caption2)
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
                        .flowFont(size: 12, weight: .semibold)
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
                    .flowFont(size: 13, weight: .semibold)
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
            .sorted {
                ($0.key.hasPrefix(q) ? 0 : 1, $0.key.count, $0.key)
                    < ($1.key.hasPrefix(q) ? 0 : 1, $1.key.count, $1.key)
            }
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
                            .flowFont(size: 20)
                    }
                }
            }
            .frame(height: 140)
        }
        .padding(10)
        .frame(width: 300)
    }
}

import GRDB
import SwiftUI

/// Navigation payload for pushing a thread (phones push a screen; the macOS
/// side panel doesn't translate to this form factor).
struct ThreadRoute: Hashable, Identifiable {
    let rootId: String
    var id: String { rootId }
}

/// A thread: root message, reply divider, replies, and a reply composer.
/// Pushed from the channel screen; GRDB observation feeds it live, and
/// engine.openThread keeps the reply backfill running across reconnects.
struct ThreadScreen: View {
    let rootId: String
    @EnvironmentObject var app: AppState

    @StateObject private var thread = DBObserved<[Message]>(initial: [])
    @StateObject private var users = DBObserved<[User]>(initial: [])
    @StateObject private var channelId = DBObserved<String?>(initial: nil)
    /// The parent channel row, so the nav title can name the conversation this
    /// thread belongs to (#417).
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @StateObject private var currentRole = DBObserved<String?>(initial: nil)
    @State private var editingMessage: Message?
    @State private var flashId: String?
    /// The member whose profile card is open (#223) — same card the channel
    /// shows, presented over the thread instead of pushed on top of it.
    @State private var profileRoute: ProfileRoute?
    /// The single owner of this screen's follow/scroll decisions — the same
    /// model the channel transcript and the macOS thread panel use (#334/#494).
    /// Before it, this screen scrolled to the newest reply on *every* arrival:
    /// a reader who had scrolled up to re-read an earlier reply was dragged
    /// back down by everyone else's, and a `jumpOwnsScroll` latch had to be
    /// hand-maintained to keep a jump-to-reply from being overridden.
    /// `.dragDistance` is the iOS style — only a finger past the threshold
    /// unpins (#159).
    @State private var followBox = TranscriptFollowBox(style: .dragDistance)
    /// Tapping the parent channel pops back to it — this screen was pushed
    /// from it, so a pop *is* the navigation (#417).
    @Environment(\.dismiss) private var dismiss

    /// When to re-assert a jump's landing (or a reply's), in nanoseconds from
    /// the previous pass — the channel list's cadence. A `scrollTo` into a
    /// `LazyVStack` is resolved against estimated row heights, so the first one
    /// lands short and the initial-offset anchor is still settling underneath
    /// it; one scroll is not a landing (macOS learned the same in #333/#334).
    private static let settleDelays: [UInt64] = [50_000_000, 150_000_000, 400_000_000]
    private static let scrollSpace = "threadScroll"

    /// Executes a follow-model command. The one place this screen scrolls to
    /// its end — and it scrolls to the row *identity*, never a message id
    /// (#332: rows are keyed on `clientMsgId`, so a message id matches no row
    /// and silently scrolls nowhere).
    private func run(_ command: TranscriptFollowModel.Command, _ proxy: ScrollViewProxy) {
        guard case .stick(let animated) = command,
              let lastKey = thread.value.lastRowKey else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo(lastKey, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(lastKey, anchor: .bottom)
        }
    }

    private var userNames: [String: String] {
        Dictionary(users.value.map { ($0.id, $0.displayNameWithBadge) }, uniquingKeysWith: { a, _ in a })
    }

    private var statusesById: [String: String] {
        Dictionary(uniqueKeysWithValues: users.value.compactMap { u in
            (u.statusEmoji?.isEmpty == false) ? (u.id, u.statusEmoji!) : nil
        })
    }

    private var replies: [Message] {
        thread.value.filter { $0.id != rootId }
    }

    private var threadParent: (connector: String, name: String)? {
        channel.value?.threadParentLabel(userNames: userNames, currentUserId: app.currentUser?.id)
    }

    /// Nav title: "Thread" over the parent channel. The bar is too narrow on a
    /// phone to run both inline, so the channel is a second line — and its own
    /// tap target, which is why this is a principal item and not
    /// `.navigationTitle` + `.navigationSubtitle`.
    private var navTitle: some View {
        VStack(spacing: 0) {
            Text("Thread")
                .flowFont(size: 15, weight: .semibold)
                .foregroundStyle(MC.ink)
            if let parent = threadParent {
                Button(action: { dismiss() }) {
                    HStack(spacing: 3) {
                        Text(parent.connector).foregroundStyle(MC.muted)
                        Text(parent.name)
                            .foregroundStyle(MC.accent)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    .flowFont(size: 12)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("thread.header.parent")
                .accessibilityLabel("Go to \(parent.name)")
            }
        }
        .frame(maxWidth: 240)
        .accessibilityIdentifier("thread.header")
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        // Keyed on `clientMsgId` here as well as in the
                        // `.id()` below (#333/#332): keyed on the message id,
                        // an optimistic reply reconciling with its server twin
                        // reads as a delete + insert whose two views claim one
                        // `.id()`, and the leaving pending view wins — the row
                        // keeps its spinner for as long as the screen is up.
                        ForEach(thread.value, id: \.clientMsgId) { message in
                            MessageRow(
                                message: message,
                                userNames: userNames,
                                userStatuses: statusesById,
                                currentUserId: app.currentUser?.id,
                                canPermanentlyDelete: currentRole.value == "owner" || currentRole.value == "admin",
                                context: TranscriptContext(
                                    engine: app.engine,
                                    avatarPaths: app.avatarPaths,
                                    agentIds: app.agentIds,
                                    onOpenScheduled: { app.showScheduledPanel() }
                                ),
                                showHeader: true,
                                showThreadAffordances: false,
                                highlighted: message.id == flashId,
                                onOpenThread: { _ in },
                                onEdit: { editingMessage = $0 },
                                onDelete: { msg, permanently in
                                    Task { await app.engine.deleteMessage(id: msg.id, permanently: permanently) }
                                },
                                onOpenProfile: { profileRoute = ProfileRoute(userId: $0) }
                            )
                            .equatable()
                            // See MessageListView: key on clientMsgId so the
                            // optimistic reply row survives its server echo
                            // instead of remounting (and re-flashing its
                            // avatar placeholder).
                            .id(message.clientMsgId)
                            if message.id == rootId {
                                HStack {
                                    Text(replies.isEmpty
                                         ? "No replies yet"
                                         : "\(replies.count) \(replies.count == 1 ? "reply" : "replies")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    VStack { Divider() }
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 6)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                    // Geometry feeds the follow model, exactly as it does in
                    // the channel list: a content move or resize is one event,
                    // and the command it returns is the only scroll toward the
                    // end. This is what keeps a streaming reply pinned as it
                    // grows, and what leaves a back-scrolled reader alone.
                    .background(
                        GeometryReader { geo in
                            let frame = geo.frame(in: .named(Self.scrollSpace))
                            Color.clear
                                .onAppear { _ = followBox.model.contentChanged(to: frame) }
                                .onChange(of: frame) { _, new in
                                    run(followBox.model.contentChanged(to: new), proxy)
                                }
                        }
                    )
                }
                .coordinateSpace(name: Self.scrollSpace)
                // The keyboard (or the composer growing under a wrapping
                // draft) resizes this viewport without changing the content,
                // and a position worked out from a LazyVStack's estimates
                // lands past the end of everything laid out (#191). Never a
                // pin decision — mid-transition the model freezes entirely and
                // re-sticks once at the end.
                .background(
                    GeometryReader { geo in
                        Color.clear
                            .onAppear { _ = followBox.model.viewportChanged(to: geo.size.height) }
                            .onChange(of: geo.size.height) { _, new in
                                run(followBox.model.viewportChanged(to: new), proxy)
                            }
                    }
                )
                // Only a finger on the glass may stop the list following the
                // end (#159) — the channel list's rule, and the reason the
                // hand-rolled `jumpOwnsScroll` latch is gone.
                .simultaneousGesture(
                    DragGesture(minimumDistance: 12)
                        .onChanged { _ in
                            if !followBox.model.isDragging { followBox.model.dragBegan() }
                        }
                        .onEnded { _ in followBox.model.dragEnded() }
                )
                // The keyboard's show/hide brackets: between Will and Did the
                // geometry passes through states that never hold still, and
                // deciding from them is what used to unpin the follow the
                // moment the reply composer came up.
                .onReceive(NotificationCenter.default.publisher(
                    for: UIResponder.keyboardWillShowNotification)) { _ in followBox.model.transitionBegan() }
                .onReceive(NotificationCenter.default.publisher(
                    for: UIResponder.keyboardDidShowNotification)) { _ in run(followBox.model.transitionEnded(), proxy) }
                .onReceive(NotificationCenter.default.publisher(
                    for: UIResponder.keyboardWillHideNotification)) { _ in followBox.model.transitionBegan() }
                .onReceive(NotificationCenter.default.publisher(
                    for: UIResponder.keyboardDidHideNotification)) { _ in run(followBox.model.transitionEnded(), proxy) }
                .onChange(of: thread.value.last?.id) { _, newId in
                    // A pending jump owns the scroll position (#332): this
                    // follow and `focusPinnedMessage` both fire on the update
                    // that first delivers the replies, and an ungated follow
                    // simply wins — the thread opens at the newest reply and
                    // the jump is never seen. Once the jump has *landed*,
                    // `focusEngaged()` holds the position and every command
                    // below returns `.none`.
                    guard newId != nil, app.focusMessageId == nil else { return }
                    // My own reply always re-pins — I just pressed send, so I
                    // mean to see it land; everyone else's replies leave a
                    // back-scrolled reader in place (#111/#494).
                    let own = app.currentUser?.id != nil
                        && thread.value.last?.userId == app.currentUser?.id
                    run(followBox.model.lastMessageChanged(isOwn: own), proxy)
                }
                // Size-change role removed on iOS 18+ — same short-back-pull
                // bounce as the channel list (see BottomAnchor).
                .modifier(BottomAnchor())
                .onChange(of: app.focusMessageId) { _, _ in focusPinnedMessage(proxy) }
                .onChange(of: thread.value.count) { _, _ in focusPinnedMessage(proxy) }
                .onAppear { focusPinnedMessage(proxy) }
                // A reply is scrolled to before its row has a height, so the
                // landing comes up short and nothing else corrects it (#334).
                // Keyed on the row identity, not the message id, so an
                // optimistic reply reconciling with its server echo doesn't
                // re-run it — that is what keeps AC 3's "several replies in a
                // row" free of a second jump per send. Gated entirely on the
                // model: a back-scrolled, focused or mid-drag reader gets
                // `.none`.
                .task(id: thread.value.lastRowKey) {
                    guard !thread.value.isEmpty else { return }
                    for delay in Self.settleDelays {
                        try? await Task.sleep(nanoseconds: delay)
                        let command = followBox.model.arrivalSettleCommand()
                        guard case .stick = command else { return }
                        run(command, proxy)
                    }
                }
            }
            .dismissesKeyboardOnChatInteraction()
            if let chId = channelId.value {
                TypingIndicatorView(channelId: chId, threadRootId: rootId, userNames: userNames)
                Divider()
                ComposerView(channelId: chId, threadRootId: rootId, placeholder: "Reply in thread")
            }
        }
        .background(MC.base)
        .navigationTitle("Thread")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { navTitle }
        }
        .task(id: rootId) {
            // No app.openThread here: ChannelScreen's threadRoute onChange owns
            // that record. Writing it from this screen's appearance raced the
            // pop — a Back tap landing before this task ran left a stale
            // openThreadRootId behind, which the channel screen then re-pushed
            // mid-pop, corrupting the NavigationStack (nav "stuck").
            thread.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("id") == rootId || Column("threadRootId") == rootId)
                    .order(Column("id"))
                    .fetchAll(db)
            }
            users.start(db: app.db) { try User.fetchAll($0) }
            channelId.start(db: app.db, reset: nil) { db in
                try String.fetchOne(
                    db,
                    sql: "SELECT channelId FROM message WHERE id = ?",
                    arguments: [rootId]
                )
            }
            channel.start(db: app.db, reset: nil) { db in
                try Channel.fetchOne(
                    db,
                    sql: "SELECT c.* FROM channel c JOIN message m ON m.channelId = c.id WHERE m.id = ?",
                    arguments: [rootId]
                )
            }
            currentRole.start(db: app.db, reset: nil) { db in
                try String.fetchOne(
                    db,
                    sql: """
                        SELECT w.role FROM workspace w
                        JOIN channel c ON c.workspaceId = w.id
                        JOIN message m ON m.channelId = c.id
                        WHERE m.id = ?
                        """,
                    arguments: [rootId]
                )
            }
        }
        // No onDisappear close: this screen also disappears when a channel
        // switch replaces the stack root, which must *park* the thread rather
        // than close it (issue #89). ChannelScreen owns the close instead — it
        // can tell a Back tap from a channel switch.
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
        .sheet(item: $profileRoute) { route in
            MemberProfileSheet(userId: route.userId)
        }
        .modifier(
            DebugOpenProfile(app: app, envVar: "FLOW_DEBUG_OPEN_MEMBER_IN_THREAD") {
                profileRoute = ProfileRoute(userId: $0)
            }
        )
    }

    private func focusPinnedMessage(_ proxy: ScrollViewProxy) {
        guard let messageId = app.focusMessageId,
              let key = thread.value.rowKey(forMessageId: messageId) else { return }
        // The jump owns the position for the rest of this screen's life, so no
        // glue or follow can drag the reader off the reply they came for
        // (#332) — the macOS thread panel's rule, now read off the same model.
        followBox.model.focusEngaged()
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(key, anchor: .center) // row identity, not message id (#332)
        }
        // One scroll is not a landing: it is aimed at a LazyVStack's estimated
        // row heights while the bottom anchor's initial offset is still
        // resolving underneath it, so it comes up short. Re-assert it across
        // the settling window — bounded by the flash, and it can only ever
        // re-aim at the same row.
        Task { @MainActor in
            for delay in Self.settleDelays {
                try? await Task.sleep(nanoseconds: delay)
                guard flashId == messageId else { return }
                proxy.scrollTo(key, anchor: .center)
            }
        }
        flashId = messageId
        app.focusMessageId = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            withAnimation(.easeOut(duration: 0.6)) {
                if flashId == messageId { flashId = nil }
            }
        }
    }
}

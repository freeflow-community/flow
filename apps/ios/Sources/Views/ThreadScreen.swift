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
    @State private var editingMessage: Message?
    @State private var flashId: String?
    /// The member whose profile card is open (#223) — same card the channel
    /// shows, presented over the thread instead of pushed on top of it.
    @State private var profileRoute: ProfileRoute?
    /// Viewport height, watched so the keyboard's resize can re-stick the list
    /// to the newest reply (#191).
    @State private var viewportHeight: CGFloat = 0
    /// A jump owns the scroll position after it lands (#332). macOS gets this
    /// from its follow model — `focusEngaged()` unpins, so no glue or follow
    /// fights the centring scroll — and this screen has no follow model, so it
    /// records the claim itself. Without it the keyboard glue and the new-reply
    /// follow both fire ~70ms after the jump and drag the reader to the end;
    /// they were harmless only while they targeted message ids and no-oped.
    /// Released by my own reply, which always re-pins (#111/#334).
    @State private var jumpEngaged = false
    /// The jump target, held while its centring scroll settles (#332). Unlike
    /// the channel transcript — eager below 100 rows, so `tryFocus` lands first
    /// time — this screen is pushed fresh and its LazyVStack has laid out
    /// nothing when the scroll is issued, so the first attempt comes up at the
    /// end. Same belt the transcript's restore and the #334 arrival settle use.
    @State private var pendingFocusId: String?

    /// The window a freshly pushed thread takes to lay its rows out.
    private static let settleDelays: [UInt64] = [50_000_000, 150_000_000, 400_000_000]

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
                                context: TranscriptContext(
                                    engine: app.engine,
                                    avatarPaths: app.avatarPaths,
                                    agentIds: app.agentIds
                                ),
                                showHeader: true,
                                showThreadAffordances: false,
                                highlighted: message.id == flashId,
                                onOpenThread: { _ in },
                                onEdit: { editingMessage = $0 },
                                onDelete: { msg in
                                    Task { await app.engine.deleteMessage(id: msg.id) }
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
                }
                .background(
                    GeometryReader { geo in
                        Color.clear
                            .onAppear { viewportHeight = geo.size.height }
                            .onChange(of: geo.size.height) { _, new in
                                viewportHeight = new
                                // Same glue as the channel transcript (#191):
                                // the keyboard resizes the viewport without
                                // changing the content, and a position worked
                                // out from a LazyVStack's estimates lands past
                                // the end of everything laid out.
                                // Row identity, never a message id (#332):
                                // rows are keyed on `clientMsgId`, so a
                                // message id matches no row and the scroll
                                // silently does nothing.
                                if !jumpEngaged, let lastKey = thread.value.lastRowKey {
                                    proxy.scrollTo(lastKey, anchor: .bottom)
                                }
                            }
                    }
                )
                .onChange(of: thread.value.last?.id) { _, newId in
                    // A jump owns the scroll position, pending or landed
                    // (#332). This follow and `focusPinnedMessage` both fire on
                    // the update that first delivers the replies, and an
                    // ungated follow simply wins — the thread opens at its
                    // newest reply and the jump is never seen.
                    guard newId != nil else { return }
                    // My own reply always re-pins, the channel list's rule
                    // (#111/#334), so replying after a jump follows it down.
                    if let me = app.currentUser?.id, thread.value.last?.userId == me {
                        jumpEngaged = false
                    }
                    guard app.focusMessageId == nil, !jumpEngaged,
                          let lastKey = thread.value.lastRowKey else { return }
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(lastKey, anchor: .bottom) // row identity (#332)
                    }
                }
                // Size-change role removed on iOS 18+ — same short-back-pull
                // bounce as the channel list (see BottomAnchor).
                .modifier(BottomAnchor())
                .onChange(of: app.focusMessageId) { _, _ in focusPinnedMessage(proxy) }
                .onChange(of: thread.value.count) { _, _ in focusPinnedMessage(proxy) }
                .onAppear { focusPinnedMessage(proxy) }
                // Re-assert the jump across the settling window. Stops early
                // once the row leaves the thread; `jumpEngaged` keeps the glue
                // and the follow off the position for the whole run.
                .task(id: pendingFocusId) {
                    guard let target = pendingFocusId else { return }
                    for delay in Self.settleDelays {
                        try? await Task.sleep(nanoseconds: delay)
                        guard let key = thread.value.rowKey(forMessageId: target) else { break }
                        proxy.scrollTo(key, anchor: .center)
                    }
                    pendingFocusId = nil
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
        jumpEngaged = true // this position is the jump's now, not the follow's
        pendingFocusId = messageId
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(key, anchor: .center) // row identity, not message id (#332)
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

import GRDB
import SwiftUI

struct ThreadPanelView: View {
    let rootId: String
    /// When embedded in the tabbed side panel (phase 13) the container owns the
    /// header/tab strip and background, so we drop our own chrome.
    var embedded: Bool = false
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    @StateObject private var thread = DBObserved<[Message]>(initial: [])
    @StateObject private var userNames = DBObserved<[String: String]>(initial: [:])
    @StateObject private var workspaceId = DBObserved<String?>(initial: nil)
    @StateObject private var currentRole = DBObserved<String?>(initial: nil)
    @State private var editingMessage: Message?
    @State private var profileUserId: String?
    /// The reply currently flashing after a jump-to-message (phase 12).
    @State private var flashId: String?
    /// The single owner of this panel's follow/scroll decisions — the same
    /// model the channel transcript uses (#334). Before it, the panel scrolled
    /// to the newest reply unconditionally: a reader who had scrolled up to
    /// re-read an earlier reply was yanked back down by everyone else's, and a
    /// reply that sized late (an agent's markdown, an image) was left below the
    /// fold with nothing to correct it. `.topEdge` is the macOS style — there
    /// is no touch, so wheel and trackpad deltas are the only unpin signal.
    @State private var followBox = TranscriptFollowBox(style: .topEdge)

    /// When to re-assert the end after opening or after a reply lands, in
    /// nanoseconds from the previous pass — the channel list's cadence
    /// (`MessageListView`).
    private static let settleDelays: [UInt64] = [50_000_000, 150_000_000, 400_000_000]
    private static let scrollSpace = "threadScroll"

    /// Executes a follow-model command. The one place this panel scrolls to
    /// its end — and it scrolls to the row *identity*, never a message id
    /// (#329: rows are keyed on `clientMsgId`, so a message id matches no row
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

    private var root: Message? {
        thread.value.first { $0.id == rootId }
    }

    private var replies: [Message] {
        thread.value.filter { $0.id != rootId }
    }

    var body: some View {
        VStack(spacing: 0) {
            if !embedded {
                HStack {
                    Text("Thread").flowFont(.headline)
                    if let root {
                        Text("#\(root.channelId.suffix(4))").hidden() // keep layout stable
                    }
                    Spacer()
                    Button {
                        win.openThread(nil)
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.borderless)
                    .help("Close thread")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                Divider()
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        // Keyed on clientMsgId, like the `.id()` below and the
                        // channel list: when the optimistic row is swapped for
                        // its server twin the *element* has to stay the same
                        // element, or ForEach reads a delete + insert whose two
                        // views claim one `.id()` — and the leaving pending row
                        // wins, leaving the spinner up over a delivered message
                        // (#328) until something forces a remount.
                        ForEach(thread.value, id: \.clientMsgId) { message in
                            MessageRow(
                                message: message,
                                userNames: userNames.value,
                                currentUserId: app.currentUser?.id,
                                canPermanentlyDelete: currentRole.value == "owner" || currentRole.value == "admin",
                                context: TranscriptContext(
                                    engine: app.engine,
                                    avatarPaths: app.avatarPaths,
                                    agentIds: app.agentIds,
                                    onError: { app.showError($0) },
                                    onSelectArtifact: { win.selectArtifact($0) },
                                    onOpenScheduled: { win.showScheduledPanel() }
                                ),
                                showHeader: true,
                                showThreadAffordances: false,
                                highlighted: message.id == flashId,
                                onOpenThread: { _ in },
                                onEdit: { editingMessage = $0 },
                                onDelete: { msg, permanently in
                                    Task { await app.engine.deleteMessage(id: msg.id, permanently: permanently) }
                                },
                                onOpenProfile: { profileUserId = $0 }
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
                                        .flowFont(.caption)
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
                // The composer growing (a wrapping draft, the typing
                // indicator appearing under an agent's reply) shrinks this
                // viewport; a pinned reader is carried to the newest reply.
                .background(
                    GeometryReader { geo in
                        Color.clear
                            .onAppear { _ = followBox.model.viewportChanged(to: geo.size.height) }
                            .onChange(of: geo.size.height) { _, new in
                                run(followBox.model.viewportChanged(to: new), proxy)
                            }
                    }
                )
                // Open at the newest reply — but on macOS 15+ scope the anchor
                // to initial offset + alignment (MacBottomAnchor, #159/#312's
                // lesson in the channel list). The all-roles form also
                // re-anchors on every *content size change*, and a LazyVStack
                // materialising rows after a jump-to-reply scroll is exactly
                // that: the centring scroll was issued and then dragged back to
                // the end before it could be seen (#329).
                .modifier(MacBottomAnchor())
                .onChange(of: thread.value.last?.id) { _, newId in
                    // A pending jump owns the scroll position.
                    guard win.focusMessageId == nil, newId != nil else { return }
                    // The model follows a new reply down only while the reader
                    // is at the end — except my own reply, which always re-pins
                    // (#111/#334, the channel list's rule).
                    let own = app.currentUser?.id != nil
                        && thread.value.last?.userId == app.currentUser?.id
                    run(followBox.model.lastMessageChanged(isOwn: own), proxy)
                }
                // Jump-to-message (phase 12): scroll to + flash a thread reply
                // reached from the Activity feed. The thread loads whole, so no
                // paging is needed here (unlike the channel's main list).
                .onChange(of: win.focusMessageId) { _, _ in tryFocus(proxy) }
                .onChange(of: thread.value.count) { _, _ in tryFocus(proxy) }
                .onAppear { tryFocus(proxy) }
                // Landing at the newest reply is this view's job now: with the
                // anchor scoped to the initial offset, a first paint whose rows
                // are still estimating their heights comes up short and nothing
                // corrects it. The same belt covers a reply arriving later —
                // it is scrolled to before its row has a height (#334). Keyed
                // on the row identity so an optimistic reply reconciling with
                // its echo doesn't re-run it, and gated on the model, so a
                // back-scrolled reader or a jump is never overridden.
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

            if let root {
                TypingIndicatorView(channelId: root.channelId, threadRootId: root.id, userNames: userNames.value)
                ComposerView(
                    channelId: root.channelId,
                    workspaceId: workspaceId.value,
                    threadRootId: rootId,
                    placeholder: "Reply in thread",
                    onEditLast: { startEditingLastMessage() }
                )
            }
        }
        // Leading-edge shadow so the panel reads as floating over the chat.
        // Embedded, the side-panel container owns the background/shadow.
        .background {
            if !embedded {
                Rectangle()
                    .fill(.background.secondary)
                    .shadow(color: MC.ink.opacity(0.12), radius: 8, x: -5, y: 0)
            }
        }
        .task(id: rootId) {
            // A different thread is a different transcript: land it pinned to
            // its newest reply, with the previous thread's pin and jump state
            // dropped. Reset in place rather than by replacing the box — the
            // measured viewport height is the panel's, not the thread's, and
            // a model that has forgotten it reads every frame as "far from the
            // end" until the panel happens to resize.
            followBox.model.positionRestored(atBottom: true)
            followBox.model.focusActive = false
            followBox.model.landingIssued()
            thread.start(db: app.db, reset: []) { db in
                try Message
                    .filter(Column("id") == rootId || Column("threadRootId") == rootId)
                    .order(Column("id"))
                    .fetchAll(db)
            }
            userNames.start(db: app.db, reset: [:]) { db in
                try Dictionary(
                    uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayNameWithBadge) }
                )
            }
            workspaceId.start(db: app.db, reset: nil) { db in
                try String.fetchOne(
                    db,
                    sql: "SELECT c.workspaceId FROM channel c JOIN message m ON m.channelId = c.id WHERE m.id = ?",
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
        .sheet(item: $editingMessage) { message in
            EditMessageSheet(message: message)
        }
        .sheet(item: Binding(
            get: { profileUserId.map { ProfileTarget(userId: $0) } },
            set: { profileUserId = $0?.userId }
        )) { target in
            MemberProfileSheet(userId: target.userId)
        }
    }

    /// ↑-to-edit (ui_nits item 4): only when my message is the newest in the thread.
    private func startEditingLastMessage() -> Bool {
        guard let last = thread.value.last,
              last.userId == app.currentUser?.id,
              !last.isDeleted, !last.pending else { return false }
        editingMessage = last
        return true
    }

    /// Center + flash the jump-to-message target once the thread has loaded it,
    /// then release the shared target.
    private func tryFocus(_ proxy: ScrollViewProxy) {
        guard let fid = win.focusMessageId,
              let key = thread.value.rowKey(forMessageId: fid) else { return }
        // The jump owns the position for the rest of this thread's life, so
        // no glue or follow can drag the reader off the reply they came for.
        followBox.model.focusEngaged()
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(key, anchor: .center) // row identity, not message id (#329)
        }
        flashId = fid
        win.focusMessageId = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            withAnimation(.easeOut(duration: 0.6)) {
                if flashId == fid { flashId = nil }
            }
        }
    }
}

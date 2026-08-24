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
    @State private var editingMessage: Message?
    @State private var profileUserId: String?
    /// The reply currently flashing after a jump-to-message (phase 12).
    @State private var flashId: String?
    /// A jump has taken this panel's scroll position; the landing settle below
    /// stands down for the rest of this thread's life, so a page arriving late
    /// can't yank the reader off the reply they jumped to.
    @State private var focusOwnsScroll = false

    /// When to re-assert the end after opening, in nanoseconds from the
    /// previous pass — the channel list's cadence (`MessageListView`).
    private static let settleDelays: [UInt64] = [50_000_000, 150_000_000, 400_000_000]

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
                                context: TranscriptContext(
                                    engine: app.engine,
                                    avatarPaths: app.avatarPaths,
                                    agentIds: app.agentIds,
                                    onError: { app.showError($0) },
                                    onSelectArtifact: { win.selectArtifact($0) }
                                ),
                                showHeader: true,
                                showThreadAffordances: false,
                                highlighted: message.id == flashId,
                                onOpenThread: { _ in },
                                onEdit: { editingMessage = $0 },
                                onDelete: { msg in
                                    Task { await app.engine.deleteMessage(id: msg.id) }
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
                }
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
                    guard win.focusMessageId == nil, newId != nil,
                          let lastKey = thread.value.lastRowKey else { return }
                    // Rows are keyed on clientMsgId (see the `.id()` above), so
                    // the scroll target has to be that key — a message id
                    // matches no row and scrolls nowhere (#329).
                    proxy.scrollTo(lastKey, anchor: .bottom)
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
                // corrects it. Re-assert the end across the settling window,
                // and never against a jump — that reader is somewhere else on
                // purpose.
                .task(id: thread.value.last?.id) {
                    guard !thread.value.isEmpty else { return }
                    for delay in Self.settleDelays {
                        try? await Task.sleep(nanoseconds: delay)
                        guard !focusOwnsScroll, win.focusMessageId == nil,
                              let lastKey = thread.value.lastRowKey else { return }
                        proxy.scrollTo(lastKey, anchor: .bottom)
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
            focusOwnsScroll = false
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
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(key, anchor: .center) // row identity, not message id (#329)
        }
        focusOwnsScroll = true
        flashId = fid
        win.focusMessageId = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            withAnimation(.easeOut(duration: 0.6)) {
                if flashId == fid { flashId = nil }
            }
        }
    }
}

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
                        ForEach(thread.value) { message in
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
                            .id(message.id)
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
                .defaultScrollAnchor(.bottom) // open at the newest reply
                .onChange(of: thread.value.last?.id) { _, newId in
                    // A pending jump owns the scroll position.
                    guard win.focusMessageId == nil, let newId else { return }
                    proxy.scrollTo(newId, anchor: .bottom)
                }
                // Jump-to-message (phase 12): scroll to + flash a thread reply
                // reached from the Activity feed. The thread loads whole, so no
                // paging is needed here (unlike the channel's main list).
                .onChange(of: win.focusMessageId) { _, _ in tryFocus(proxy) }
                .onChange(of: thread.value.count) { _, _ in tryFocus(proxy) }
                .onAppear { tryFocus(proxy) }
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
        guard let fid = win.focusMessageId, thread.value.contains(where: { $0.id == fid }) else { return }
        withAnimation(.easeInOut(duration: 0.25)) {
            proxy.scrollTo(fid, anchor: .center)
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

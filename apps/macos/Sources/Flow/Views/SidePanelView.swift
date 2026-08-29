import GRDB
import SwiftUI

// Tabbed side panel (phase 13): the right-hand pane that hosts the open Thread,
// the active channel's artifacts and its Files list (#347) as switchable tabs. It owns the tab strip,
// the panel close, and the leading-edge shadow, and shows the active tab's body
// (ThreadPanelView embedded, or ArtifactPanelView). Threads and artifacts
// coexist; the tab strip picks which one shows. Mirrors the web SidePanel.
struct SidePanelView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    /// The thread tab names the conversation the thread belongs to (#417), so
    /// the panel needs the channel row and the display names behind it.
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)
    @StateObject private var users = DBObserved<[String: String]>(initial: [:])

    private var channelArtifacts: [Artifact] {
        guard let ch = win.selectedChannelId else { return [] }
        return win.artifacts(inChannel: ch)
    }

    private var threadParent: (connector: String, name: String)? {
        channel.value?.threadParentLabel(
            userNames: users.value, currentUserId: app.currentUser?.id
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            tabStrip
            Divider()
            if win.filesOpen, let channelId = win.selectedChannelId {
                FilesPanelView(channelId: channelId)
                    .id(channelId)
            } else if let artifactId = win.selectedArtifactId {
                ArtifactPanelView(artifactId: artifactId)
                    .id(artifactId)
            } else if let rootId = win.openThreadRootId {
                ThreadPanelView(rootId: rootId, embedded: true)
                    .id(rootId)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            Rectangle()
                .fill(.background.secondary)
                .shadow(color: MC.ink.opacity(0.12), radius: 8, x: -5, y: 0)
        )
        .accessibilityIdentifier("side.panel")
        .task(id: win.selectedChannelId) {
            // No channel means no panel, so there is nothing to re-title.
            guard let channelId = win.selectedChannelId else { return }
            channel.start(db: app.db, reset: nil) { try Channel.fetchOne($0, key: channelId) }
            users.start(db: app.db, reset: [:]) { db in
                try Dictionary(
                    uniqueKeysWithValues: User.fetchAll(db).map { ($0.id, $0.displayNameWithBadge) }
                )
            }
        }
    }

    private var tabStrip: some View {
        HStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    if win.openThreadRootId != nil {
                        PanelTab(
                            icon: "💬",
                            label: "Thread",
                            parent: threadParent,
                            // Same channel we're already on: `selectChannel`
                            // drops any artifact/Files tab over the thread and
                            // leaves the thread itself open.
                            onParentTap: { win.selectChannel(win.selectedChannelId) },
                            active: win.selectedArtifactId == nil && !win.filesOpen,
                            onSelect: { win.showThread() },
                            onClose: { win.openThread(nil) },
                            accessibilityId: "side.tab.thread"
                        )
                    }
                    if win.filesOpen {
                        PanelTab(
                            icon: "📎",
                            label: "Files",
                            active: true,
                            onSelect: { win.openFiles(true) },
                            onClose: { win.openFiles(false) },
                            accessibilityId: "side.tab.files"
                        )
                    }
                    ForEach(channelArtifacts) { artifact in
                        PanelTab(
                            icon: artifact.glyph,
                            label: artifact.name,
                            active: !win.filesOpen && win.selectedArtifactId == artifact.id,
                            onSelect: { win.selectArtifact(artifact.id) },
                            onClose: nil,
                            accessibilityId: "side.tab.artifact.\(artifact.name)"
                        )
                    }
                }
                .padding(.horizontal, 8)
            }
            Button {
                win.closeSidePanel()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.borderless)
            .help("Close panel")
            .padding(.horizontal, 8)
            .accessibilityIdentifier("side.panel.close")
        }
        .frame(height: 40)
        .background(MC.daypill.opacity(0.4))
    }
}

/// A single tab: emoji glyph + truncating label, an accent underline when
/// active, and an optional trailing ✕ (used by the Thread tab).
private struct PanelTab: View {
    let icon: String
    let label: String
    /// Secondary trailing text with its own tap target (#417): the thread's
    /// parent channel. Outside the tab's button, because it navigates
    /// somewhere else than selecting the tab does.
    var parent: (connector: String, name: String)?
    var onParentTap: (() -> Void)?
    let active: Bool
    let onSelect: () -> Void
    let onClose: (() -> Void)?
    let accessibilityId: String

    var body: some View {
        HStack(spacing: 6) {
            Button(action: onSelect) {
                HStack(spacing: 6) {
                    Text(icon).flowFont(size: 13)
                    Text(label)
                        .flowFont(size: 13, weight: active ? .semibold : .regular)
                        .foregroundStyle(active ? MC.ink : MC.muted)
                        .lineLimit(1)
                        // "Thread" is never truncated — only the channel after it.
                        .fixedSize(horizontal: parent != nil, vertical: false)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(accessibilityId)
            if let parent {
                Text(parent.connector)
                    .flowFont(size: 13)
                    .foregroundStyle(MC.muted)
                    .fixedSize()
                Button(action: { onParentTap?() }) {
                    Text(parent.name)
                        .flowFont(size: 13)
                        .foregroundStyle(MC.accent)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .buttonStyle(.plain)
                .help("Go to \(parent.name)")
                .accessibilityIdentifier("\(accessibilityId).parent")
            }
            if let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark").flowFont(size: 9, weight: .semibold)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(MC.faint)
                .help("Close tab")
            }
        }
        .frame(maxWidth: parent == nil ? 180 : 280)
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(active ? MC.base : .clear, in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .bottom) {
            if active { Rectangle().fill(MC.accent).frame(height: 2) }
        }
    }
}

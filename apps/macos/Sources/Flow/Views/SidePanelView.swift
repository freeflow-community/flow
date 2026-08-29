import SwiftUI

// Tabbed side panel (phase 13): the right-hand pane that hosts the open Thread,
// the active channel's artifacts and its Files list (#347) as switchable tabs. It owns the tab strip,
// the panel close, and the leading-edge shadow, and shows the active tab's body
// (ThreadPanelView embedded, or ArtifactPanelView). Threads and artifacts
// coexist; the tab strip picks which one shows. Mirrors the web SidePanel.
struct SidePanelView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    private var channelArtifacts: [Artifact] {
        guard let ch = win.selectedChannelId else { return [] }
        return win.artifacts(inChannel: ch)
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
    }

    private var tabStrip: some View {
        HStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    if win.openThreadRootId != nil {
                        PanelTab(
                            icon: "💬",
                            label: "Thread",
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
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(accessibilityId)
            if let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark").flowFont(size: 9, weight: .semibold)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(MC.faint)
                .help("Close tab")
            }
        }
        .frame(maxWidth: 180)
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(active ? MC.base : .clear, in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .bottom) {
            if active { Rectangle().fill(MC.accent).frame(height: 2) }
        }
    }
}

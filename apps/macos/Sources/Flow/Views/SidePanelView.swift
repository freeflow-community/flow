import SwiftUI

// Tabbed side panel (phase 13): the right-hand pane that hosts the open Thread
// and the active channel's artifacts as switchable tabs. It owns the tab strip,
// the panel close, and the leading-edge shadow, and shows the active tab's body
// (ThreadPanelView embedded, or ArtifactPanelView). Threads and artifacts
// coexist; the tab strip picks which one shows. Mirrors the web SidePanel.
struct SidePanelView: View {
    @EnvironmentObject private var app: AppState

    private var channelArtifacts: [Artifact] {
        guard let ch = app.selectedChannelId else { return [] }
        return app.artifacts(inChannel: ch)
    }

    var body: some View {
        VStack(spacing: 0) {
            tabStrip
            Divider()
            if let artifactId = app.selectedArtifactId {
                ArtifactPanelView(artifactId: artifactId)
                    .id(artifactId)
            } else if let rootId = app.openThreadRootId {
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
                    if app.openThreadRootId != nil {
                        PanelTab(
                            icon: "💬",
                            label: "Thread",
                            active: app.selectedArtifactId == nil,
                            onSelect: { app.showThread() },
                            onClose: { app.openThread(nil) },
                            accessibilityId: "side.tab.thread"
                        )
                    }
                    ForEach(channelArtifacts) { artifact in
                        PanelTab(
                            icon: artifact.glyph,
                            label: artifact.name,
                            active: app.selectedArtifactId == artifact.id,
                            onSelect: { app.selectArtifact(artifact.id) },
                            onClose: nil,
                            accessibilityId: "side.tab.artifact.\(artifact.name)"
                        )
                    }
                }
                .padding(.horizontal, 8)
            }
            Button {
                app.closeSidePanel()
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
                    Text(icon).font(.system(size: 13))
                    Text(label)
                        .font(.system(size: 13, weight: active ? .semibold : .regular))
                        .foregroundStyle(active ? MC.ink : MC.muted)
                        .lineLimit(1)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(accessibilityId)
            if let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .semibold))
                }
                .buttonStyle(.borderless)
                .foregroundStyle(MC.faint)
                .help("Close thread")
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

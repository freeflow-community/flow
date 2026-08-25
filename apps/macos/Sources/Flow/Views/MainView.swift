import AppKit
import GRDB
import SwiftUI

struct MainView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    // Ruling 5: sidebar width is a local per-device preference, clamped on use.
    @AppStorage("sidebarWidth" + Profile.suffix) private var sidebarWidth: Double = 240
    @State private var dragStartWidth: Double?

    private static let minSidebarWidth: Double = 180
    private static let maxSidebarWidth: Double = 360
    private static let defaultSidebarWidth: Double = 240

    private var clampedSidebarWidth: Double {
        min(Self.maxSidebarWidth, max(Self.minSidebarWidth, sidebarWidth))
    }

    // Phase 13: tabbed side panel width (hosts the thread + artifacts), same
    // local-preference treatment as the sidebar.
    @AppStorage("sidePanelWidth" + Profile.suffix) private var sidePanelWidth: Double = 480
    @State private var sidePanelDragStartWidth: Double?

    private static let minSidePanelWidth: Double = 320
    private static let maxSidePanelWidth: Double = 720
    private static let defaultSidePanelWidth: Double = 480

    private var clampedSidePanelWidth: Double {
        min(Self.maxSidePanelWidth, max(Self.minSidePanelWidth, sidePanelWidth))
    }

    var body: some View {
        HStack(spacing: 0) {
            WorkspaceRailView()
            SidebarView()
                .frame(width: clampedSidebarWidth)
            sidebarResizer
            VStack(spacing: 0) {
                HuddleBar()
                detail
            }
            .frame(maxWidth: .infinity)
            .background(MC.base)
        }
    }

    /// Thin drag strip on the sidebar/content boundary: drag resizes live,
    /// double-tap resets to the default width.
    private var sidebarResizer: some View {
        Rectangle()
            .fill(MC.base)
            .frame(width: 5)
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { sidebarWidth = Self.defaultSidebarWidth }
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { value in
                        let base = dragStartWidth ?? clampedSidebarWidth
                        if dragStartWidth == nil { dragStartWidth = base }
                        sidebarWidth = min(
                            Self.maxSidebarWidth,
                            max(Self.minSidebarWidth, base + value.translation.width)
                        )
                    }
                    .onEnded { _ in dragStartWidth = nil }
            )
            .onHover { inside in
                if inside {
                    NSCursor.resizeLeftRight.push()
                } else {
                    NSCursor.pop()
                }
            }
            .accessibilityElement()
            .accessibilityIdentifier("sidebar.resizer")
            .accessibilityLabel("Resize sidebar")
            .accessibilityValue("\(Int(clampedSidebarWidth)) points")
    }

    /// Drag strip on the chat/side-panel boundary (phase 13): dragging left
    /// widens the panel; double-tap resets. Renders the hairline the old
    /// Divider provided.
    private var sidePanelResizer: some View {
        Rectangle()
            .fill(MC.base)
            .frame(width: 5)
            .overlay(Rectangle().fill(MC.hairline).frame(width: 1))
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { sidePanelWidth = Self.defaultSidePanelWidth }
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { value in
                        let base = sidePanelDragStartWidth ?? clampedSidePanelWidth
                        if sidePanelDragStartWidth == nil { sidePanelDragStartWidth = base }
                        sidePanelWidth = min(
                            Self.maxSidePanelWidth,
                            max(Self.minSidePanelWidth, base - value.translation.width)
                        )
                    }
                    .onEnded { _ in sidePanelDragStartWidth = nil }
            )
            .onHover { inside in
                if inside {
                    NSCursor.resizeLeftRight.push()
                } else {
                    NSCursor.pop()
                }
            }
            .accessibilityElement()
            .accessibilityIdentifier("sidePanel.resizer")
            .accessibilityLabel("Resize side panel")
            .accessibilityValue("\(Int(clampedSidePanelWidth)) points")
    }

    @ViewBuilder
    private var detail: some View {
        if win.showActivity {
            // Activity feed (phase 12) — the virtual channel that replaced the
            // bell. Covers the content pane; the channel stays put behind it.
            ActivityFeedView()
        } else if let channelId = win.selectedChannelId {
            HStack(spacing: 0) {
                ChannelView(channelId: channelId)
                    .frame(maxWidth: .infinity)
                // Tabbed side panel: Thread + the channel's artifacts (phase 13).
                if win.openThreadRootId != nil || win.selectedArtifactId != nil || win.filesOpen {
                    sidePanelResizer
                    SidePanelView()
                        .frame(width: clampedSidePanelWidth)
                }
            }
        } else {
            VStack(spacing: 8) {
                Text("#")
                    .flowFont(size: 40, weight: .bold)
                    .foregroundStyle(MC.faint)
                Text("Select a channel")
                    .foregroundStyle(MC.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// The workspace identity mark: its avatar image when one is set (#336),
/// otherwise the initial on a color chip. Active is a white fill for the
/// initial mark, and a white ring for an avatar — an image can't be tinted.
struct WorkspaceMark: View {
    let workspace: Workspace
    let size: CGFloat
    var cornerRadius: CGFloat = 12
    var active: Bool = true

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius)
        Group {
            if let path = workspace.avatarUrl, path.hasPrefix("/v1/avatars/") {
                AuthImage(path: path) { shape.fill(Color.white.opacity(0.15)) }
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(shape)
                    .opacity(active ? 1 : 0.7)
                    .overlay(active ? shape.strokeBorder(Color.white, lineWidth: 2) : nil)
            } else {
                shape
                    .fill(active ? Color.white : Color.white.opacity(0.15))
                    .frame(width: size, height: size)
                    .overlay(
                        Text(String(workspace.name.prefix(1)).uppercased())
                            .flowFont(size: active ? size * 0.42 : size * 0.35, weight: active ? .heavy : .bold)
                            .foregroundStyle(active ? MC.accent : .white)
                    )
            }
        }
    }
}

/// Design 3a column 1: the 64px violet workspace rail.
struct WorkspaceRailView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])

    /// Rail shade follows the active workspace's palette (violet default).
    private var railColor: Color {
        let current = workspaces.value.first { $0.id == win.selectedWorkspaceId }
        return SidebarPalette.palette(for: current?.sidebarColor).rail
    }

    var body: some View {
        VStack(spacing: 14) {
            ForEach(workspaces.value) { ws in
                let active = ws.id == win.selectedWorkspaceId
                Button {
                    if !active { win.selectWorkspace(ws.id) }
                } label: {
                    WorkspaceMark(workspace: ws, size: 40, cornerRadius: 12, active: active)
                        // Unread across this workspace's channels (#345). The
                        // overlay sits outside the mark's clip shape, so the
                        // badge can overhang the corner as designed.
                        .overlay(alignment: .topTrailing) {
                            WorkspaceUnreadBadge(count: ws.unreadCount, ringColor: railColor)
                                .offset(x: 7, y: -7)
                                .accessibilityIdentifier("rail.unread.\(ws.slug)")
                        }
                }
                .buttonStyle(.plain)
                .help(unreadBadgeLabel(ws.unreadCount).map { "\(ws.name) — \($0) unread" } ?? ws.name)
                .accessibilityIdentifier("rail.workspace.\(ws.slug)")
                .accessibilityValue((ws.unreadCount ?? 0) > 0 ? "\(ws.unreadCount!) unread" : "read")
                .accessibilityAddTraits(active ? [.isSelected] : [])
            }
            Button {
                win.selectWorkspace(nil)
            } label: {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(.white.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .frame(width: 40, height: 40)
                    .overlay(
                        Image(systemName: "plus")
                            .foregroundStyle(.white.opacity(0.7))
                    )
            }
            .buttonStyle(.plain)
            .help("All workspaces")
            .accessibilityIdentifier("rail.addWorkspace")
            Spacer()
        }
        .padding(.vertical, 16)
        .frame(width: 64)
        .frame(maxHeight: .infinity)
        .background(railColor)
        .task {
            workspaces.start(db: app.db) { db in
                try Workspace.order(Column("name").collating(.nocase)).fetchAll(db)
            }
        }
    }
}

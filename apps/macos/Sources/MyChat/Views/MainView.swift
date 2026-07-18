import AppKit
import GRDB
import SwiftUI

struct MainView: View {
    @EnvironmentObject private var app: AppState
    @State private var showNotifications = false

    // Ruling 5: sidebar width is a local per-device preference, clamped on use.
    @AppStorage("sidebarWidth" + Profile.suffix) private var sidebarWidth: Double = 240
    @State private var dragStartWidth: Double?

    private static let minSidebarWidth: Double = 180
    private static let maxSidebarWidth: Double = 360
    private static let defaultSidebarWidth: Double = 240

    private var clampedSidebarWidth: Double {
        min(Self.maxSidebarWidth, max(Self.minSidebarWidth, sidebarWidth))
    }

    var body: some View {
        HStack(spacing: 0) {
            WorkspaceRailView()
            SidebarView()
                .frame(width: clampedSidebarWidth)
            sidebarResizer
            detail
                .frame(maxWidth: .infinity)
                .background(MC.base)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showNotifications = true
                } label: {
                    Image(systemName: app.notificationUnread > 0 ? "bell.badge.fill" : "bell")
                        .overlay(alignment: .topTrailing) {
                            if app.notificationUnread > 0 {
                                Text("\(min(app.notificationUnread, 99))")
                                    .font(.system(size: 8, weight: .bold))
                                    .padding(2)
                                    .background(Circle().fill(MC.unread))
                                    .foregroundStyle(.white)
                                    .offset(x: 6, y: -6)
                            }
                        }
                }
                .help("Notifications")
                .accessibilityIdentifier("toolbar.notifications")
                .accessibilityValue("\(app.notificationUnread) unread")
                .popover(isPresented: $showNotifications) {
                    NotificationsPopover()
                }
            }
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

    @ViewBuilder
    private var detail: some View {
        if let channelId = app.selectedChannelId {
            HStack(spacing: 0) {
                ChannelView(channelId: channelId)
                    .frame(maxWidth: .infinity)
                if let rootId = app.openThreadRootId {
                    Divider().overlay(MC.hairline)
                    ThreadPanelView(rootId: rootId)
                        .frame(width: 340)
                        .id(rootId)
                }
            }
        } else {
            VStack(spacing: 8) {
                Text("#")
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(MC.faint)
                Text("Select a channel")
                    .foregroundStyle(MC.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Design 3a column 1: the 64px violet workspace rail.
struct WorkspaceRailView: View {
    @EnvironmentObject private var app: AppState
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])

    /// Rail shade follows the active workspace's palette (violet default).
    private var railColor: Color {
        let current = workspaces.value.first { $0.id == app.selectedWorkspaceId }
        return SidebarPalette.palette(for: current?.sidebarColor).rail
    }

    var body: some View {
        VStack(spacing: 14) {
            ForEach(workspaces.value) { ws in
                let active = ws.id == app.selectedWorkspaceId
                Button {
                    if !active { app.selectWorkspace(ws.id) }
                } label: {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(active ? Color.white : Color.white.opacity(0.15))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Text(String(ws.name.prefix(1)).uppercased())
                                .font(.system(size: active ? 17 : 14, weight: active ? .heavy : .bold))
                                .foregroundStyle(active ? MC.accent : .white)
                        )
                }
                .buttonStyle(.plain)
                .help(ws.name)
                .accessibilityIdentifier("rail.workspace.\(ws.slug)")
                .accessibilityAddTraits(active ? [.isSelected] : [])
            }
            Button {
                app.selectWorkspace(nil)
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

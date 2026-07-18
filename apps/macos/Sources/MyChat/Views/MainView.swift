import GRDB
import SwiftUI

struct MainView: View {
    @EnvironmentObject private var app: AppState
    @State private var showNotifications = false

    var body: some View {
        HStack(spacing: 0) {
            WorkspaceRailView()
            SidebarView()
                .frame(width: 240)
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
        .background(MC.rail)
        .task {
            workspaces.start(db: app.db) { db in
                try Workspace.order(Column("name").collating(.nocase)).fetchAll(db)
            }
        }
    }
}

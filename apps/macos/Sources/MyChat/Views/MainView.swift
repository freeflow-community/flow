import SwiftUI

struct MainView: View {
    @EnvironmentObject private var app: AppState
    @State private var showNotifications = false

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 200, ideal: 240)
        } detail: {
            if let channelId = app.selectedChannelId {
                HStack(spacing: 0) {
                    ChannelView(channelId: channelId)
                        .frame(maxWidth: .infinity)
                    if let rootId = app.openThreadRootId {
                        Divider()
                        ThreadPanelView(rootId: rootId)
                            .frame(width: 340)
                            .id(rootId)
                    }
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "number")
                        .font(.system(size: 40))
                        .foregroundStyle(.tertiary)
                    Text("Select a channel")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
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
                                    .background(Circle().fill(.red))
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
}

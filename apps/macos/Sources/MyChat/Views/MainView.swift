import SwiftUI

struct MainView: View {
    @EnvironmentObject private var app: AppState

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
    }
}

import SwiftUI
import GRDB

/// Root of the signed-in experience: a navigation stack over the channel list.
/// Ensures a workspace is selected on appear (restores the last active one,
/// falling back to the first available).
struct MainView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])
    @StateObject private var allChannels = DBObserved<[Channel]>(initial: [])
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            ChannelListView(onOpenChannel: { path.append($0) })
                .navigationDestination(for: String.self) { channelId in
                    ChannelScreen(channelId: channelId)
                }
        }
        .task {
            workspaces.start(db: app.db) { try Workspace.order(Column("name")).fetchAll($0) }
            allChannels.start(db: app.db) { try Channel.fetchAll($0) }
            app.restoreActiveWorkspace()
        }
        .onChange(of: workspaces.value) { _, list in
            if app.selectedWorkspaceId == nil, let first = list.first {
                app.selectWorkspace(first.id)
            }
        }
        .onChange(of: allChannels.value) { _, list in debugAutoOpen(list) }
        .environmentObject(app)
    }

    // DEBUG QA: FLOW_DEBUG_OPEN_CHANNEL=<name> auto-pushes that channel so the
    // simulator can be screenshot-verified without a UI tap tool.
    private func debugAutoOpen(_ channels: [Channel]) {
        #if DEBUG
        guard path.isEmpty,
              let name = ProcessInfo.processInfo.environment["FLOW_DEBUG_OPEN_CHANNEL"], !name.isEmpty,
              let ch = channels.first(where: { $0.name == name && $0.workspaceId == app.selectedWorkspaceId })
        else { return }
        path = [ch.id]
        #endif
    }
}

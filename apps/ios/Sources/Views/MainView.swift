import SwiftUI
import GRDB

/// Root of the signed-in experience. Mirrors the web client's *mobile* layout:
/// the conversation fills the screen, and the channel list lives in a slide-in
/// drawer (workspace rail + sidebar) that overlays it, opened from the header's
/// hamburger and dismissed by the backdrop or a selection.
///
/// The visible pane is driven by `AppState` (`selectedChannelId` / `showActivity`),
/// the same selection model macOS and web use — not a navigation stack of
/// channel ids. Threads still push onto the content pane's own `NavigationStack`.
struct MainView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var workspaces = DBObserved<[Workspace]>(initial: [])
    @StateObject private var allChannels = DBObserved<[Channel]>(initial: [])
    @State private var drawerOpen = false

    var body: some View {
        GeometryReader { geo in
            let drawerWidth = min(geo.size.width * 0.86, 320)
            ZStack(alignment: .leading) {
                content

                if drawerOpen {
                    Color.black.opacity(0.4)
                        .ignoresSafeArea()
                        .transition(.opacity)
                        .onTapGesture { closeDrawer() }
                        .accessibilityIdentifier("nav.drawerBackdrop")
                        .accessibilityLabel("Close menu")

                    SidebarDrawer(onSelect: { closeDrawer() })
                        .frame(width: drawerWidth)
                        .frame(maxHeight: .infinity)
                        .shadow(color: .black.opacity(0.35), radius: 18, x: 6, y: 0)
                        .transition(.move(edge: .leading))
                }
            }
            .animation(.easeInOut(duration: 0.22), value: drawerOpen)
        }
        .task {
            workspaces.start(db: app.db) { try Workspace.order(Column("name")).fetchAll($0) }
            allChannels.start(db: app.db) { try Channel.fetchAll($0) }
            app.restoreActiveWorkspace()
            #if DEBUG
            // QA: FLOW_DEBUG_OPEN_DRAWER=1 slides the channel drawer open on
            // launch so the simulator can be screenshot-verified without a tap
            // tool (compiled out of release).
            if ProcessInfo.processInfo.environment["FLOW_DEBUG_OPEN_DRAWER"] == "1" {
                drawerOpen = true
            }
            #endif
        }
        .onChange(of: workspaces.value) { _, list in
            if app.selectedWorkspaceId == nil, let first = list.first {
                app.selectWorkspace(first.id)
            }
        }
        .onChange(of: allChannels.value) { _, list in debugAutoOpen(list) }
        .environmentObject(app)
    }

    /// The full-screen conversation pane. A `NavigationStack` so a channel can
    /// push a thread (`ChannelScreen` owns that destination); its root swaps
    /// when the selection changes. The leading hamburger opens the drawer.
    private var content: some View {
        NavigationStack {
            Group {
                if app.showActivity {
                    ActivityFeedView(onOpenChannel: { app.selectChannel($0) })
                } else if let channelId = app.selectedChannelId {
                    ChannelScreen(channelId: channelId)
                        .id(channelId)
                } else {
                    emptyState
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        openDrawer()
                    } label: {
                        Image(systemName: "line.3.horizontal")
                    }
                    .accessibilityIdentifier("nav.menu")
                    .accessibilityLabel("Channels")
                }
            }
        }
    }

    private var emptyState: some View {
        Text("Select a channel")
            .foregroundStyle(MC.faint)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(MC.base)
            .navigationTitle(workspaceName)
            .navigationBarTitleDisplayMode(.inline)
    }

    private var workspaceName: String {
        workspaces.value.first { $0.id == app.selectedWorkspaceId }?.name ?? "Flow"
    }

    // The drawer slides over the whole screen, so a raised composer keyboard
    // would sit on top of it — put it away before opening (#69).
    private func openDrawer() {
        dismissKeyboard()
        drawerOpen = true
    }
    private func closeDrawer() { drawerOpen = false }

    // DEBUG QA: FLOW_DEBUG_OPEN_CHANNEL=<name> auto-selects that channel so the
    // simulator can be screenshot-verified without a UI tap tool.
    private func debugAutoOpen(_ channels: [Channel]) {
        #if DEBUG
        guard app.selectedChannelId == nil, !app.showActivity,
              let name = ProcessInfo.processInfo.environment["FLOW_DEBUG_OPEN_CHANNEL"], !name.isEmpty,
              let ch = channels.first(where: { $0.name == name && $0.workspaceId == app.selectedWorkspaceId })
        else { return }
        app.selectChannel(ch.id)
        #endif
    }
}

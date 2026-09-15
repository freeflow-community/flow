import SwiftUI

/// The channel browser (#590) — the macOS twin of web's `ChannelBrowserView`
/// (#588): every public channel in the workspace, joined or not, with search
/// over name and topic, Join, and an "Include archived" toggle. Replaces the
/// sidebar's inline Browse list; reached from "Browse all" under Channels.
///
/// Same "covers the content pane" shape as the Directory. Rows are fetched live
/// (`SyncEngine.browseChannels`) rather than read from the cache, which never
/// holds archived channels.
struct ChannelBrowserView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    @State private var rows: [BrowsableChannel] = []
    @State private var loading = true
    @State private var query = ""
    @State private var includeArchived = false
    @State private var joiningId: String?

    private var shown: [BrowsableChannel] {
        ChannelBrowser.filter(rows, query: query, includeArchived: includeArchived)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            searchBar
            Divider().opacity(0.5)
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(MC.base)
        .task(id: win.selectedWorkspaceId) { await load() }
    }

    private func load() async {
        guard let wsId = win.selectedWorkspaceId else {
            loading = false
            return
        }
        loading = true
        do {
            rows = try await app.engine.browseChannels(workspaceId: wsId)
        } catch {
            app.showError(error.localizedDescription)
        }
        loading = false
    }

    // MARK: - Chrome

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text("#").foregroundStyle(MC.muted)
                    Text("Browse channels")
                }
                .flowFont(size: 15, weight: .bold)
                .accessibilityIdentifier("channelBrowser.header")
                Text("Every public channel in this workspace")
                    .flowFont(.caption)
                    .foregroundStyle(MC.muted)
            }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 22)
        .frame(height: 60)
    }

    private var searchBar: some View {
        HStack(spacing: 12) {
            TextField("Search channels…", text: $query)
                .textFieldStyle(.roundedBorder)
                .flowFont(.callout)
                .frame(maxWidth: 280)
                .accessibilityIdentifier("channelBrowser.search")
                .accessibilityLabel("Search channels")
            Toggle("Include archived", isOn: $includeArchived)
                .toggleStyle(.checkbox)
                .flowFont(.caption)
                .foregroundStyle(MC.inkSoft)
                .accessibilityIdentifier("channelBrowser.includeArchived")
            Spacer()
            Text(ChannelBrowser.countLabel(shown.count))
                .flowFont(.caption2)
                .foregroundStyle(MC.faint)
                .accessibilityIdentifier("channelBrowser.count")
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 7)
    }

    @ViewBuilder
    private var content: some View {
        if let message = ChannelBrowser.emptyMessage(
            total: rows.count, shown: shown.count, loading: loading, query: query
        ) {
            Text(message)
                .flowFont(.callout)
                .foregroundStyle(MC.faint)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("channelBrowser.empty")
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(shown) { row in
                        rowView(row)
                        Divider().opacity(0.5)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .accessibilityIdentifier("channelBrowser.list")
        }
    }

    // MARK: - Row

    private func rowView(_ row: BrowsableChannel) -> some View {
        let c = row.channel
        let name = c.name ?? ""
        // A joined or archived channel opens (archived read-only); an unjoined
        // live one is entered through Join.
        let opens = c.isMember || row.isArchived
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    (Text("# ").foregroundStyle(MC.muted) + Text(name))
                        .flowFont(.callout, weight: .bold)
                        .foregroundStyle(MC.ink)
                        .lineLimit(1)
                    if row.isArchived {
                        Text("ARCHIVED")
                            .flowFont(size: 9, weight: .semibold)
                            .foregroundStyle(Color.orange)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.orange.opacity(0.15)))
                            .accessibilityIdentifier("channelBrowser.archivedBadge")
                    }
                }
                Text(subtitle(row))
                    .flowFont(.caption)
                    .foregroundStyle(MC.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if c.isMember {
                Text("✓ Joined")
                    .flowFont(.caption, weight: .semibold)
                    .foregroundStyle(MC.online)
                    .accessibilityIdentifier("channelBrowser.joined.\(name)")
            } else if !row.isArchived {
                Button(joiningId == c.id ? "Joining…" : "Join") { join(c) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(joiningId != nil)
                    .accessibilityIdentifier("channelBrowser.join.\(name)")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 9)
        .opacity(row.isArchived ? 0.6 : 1)
        .contentShape(Rectangle())
        .onTapGesture { if opens { open(c.id) } }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("channelBrowser.row.\(name)")
    }

    private func subtitle(_ row: BrowsableChannel) -> String {
        let topic = row.channel.topic?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let members = ChannelBrowser.memberLabel(row.memberCount)
        return topic.isEmpty ? members : "\(members) · \(topic)"
    }

    private func open(_ channelId: String) {
        win.selectChannel(channelId)
    }

    private func join(_ channel: Channel) {
        joiningId = channel.id
        Task {
            defer { joiningId = nil }
            do {
                let joined = try await app.engine.joinChannel(channel.id)
                win.selectChannel(joined.id)
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }
}

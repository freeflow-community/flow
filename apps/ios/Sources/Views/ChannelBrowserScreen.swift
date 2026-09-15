import SwiftUI

/// The channel browser (#590) — the iOS twin of web's `ChannelBrowserView`
/// (#588) and the macOS `ChannelBrowserView`: every public channel in the
/// workspace, with search over name and topic, Join, and an "Include archived"
/// toggle.
///
/// It takes the content pane the way the Directory does
/// (`app.showChannelBrowser`), reached from "Browse all" at the end of the
/// drawer's Channels section. Rows are fetched live, never cached — the cache
/// must not hold archived channels, which stay out of the drawer and unreads.
struct ChannelBrowserScreen: View {
    @EnvironmentObject private var app: AppState

    @State private var rows: [BrowsableChannel] = []
    @State private var loading = true
    @State private var query = ""
    @State private var includeArchived = false
    @State private var joiningId: String?

    private var shown: [BrowsableChannel] {
        ChannelBrowser.filter(rows, query: query, includeArchived: includeArchived)
    }

    var body: some View {
        VStack(spacing: 0) {
            searchBar
            content
        }
        .background(MC.base)
        .navigationTitle("Browse channels")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: app.selectedWorkspaceId) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let wsId = app.selectedWorkspaceId else {
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

    /// Search field, then the toggle and live count — a plain `TextField`
    /// rather than `.searchable`, for the reason `DirectoryScreen` gives.
    private var searchBar: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14))
                    .foregroundStyle(MC.muted)
                TextField("Search channels…", text: $query)
                    .font(.system(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .accessibilityIdentifier("channelBrowser.search")
                    .accessibilityLabel("Search channels")
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(MC.muted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 10).fill(MC.chat))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(MC.hairline2, lineWidth: 1))

            HStack {
                Toggle("Include archived", isOn: $includeArchived)
                    .font(.system(size: 14))
                    .foregroundStyle(MC.inkSoft)
                    .fixedSize()
                    .accessibilityIdentifier("channelBrowser.includeArchived")
                Spacer()
                Text(ChannelBrowser.countLabel(shown.count))
                    .font(.system(size: 13))
                    .foregroundStyle(MC.muted)
                    .accessibilityIdentifier("channelBrowser.count")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var content: some View {
        if let message = ChannelBrowser.emptyMessage(
            total: rows.count, shown: shown.count, loading: loading, query: query
        ) {
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(MC.faint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("channelBrowser.empty")
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(shown) { row in
                        rowView(row)
                        Divider().padding(.leading, 14)
                    }
                }
            }
            .accessibilityIdentifier("channelBrowser.list")
        }
    }

    private func rowView(_ row: BrowsableChannel) -> some View {
        let c = row.channel
        let name = c.name ?? ""
        // A joined or archived channel opens (archived read-only); an unjoined
        // live one is entered through Join.
        let opens = c.isMember || row.isArchived
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    (Text("# ").foregroundStyle(MC.muted) + Text(name))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(MC.ink)
                        .lineLimit(1)
                    if row.isArchived {
                        Text("ARCHIVED")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.orange)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.orange.opacity(0.15)))
                            .accessibilityIdentifier("channelBrowser.archivedBadge")
                    }
                }
                Text(subtitle(row))
                    .font(.system(size: 13))
                    .foregroundStyle(MC.muted)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if c.isMember {
                Text("✓ Joined")
                    .font(.system(size: 13, weight: .semibold))
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
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .opacity(row.isArchived ? 0.6 : 1)
        .contentShape(Rectangle())
        .onTapGesture { if opens { app.selectChannel(c.id) } }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("channelBrowser.row.\(name)")
    }

    private func subtitle(_ row: BrowsableChannel) -> String {
        let topic = row.channel.topic?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let members = ChannelBrowser.memberLabel(row.memberCount)
        return topic.isEmpty ? members : "\(members) · \(topic)"
    }

    private func join(_ channel: Channel) {
        joiningId = channel.id
        Task {
            defer { joiningId = nil }
            do {
                let joined = try await app.engine.joinChannel(channel.id)
                app.selectChannel(joined.id)
            } catch {
                app.showError(error.localizedDescription)
            }
        }
    }
}

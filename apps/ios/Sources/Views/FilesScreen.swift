import GRDB
import QuickLook
import SwiftUI

// Channel Files list (#348): the phone half of the Files panel (#347). The web
// and macOS panel is a side pane next to the chat; a phone has no room for one,
// so the same list is pushed full-screen from the channel's "⋯" menu — the
// design is otherwise identical, down to the plain-text sort links.
//
// Tapping a row goes to the viewer chat already uses for that kind: images to
// the full-screen lightbox, everything else (video, PDF, documents) to
// QuickLook, which plays media and carries its own share action. Each row also
// has a share button of its own, so a file can be sent on without opening it.

/// `.navigationDestination(item:)` needs an Identifiable route.
struct FilesRoute: Identifiable, Hashable {
    let channelId: String
    var id: String { channelId }
}

struct FilesScreen: View {
    let channelId: String
    @EnvironmentObject private var app: AppState

    @State private var sort: ChannelFileSort = .newest
    @State private var rows: [ChannelFile] = []
    @State private var total = 0
    @State private var cursor: String?
    @State private var loading = true
    @State private var loadingMore = false
    @State private var lightbox: ChannelFile?
    @State private var previewURL: URL?
    @State private var shareItem: ShareFile?
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)

    private var channelName: String { channel.value?.name ?? "channel" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            list
        }
        .navigationTitle("Files")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: channelId) {
            channel.start(db: app.db, reset: nil) { db in
                try Channel.fetchOne(db, key: channelId)
            }
        }
        .task(id: "\(channelId)|\(sort.rawValue)") { await reload() }
        .fullScreenCover(item: $lightbox) { row in
            ImageLightboxView(file: row.file)
        }
        .quickLookPreview($previewURL)
        .sheet(item: $shareItem) { item in
            ActivityView(items: [item.url])
        }
        .accessibilityIdentifier("files.screen")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("#\(channelName) · \(total) \(total == 1 ? "item" : "items")")
                .font(.system(size: 13))
                .foregroundStyle(MC.muted)
                .lineLimit(1)
                .accessibilityIdentifier("files.subtitle")
            // Plain text links, matching web and macOS — four options don't
            // earn a picker, and a picker would hide the current one.
            HStack(spacing: 14) {
                Text("Sort:").font(.system(size: 13)).foregroundStyle(MC.muted)
                ForEach(ChannelFileSort.allCases, id: \.self) { option in
                    Button {
                        guard sort != option else { return }
                        sort = option
                    } label: {
                        Text(option.label)
                            .font(.system(size: 13, weight: sort == option ? .bold : .regular))
                            .foregroundStyle(sort == option ? MC.accent : MC.muted)
                            .underline(sort == option)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("files.sort.\(option.rawValue)")
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var list: some View {
        if loading {
            centered { ProgressView() }
        } else if rows.isEmpty {
            centered {
                Text("No files shared yet")
                    .font(.system(size: 15))
                    .foregroundStyle(MC.faint)
                    .accessibilityIdentifier("files.empty")
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(rows) { row in
                        FileRowView(row: row, onOpen: { open(row) }, onShare: { share(row) })
                            .onAppear {
                                // Infinite scroll: the last row appearing is the
                                // request for the next page.
                                if row.id == rows.last?.id { Task { await loadMore() } }
                            }
                        Divider().padding(.leading, 84)
                    }
                    if loadingMore { ProgressView().padding(.vertical, 12) }
                }
            }
        }
    }

    private func centered<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack { Spacer(); content(); Spacer() }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Images get the in-app lightbox; everything else goes to QuickLook, which
    /// plays video, renders documents, and brings its own share action.
    private func open(_ row: ChannelFile) {
        if row.file.isImage {
            lightbox = row
        } else {
            Task {
                do {
                    previewURL = try await app.engine.downloadFile(row.file)
                } catch {
                    app.showError("Couldn't open \(row.file.name): \(error.localizedDescription)")
                }
            }
        }
    }

    private func share(_ row: ChannelFile) {
        Task {
            do {
                shareItem = ShareFile(url: try await app.engine.downloadFile(row.file))
            } catch {
                app.showError("Couldn't download \(row.file.name): \(error.localizedDescription)")
            }
        }
    }

    private func reload() async {
        loading = true
        rows = []
        cursor = nil
        do {
            let page = try await app.engine.channelFiles(channelId: channelId, sort: sort, before: nil)
            rows = page.files
            total = page.total
            cursor = page.nextCursor
        } catch {
            app.showError("Couldn't load files: \(error.localizedDescription)")
        }
        loading = false
    }

    private func loadMore() async {
        guard let cursor, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await app.engine.channelFiles(channelId: channelId, sort: sort, before: cursor)
            rows.append(contentsOf: page.files)
            total = page.total
            self.cursor = page.nextCursor
        } catch {
            // A failed page isn't worth an error banner mid-scroll; the next
            // row appearing retries it.
            self.cursor = cursor
        }
    }
}

/// One row: preview block, name + metadata line, share button.
private struct FileRowView: View {
    let row: ChannelFile
    let onOpen: () -> Void
    let onShare: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onOpen) {
                HStack(spacing: 12) {
                    RowThumb(row: row)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.file.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(MC.ink)
                            .lineLimit(1)
                        Text("\(row.file.sizeLabel) · \(row.uploaderName) · \(row.dateLabel)")
                            .font(.system(size: 13))
                            .foregroundStyle(MC.muted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                // maxWidth here, not a Spacer: a long filename's ideal width
                // would otherwise push the row past the panel and clip the
                // download button off its right edge.
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("files.row.\(row.file.name)")

            Button(action: onShare) {
                Image(systemName: "square.and.arrow.down")
                    .font(.system(size: 15))
                    .foregroundStyle(MC.accent)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(MC.accent.opacity(0.1)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Download \(row.file.name)")
            .accessibilityIdentifier("files.download.\(row.file.name)")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

/// Image thumbnail, or a tinted extension block. A video shows its duration,
/// read over the presigned stream URL rather than by downloading the video.
private struct RowThumb: View {
    let row: ChannelFile
    @EnvironmentObject private var app: AppState
    @State private var duration: Double?

    private static let tints: [String: Color] = [
        "pdf": Color(hex: 0xE11D48), "zip": Color(hex: 0x7C3AED), "gz": Color(hex: 0x7C3AED),
        "tar": Color(hex: 0x7C3AED), "xls": Color(hex: 0x059669), "xlsx": Color(hex: 0x059669),
        "csv": Color(hex: 0x059669), "doc": Color(hex: 0x0284C7), "docx": Color(hex: 0x0284C7),
        "key": Color(hex: 0xD97706), "ppt": Color(hex: 0xD97706), "pptx": Color(hex: 0xD97706),
    ]

    var body: some View {
        Group {
            if row.file.hasThumb {
                AuthImage(path: "/v1/files/\(row.file.id)/thumb") {
                    RoundedRectangle(cornerRadius: 8).fill(MC.daypill)
                }
                .scaledToFill()
            } else if row.file.isVideo {
                ZStack(alignment: .bottomTrailing) {
                    Rectangle().fill(Color(hex: 0x1E293B))
                    Image(systemName: "play.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.85))
                    Text(duration.map(VideoDuration.label) ?? "▶")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 3))
                        .padding(3)
                }
                .task(id: row.file.id) { await loadDuration() }
            } else {
                let tint = Self.tints[row.typeLabel] ?? MC.muted
                ZStack {
                    Rectangle().fill(tint.opacity(0.14))
                    Text(row.typeLabel.uppercased())
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(tint)
                }
            }
        }
        .frame(width: 60, height: 42)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func loadDuration() async {
        guard row.file.isVideo, duration == nil else { return }
        if let hit = VideoDuration.cached(fileId: row.file.id) {
            duration = hit
            return
        }
        guard let url = await app.engine.streamURL(fileId: row.file.id),
              let seconds = await VideoDuration.seconds(streamURL: url) else { return }
        VideoDuration.store(fileId: row.file.id, seconds: seconds)
        duration = seconds
    }
}

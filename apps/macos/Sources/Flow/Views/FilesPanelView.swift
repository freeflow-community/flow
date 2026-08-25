import AppKit
import GRDB
import SwiftUI

// Channel Files panel (#347): the Files tab's body inside the tabbed side panel
// (see SidePanelView). One vertical list of everything shared in the channel —
// thumbnail or type block, name, size, uploader, date, and a per-row download —
// with plain-text sort links above it and cursor paging below. Mirrors the web
// FilesPanel; the panel chrome (tab strip, close) lives in SidePanelView.
//
// Opening a row hands the file to the previewers the message list already uses,
// so an image, a video and a PDF behave here exactly as they do in the
// transcript. A type with no in-app viewer downloads instead.

struct FilesPanelView: View {
    let channelId: String
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState

    @State private var sort: ChannelFileSort = .newest
    @State private var rows: [ChannelFile] = []
    @State private var total = 0
    @State private var cursor: String?
    @State private var loading = true
    @State private var loadingMore = false
    @State private var preview: ChannelFile?
    @StateObject private var channel = DBObserved<Channel?>(initial: nil)

    private var channelName: String {
        channel.value?.name ?? "channel"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            list
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: channelId) {
            channel.start(db: app.db, reset: nil) { db in
                try Channel.fetchOne(db, key: channelId)
            }
        }
        .task(id: "\(channelId)|\(sort.rawValue)") { await reload() }
        .sheet(item: $preview) { row in
            FilePreviewSheet(file: row.file)
        }
        .accessibilityIdentifier("files.panel")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("Files").flowFont(size: 15, weight: .bold).foregroundStyle(MC.ink)
                Text("· #\(channelName) · \(total) \(total == 1 ? "item" : "items")")
                    .flowFont(size: 12)
                    .foregroundStyle(MC.muted)
                    .lineLimit(1)
                    .accessibilityIdentifier("files.subtitle")
            }
            // Plain text links, not a dropdown — four options don't earn a menu.
            HStack(spacing: 10) {
                Text("Sort:").flowFont(size: 12).foregroundStyle(MC.muted)
                ForEach(ChannelFileSort.allCases, id: \.self) { option in
                    Button {
                        guard sort != option else { return }
                        sort = option
                    } label: {
                        Text(option.label)
                            .flowFont(size: 12, weight: sort == option ? .bold : .regular)
                            .foregroundStyle(sort == option ? MC.accent : MC.muted)
                            .underline(sort == option)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("files.sort.\(option.rawValue)")
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var list: some View {
        if loading {
            centered { ProgressView().controlSize(.small) }
        } else if rows.isEmpty {
            centered {
                Text("No files shared yet")
                    .flowFont(size: 13)
                    .foregroundStyle(MC.faint)
                    .accessibilityIdentifier("files.empty")
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(rows) { row in
                        FileRowView(row: row) { preview = row }
                            .onAppear {
                                // Infinite scroll: the last row coming into view
                                // is the request for the next page.
                                if row.id == rows.last?.id { Task { await loadMore() } }
                            }
                    }
                    if loadingMore {
                        ProgressView().controlSize(.small).padding(.vertical, 8)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
        }
    }

    private func centered<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack { Spacer(); content(); Spacer() }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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
            // A failed page is not worth an error banner mid-scroll; the next
            // row appearing retries it.
            self.cursor = cursor
        }
    }
}

/// One list row: preview block, name + metadata line, download button.
private struct FileRowView: View {
    let row: ChannelFile
    let onOpen: () -> Void
    @EnvironmentObject private var app: AppState
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onOpen) {
                HStack(spacing: 10) {
                    RowThumb(row: row)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.file.name)
                            .flowFont(size: 13, weight: .semibold)
                            .foregroundStyle(MC.ink)
                            .lineLimit(1)
                        Text("\(row.file.sizeLabel) · \(row.uploaderName) · \(row.dateLabel)")
                            .flowFont(size: 11)
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

            DownloadIconButton(
                file: row.file,
                style: .panel,
                accessibilityId: "files.download.\(row.file.name)"
            )
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(hovering ? MC.accent.opacity(0.06) : .clear)
        )
        .onHover { hovering = $0 }
    }
}

/// Image thumbnail, or a tinted extension block for everything else. A video
/// gets the block plus a duration badge, read over the presigned stream URL —
/// the server only thumbnails images, so there's no first frame to show, and
/// downloading the video for a 56pt square would be absurd.
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
                    RoundedRectangle(cornerRadius: 6).fill(MC.daypill)
                }
                .scaledToFill()
            } else if row.file.isVideo {
                ZStack(alignment: .bottomTrailing) {
                    Rectangle().fill(Color(hex: 0x1E293B))
                    Image(systemName: "play.fill")
                        .flowFont(size: 12)
                        .foregroundStyle(.white.opacity(0.85))
                    Text(duration.map(VideoDuration.label) ?? "▶")
                        .flowFont(size: 9, weight: .semibold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 3))
                        .padding(2)
                }
                .task(id: row.file.id) { await loadDuration() }
            } else {
                let tint = Self.tints[row.typeLabel] ?? MC.muted
                ZStack {
                    Rectangle().fill(tint.opacity(0.14))
                    Text(row.typeLabel.uppercased())
                        .flowFont(size: 9, weight: .bold)
                        .foregroundStyle(tint)
                }
            }
        }
        .frame(width: 56, height: 38)
        .clipShape(RoundedRectangle(cornerRadius: 6))
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

/// Routes a row to whichever previewer the message list already uses for that
/// kind. Anything with no in-app viewer saves to Downloads and reveals it
/// rather than opening an empty sheet.
private struct FilePreviewSheet: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if file.isImage {
                ImageLightboxView(file: file)
            } else if file.isVideo {
                VideoLightboxView(file: file)
            } else if file.isPDF {
                PdfReaderView(file: file)
            } else {
                Color.clear.frame(width: 1, height: 1).task {
                    do {
                        let dest = try await app.engine.saveToDownloads(file)
                        NSWorkspace.shared.activateFileViewerSelecting([dest])
                    } catch {
                        app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
                    }
                    dismiss()
                }
            }
        }
    }
}

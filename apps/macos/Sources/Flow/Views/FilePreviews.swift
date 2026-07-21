import AppKit
import AVKit
import PDFKit
import SwiftUI

// Phase 6: inline previews for text-ish files and PDFs.
// ui_nits: inline video playback (AVKit) with an expanded-sheet lightbox.

extension FileAttachment {
    static let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "webm"]

    var isVideo: Bool {
        mimeType.hasPrefix("video/")
            || Self.videoExtensions.contains((name as NSString).pathExtension.lowercased())
    }

    /// AVFoundation has no VP8/VP9/webm support — those stay a file chip on
    /// macOS (deliberate divergence: web plays webm inline; see CHANGELOG Parity).
    var isPlayableVideo: Bool {
        guard isVideo else { return false }
        let ext = (name as NSString).pathExtension.lowercased()
        return mimeType != "video/webm" && ext != "webm"
    }

    /// ASCII-ish formats that get an inline monospace preview.
    var isTextPreviewable: Bool {
        if isImage { return false }
        if mimeType.hasPrefix("text/") { return true }
        if [
            "application/json", "application/javascript", "application/xml",
            "application/x-sh", "application/x-yaml",
        ].contains(mimeType) { return true }
        let ext = (name as NSString).pathExtension.lowercased()
        return Self.textExtensions.contains(ext)
    }

    static let textExtensions: Set<String> = [
        "txt", "md", "markdown", "log", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx",
        "py", "rb", "go", "rs", "java", "c", "cc", "cpp", "h", "hpp", "m", "swift", "kt",
        "sh", "bash", "zsh", "fish", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml",
        "html", "htm", "css", "scss", "less", "sql", "csv", "tsv", "env", "gitignore",
    ]

    var isPDF: Bool {
        mimeType == "application/pdf" || name.lowercased().hasSuffix(".pdf")
    }

    /// HTML renders sandboxed in the artifact panel (phase 9); in chat it
    /// still previews as text.
    var isHTML: Bool {
        mimeType == "text/html"
            || ["html", "htm"].contains((name as NSString).pathExtension.lowercased())
    }

    /// Sidebar glyph for an artifact row (phase 9) — mirrors web fileKind.ts.
    var artifactGlyph: String {
        if mimeType.hasPrefix("image/") { return "🖼️" }
        if isVideo { return "🎬" }
        if isPDF { return "📕" }
        if isHTML { return "🌐" }
        if isTextPreviewable { return "📝" }
        return "📄"
    }
}

/// Memory caches so scroll-recycled rows don't refetch/re-render previews.
/// MainActor-bound: only touched from view `.task` bodies.
@MainActor
enum PreviewCache {
    static let text: NSCache<NSString, NSString> = {
        let c = NSCache<NSString, NSString>()
        c.countLimit = 200
        return c
    }()
    static let pdfThumb: NSCache<NSString, NSImage> = {
        let c = NSCache<NSString, NSImage>()
        c.countLimit = 100
        return c
    }()
}

/// Hover "Download" affordance shared by all attachment cards: saves to
/// ~/Downloads and reveals in Finder.
struct DownloadIconButton: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var saving = false

    var body: some View {
        Button(action: save) {
            Group {
                if saving {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: "arrow.down.to.line")
                        .font(.system(size: 12, weight: .semibold))
                }
            }
            .frame(width: 24, height: 24)
            .background(RoundedRectangle(cornerRadius: 6).fill(.white.opacity(0.92)))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(MC.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .help("Download")
        .accessibilityIdentifier("msg.file.download.\(file.name)")
    }

    private func save() {
        guard !saving else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                let dest = try await app.engine.saveToDownloads(file)
                NSWorkspace.shared.activateFileViewerSelecting([dest])
            } catch {
                app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

/// Chevron + filename header shared by image/text/PDF cards; the chevron
/// collapses the card (persisted per device, same store as images).
struct AttachmentCardHeader: View {
    let file: FileAttachment
    @Binding var collapsed: Bool

    var body: some View {
        HStack(spacing: 4) {
            Button {
                collapsed.toggle()
                CollapsedImages.set(file.id, collapsed: collapsed)
            } label: {
                Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .frame(width: 12)
            }
            .buttonStyle(.plain)
            .foregroundStyle(MC.faint)
            .help(collapsed ? "Show preview" : "Hide preview")
            .accessibilityIdentifier("msg.file.collapse.\(file.name)")
            Text(file.name)
                .font(.system(size: 11))
                .foregroundStyle(MC.faint)
                .lineLimit(1)
        }
    }
}

// MARK: - Text preview

/// Inline monospace preview (phase 6): first lines + Expand, expanded output
/// capped at 100 KB with a visible truncation notice (operator ruling).
struct TextAttachmentView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var text: String?
    @State private var failed = false
    @State private var expanded = false
    @State private var hovering = false
    @State private var collapsed: Bool

    static let previewLines = 10
    static let expandMax = 100_000

    init(file: FileAttachment) {
        self.file = file
        _collapsed = State(initialValue: CollapsedImages.contains(file.id))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            AttachmentCardHeader(file: file, collapsed: $collapsed)
            if !collapsed {
                textBody
            }
        }
        .task(id: file.id) { await load() }
    }

    private var previewText: String {
        guard let text else { return "Loading…" }
        if expanded { return String(text.prefix(Self.expandMax)) }
        return text.split(separator: "\n", omittingEmptySubsequences: false)
            .prefix(Self.previewLines)
            .joined(separator: "\n")
    }

    private var canExpand: Bool {
        guard let text else { return false }
        return text.count > previewCollapsedLength
    }

    private var previewCollapsedLength: Int {
        guard let text else { return 0 }
        return text.split(separator: "\n", omittingEmptySubsequences: false)
            .prefix(Self.previewLines)
            .joined(separator: "\n").count
    }

    private var expandTruncated: Bool { (text?.count ?? 0) > Self.expandMax }

    @ViewBuilder
    private var textBody: some View {
        VStack(alignment: .leading, spacing: 3) {
            ZStack(alignment: .topTrailing) {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(failed ? "Preview unavailable" : previewText)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(failed ? MC.faint : MC.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 8).fill(MC.codeBg))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
                .frame(maxWidth: 560, alignment: .leading)
                .accessibilityIdentifier("msg.file.text.\(file.name)")

                if hovering {
                    DownloadIconButton(file: file)
                        .padding(6)
                }
            }
            if expanded, expandTruncated {
                Text("Showing the first 100 KB — Download for the full file.")
                    .font(.caption2)
                    .foregroundStyle(MC.faint)
            }
            if canExpand {
                Button(expanded ? "Collapse" : "Expand") { expanded.toggle() }
                    .buttonStyle(.link)
                    .font(.caption)
                    .accessibilityIdentifier("msg.file.expand.\(file.name)")
            }
        }
        .onHover { hovering = $0 }
    }

    private func load() async {
        if let hit = PreviewCache.text.object(forKey: file.id as NSString) {
            text = hit as String
            return
        }
        do {
            let value = try await app.engine.fileText(file)
            PreviewCache.text.setObject(value as NSString, forKey: file.id as NSString)
            text = value
        } catch {
            failed = true
        }
    }
}

// MARK: - PDF preview + reader

/// Mid-size first-page preview (PDFKit thumbnail); click opens the in-app
/// reader sheet.
struct PdfAttachmentView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var thumb: NSImage?
    @State private var failed = false
    @State private var hovering = false
    @State private var showReader = false
    @State private var collapsed: Bool

    init(file: FileAttachment) {
        self.file = file
        _collapsed = State(initialValue: CollapsedImages.contains(file.id))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            AttachmentCardHeader(file: file, collapsed: $collapsed)
            if !collapsed {
                pdfBody
            }
        }
        .task(id: file.id) { await loadThumb() }
    }

    private var pdfBody: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let thumb {
                    Image(nsImage: thumb)
                        .resizable()
                        .scaledToFit()
                } else if failed {
                    VStack(spacing: 6) {
                        Image(systemName: "doc.richtext")
                            .font(.title)
                            .foregroundStyle(.secondary)
                        Text("Preview unavailable")
                            .font(.caption2)
                            .foregroundStyle(MC.faint)
                    }
                } else {
                    ProgressView().controlSize(.small)
                }
            }
            .frame(width: 300, height: 388)
            .background(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.quaternary, lineWidth: 1))
            .contentShape(Rectangle())
            .onTapGesture { showReader = true }

            if hovering {
                DownloadIconButton(file: file)
                    .padding(6)
            }
        }
        .onHover { hovering = $0 }
        .sheet(isPresented: $showReader) {
            PdfReaderView(file: file)
        }
    }

    private func loadThumb() async {
        if let hit = PreviewCache.pdfThumb.object(forKey: file.id as NSString) {
            thumb = hit
            return
        }
        do {
            let url = try await app.engine.downloadFile(file)
            guard let doc = PDFDocument(url: url), let page = doc.page(at: 0) else {
                failed = true
                return
            }
            // 2x the display size so the preview is crisp on retina.
            let img = page.thumbnail(of: CGSize(width: 600, height: 776), for: .cropBox)
            PreviewCache.pdfThumb.setObject(img, forKey: file.id as NSString)
            thumb = img
        } catch {
            failed = true
        }
    }
}

/// In-app full PDF reader (phase 6): native PDFView, open-external and
/// download icon buttons. Esc / ✕ closes.
struct PdfReaderView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var doc: PDFDocument?
    @State private var failed = false
    @State private var busy = false

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Text(file.name)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                if busy { ProgressView().controlSize(.mini) }
                Spacer()
                Button(action: openExternal) {
                    Image(systemName: "arrow.up.right.square")
                }
                .help("Open external")
                .accessibilityIdentifier("pdfReader.openExternal")
                Button(action: download) {
                    Image(systemName: "arrow.down.to.line")
                }
                .help("Download")
                .accessibilityIdentifier("pdfReader.download")
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .help("Close")
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("pdfReader.close")
            }
            .buttonStyle(.borderless)

            Group {
                if let doc {
                    PDFKitView(document: doc)
                } else if failed {
                    Text("Couldn't load PDF")
                        .foregroundStyle(MC.faint)
                } else {
                    ProgressView()
                }
            }
            .frame(width: 860, height: 620)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .padding(14)
        .accessibilityIdentifier("pdfReader")
        .task(id: file.id) { await load() }
    }

    private func load() async {
        do {
            let url = try await app.engine.downloadFile(file)
            if let loaded = PDFDocument(url: url) {
                doc = loaded
            } else {
                failed = true
            }
        } catch {
            failed = true
        }
    }

    private func openExternal() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let url = try await app.engine.downloadFile(file)
                NSWorkspace.shared.open(url)
            } catch {
                app.showError("Couldn't open \(file.name): \(error.localizedDescription)")
            }
        }
    }

    private func download() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let dest = try await app.engine.saveToDownloads(file)
                NSWorkspace.shared.activateFileViewerSelecting([dest])
            } catch {
                app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Video preview + lightbox (ui_nits)

/// Inline video card: preview-card chrome (collapse chevron, hover Download)
/// around an AVKit player. A film-icon play placeholder defers the download
/// (up to 20 MB) until the user hits play — no server-side poster (ruled);
/// the expand button opens a larger sheet, consistent with the image lightbox.
struct VideoAttachmentView: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var player: AVPlayer?
    @State private var localURL: URL?
    @State private var loading = false
    @State private var failed = false
    @State private var hovering = false
    @State private var showLightbox = false
    @State private var collapsed: Bool

    init(file: FileAttachment) {
        self.file = file
        _collapsed = State(initialValue: CollapsedImages.contains(file.id))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            AttachmentCardHeader(file: file, collapsed: $collapsed)
            if !collapsed {
                videoBody
            }
        }
    }

    private var videoBody: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let player {
                    VideoPlayer(player: player)
                } else {
                    placeholder
                }
            }
            .frame(width: 480, height: 270)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
            .accessibilityIdentifier("msg.file.video.\(file.name)")

            if hovering {
                HStack(spacing: 6) {
                    Button {
                        showLightbox = true
                    } label: {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 24, height: 24)
                            .background(RoundedRectangle(cornerRadius: 6).fill(.white.opacity(0.92)))
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(MC.hairline, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .help("Expand")
                    .accessibilityIdentifier("msg.file.video.expand.\(file.name)")
                    DownloadIconButton(file: file)
                }
                .padding(6)
            }
        }
        .onHover { hovering = $0 }
        .sheet(isPresented: $showLightbox) {
            VideoLightboxView(file: file, localURL: localURL)
                .environmentObject(app)
        }
        .onChange(of: showLightbox) { _, open in
            if open { player?.pause() }
        }
    }

    private var placeholder: some View {
        Button(action: loadAndPlay) {
            ZStack {
                Rectangle().fill(MC.ink.opacity(0.85))
                VStack(spacing: 8) {
                    if loading {
                        ProgressView().controlSize(.small).tint(.white)
                    } else if failed {
                        Image(systemName: "film")
                            .font(.title)
                            .foregroundStyle(.white.opacity(0.7))
                        Text("Couldn't load video — Download to play")
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.7))
                    } else {
                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(.white.opacity(0.9))
                        Text(file.sizeLabel)
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("msg.file.video.play.\(file.name)")
    }

    private func loadAndPlay() {
        guard !loading, player == nil else { return }
        loading = true
        failed = false
        Task {
            defer { loading = false }
            do {
                let url = try await app.engine.downloadFile(file)
                localURL = url
                let p = AVPlayer(url: url)
                player = p
                p.play()
            } catch {
                failed = true
            }
        }
    }
}

/// Expanded video sheet, consistent with ImageLightboxView: open-external +
/// download icon buttons, Esc / ✕ closes. Reuses the inline card's local
/// download when it already happened.
struct VideoLightboxView: View {
    let file: FileAttachment
    var localURL: URL?
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    @State private var failed = false
    @State private var busy = false

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Text(file.name)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                if busy { ProgressView().controlSize(.mini) }
                Spacer()
                Button(action: openExternal) {
                    Image(systemName: "arrow.up.right.square")
                }
                .help("Open external")
                .accessibilityIdentifier("videoLightbox.openExternal")
                Button(action: download) {
                    Image(systemName: "arrow.down.to.line")
                }
                .help("Download")
                .accessibilityIdentifier("videoLightbox.download")
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .help("Close")
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("videoLightbox.close")
            }
            .buttonStyle(.borderless)

            Group {
                if let player {
                    VideoPlayer(player: player)
                } else if failed {
                    Text("Couldn't load video")
                        .foregroundStyle(MC.faint)
                } else {
                    ProgressView()
                }
            }
            .frame(width: 860, height: 484)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .padding(14)
        .accessibilityIdentifier("videoLightbox")
        .task(id: file.id) { await load() }
        .onDisappear { player?.pause() }
    }

    private func load() async {
        do {
            let url = try await resolveLocalURL()
            let p = AVPlayer(url: url)
            player = p
            p.play()
        } catch {
            failed = true
        }
    }

    private func resolveLocalURL() async throws -> URL {
        if let localURL, FileManager.default.fileExists(atPath: localURL.path) {
            return localURL
        }
        return try await app.engine.downloadFile(file)
    }

    private func openExternal() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                player?.pause()
                let url = try await resolveLocalURL()
                NSWorkspace.shared.open(url)
            } catch {
                app.showError("Couldn't open \(file.name): \(error.localizedDescription)")
            }
        }
    }

    private func download() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let dest = try await app.engine.saveToDownloads(file)
                NSWorkspace.shared.activateFileViewerSelecting([dest])
            } catch {
                app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

/// PDFKit bridge: native scrolling/zooming reader.
struct PDFKitView: NSViewRepresentable {
    let document: PDFDocument

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document !== document {
            view.document = document
        }
    }
}

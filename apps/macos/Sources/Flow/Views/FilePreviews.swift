import AppKit
import AVKit
import PDFKit
import SwiftUI

// Phase 6: inline previews for text-ish files and PDFs.
// ui_nits: inline video playback (AVKit) with an expanded-sheet lightbox.
//
// File-kind classification (isVideo/isPDF/isTextPreviewable/artifactGlyph, etc.)
// moved to the shared Models layer so the iOS target (which excludes these Views)
// can use it too.

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

/// "Download" affordance shared by every attachment surface: saves to
/// ~/Downloads and reveals in Finder. Two chromes over one action — the
/// attachment cards float it over a preview and need the opaque pill, the
/// Files panel (#347) sits it on a plain row where an accent circle reads.
struct DownloadIconButton: View {
    enum Style { case overlay, panel }

    let file: FileAttachment
    var style: Style = .overlay
    var accessibilityId: String?
    @EnvironmentObject private var app: AppState
    @State private var saving = false

    var body: some View {
        Button(action: save) {
            Group {
                if saving {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: "arrow.down.to.line")
                        .flowFont(size: 12, weight: .semibold)
                        .foregroundStyle(style == .panel ? MC.accent : Color.primary)
                }
            }
            .frame(width: 24, height: 24)
            .background {
                if style == .panel {
                    Circle().fill(MC.accent.opacity(0.12))
                } else {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.white.opacity(0.92))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(MC.hairline, lineWidth: 1))
                }
            }
        }
        .buttonStyle(.plain)
        .help("Download")
        // Without this the glyph's own name is read out ("End", for
        // arrow.down.to.line) — useless on a row that is already a filename.
        .accessibilityLabel("Download \(file.name)")
        .accessibilityIdentifier(accessibilityId ?? "msg.file.download.\(file.name)")
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
                    .flowFont(size: 9, weight: .semibold)
                    .frame(width: 12)
            }
            .buttonStyle(.plain)
            .foregroundStyle(MC.faint)
            .help(collapsed ? "Show preview" : "Hide preview")
            .accessibilityIdentifier("msg.file.collapse.\(file.name)")
            Text(file.name)
                .flowFont(size: 11)
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
                        .flowFont(size: 11, design: .monospaced)
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
                    .flowFont(.caption2)
                    .foregroundStyle(MC.faint)
            }
            if canExpand {
                Button(expanded ? "Collapse" : "Expand") { expanded.toggle() }
                    .buttonStyle(.link)
                    .flowFont(.caption)
                    .pointingHandCursor()
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
                            .flowFont(.title)
                            .foregroundStyle(.secondary)
                        Text("Preview unavailable")
                            .flowFont(.caption2)
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
                    .flowFont(size: 13, weight: .semibold)
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

/// Presentation size of a video's first video track — `naturalSize` with its
/// `preferredTransform` applied. The transform matters: a portrait iPhone clip
/// is stored as a 1920x1080 landscape buffer plus a 90° rotation, so
/// `naturalSize` alone would report it the wrong way round.
/// Returns nil for audio-only or undecodable assets; callers keep their default.
func videoPresentationSize(of asset: AVAsset) async -> CGSize? {
    guard let track = try? await asset.loadTracks(withMediaType: .video).first,
          let (natural, transform) = try? await track.load(.naturalSize, .preferredTransform)
    else { return nil }
    let oriented = natural.applying(transform)
    let size = CGSize(width: abs(oriented.width), height: abs(oriented.height))
    guard size.width > 1, size.height > 1 else { return nil }
    return size
}

/// Largest box with `size`'s aspect ratio fitting inside the given bounds.
/// Mirrors the inline-image rule (MessageListView.displaySize): never upscale
/// past the source's own pixels, so a small clip stays small rather than
/// rendering soft — pass `allowUpscale` for the lightbox, where filling the
/// sheet is the point of expanding.
func aspectFittedSize(
    _ size: CGSize, maxWidth: CGFloat, maxHeight: CGFloat, allowUpscale: Bool = false
) -> CGSize {
    guard size.width > 0, size.height > 0 else {
        return CGSize(width: maxWidth, height: maxHeight)
    }
    var scale = min(maxWidth / size.width, maxHeight / size.height)
    if !allowUpscale { scale = min(1, scale) }
    // Floor keeps AVKit's transport controls usable for postage-stamp clips.
    return CGSize(
        width: max(200, (size.width * scale).rounded()),
        height: max(120, (size.height * scale).rounded()))
}

/// Inline video card: preview-card chrome (collapse chevron, hover Download)
/// around an AVKit player. A film-icon play placeholder defers the download
/// (up to 20 MB) until the user hits play — no server-side poster (ruled);
/// the expand button opens a larger sheet, consistent with the image lightbox.
/// The player box tracks the clip's real aspect ratio once the asset is loaded
/// (#96) — the placeholder can't, since nothing is downloaded yet and the
/// server only records pixel dimensions for images.
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
    /// nil until the asset's tracks load; the card shows `Self.defaultSize` meanwhile.
    @State private var naturalSize: CGSize?

    /// 16:9 placeholder box, the historical fixed size of this card.
    static let defaultSize = CGSize(width: 480, height: 270)

    init(file: FileAttachment) {
        self.file = file
        _collapsed = State(initialValue: CollapsedImages.contains(file.id))
    }

    private var displaySize: CGSize {
        guard let naturalSize else { return Self.defaultSize }
        return aspectFittedSize(naturalSize, maxWidth: 480, maxHeight: 480)
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
            // Ceiling, not a size — same rule as the image card: keep the
            // aspect ratio and fit the transcript column rather than clipping
            // out of it when the side panel is open (#354).
            .aspectRatio(displaySize.width / displaySize.height, contentMode: .fit)
            .frame(maxWidth: displaySize.width, maxHeight: displaySize.height)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(MC.hairline, lineWidth: 1))
            .animation(.easeOut(duration: 0.15), value: displaySize)
            .accessibilityIdentifier("msg.file.video.\(file.name)")

            if hovering {
                HStack(spacing: 6) {
                    Button {
                        showLightbox = true
                    } label: {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .flowFont(size: 12, weight: .semibold)
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
                            .flowFont(.title)
                            .foregroundStyle(.white.opacity(0.7))
                        Text("Couldn't load video — Download to play")
                            .flowFont(.caption2)
                            .foregroundStyle(.white.opacity(0.7))
                    } else {
                        Image(systemName: "play.circle.fill")
                            .flowFont(size: 44)
                            .foregroundStyle(.white.opacity(0.9))
                        Text(file.sizeLabel)
                            .flowFont(.caption2)
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
                let asset = AVURLAsset(url: url)
                // Size the box before the player appears, so it lays out once.
                naturalSize = await videoPresentationSize(of: asset)
                let p = AVPlayer(playerItem: AVPlayerItem(asset: asset))
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
    @State private var naturalSize: CGSize?

    /// 16:9 sheet, the historical fixed size, used while the asset loads.
    static let defaultSize = CGSize(width: 860, height: 484)

    /// Upscaling is allowed here: filling the sheet is the point of expanding.
    private var displaySize: CGSize {
        guard let naturalSize else { return Self.defaultSize }
        return aspectFittedSize(naturalSize, maxWidth: 860, maxHeight: 620, allowUpscale: true)
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Text(file.name)
                    .flowFont(size: 13, weight: .semibold)
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
            .frame(width: displaySize.width, height: displaySize.height)
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
            let asset = AVURLAsset(url: url)
            naturalSize = await videoPresentationSize(of: asset)
            let p = AVPlayer(playerItem: AVPlayerItem(asset: asset))
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

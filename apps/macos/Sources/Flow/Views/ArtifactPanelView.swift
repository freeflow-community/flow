import AppKit
import AVKit
import PDFKit
import SwiftUI
import WebKit

// Phase 13: the artifact tab's body inside the tabbed side panel (see
// SidePanelView). A compact toolbar (rename + size + download) sits above the
// viewer, which renders images, video, PDF, HTML (sandboxed WKWebView), and
// text; anything else gets a download card — mirrors the web ArtifactBody. The
// panel chrome (tab strip, close) lives in SidePanelView; the underlying file
// stays access-checked server-side.

struct ArtifactPanelView: View {
    let artifactId: String
    @EnvironmentObject private var app: AppState

    private var artifact: Artifact? {
        app.artifacts.first { $0.id == artifactId }
    }

    var body: some View {
        Group {
            if let artifact {
                if artifact.isLink {
                    // Co-browsing mini-browser (link artifacts) — its own URL-bar chrome
                    // replaces the file toolbar.
                    LinkArtifactView(artifact: artifact)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let file = artifact.file {
                    VStack(spacing: 0) {
                        ArtifactToolbarView(artifact: artifact, file: file)
                        Rectangle().fill(MC.hairline).frame(height: 1)
                        ArtifactContentView(file: file)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .id(artifact.fileId)
                    }
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        // The artifact vanished (removed on another device / event raced the
        // list): fall back to the channel behind it.
        .onChange(of: artifact) { _, now in
            if now == nil { app.selectArtifact(nil) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("artifact.panel")
    }
}

/// Compact toolbar above the artifact viewer: click-to-edit name (rename), file
/// size, and Download. Closing/switching is handled by the side panel's tabs.
private struct ArtifactToolbarView: View {
    let artifact: Artifact
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var editing = false
    @State private var draft = ""
    @State private var busy = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            if editing {
                TextField("Artifact name", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .flowFont(size: 13, weight: .semibold)
                    .frame(maxWidth: 320)
                    .focused($nameFocused)
                    .onSubmit { saveRename() }
                    .onExitCommand { editing = false }
                    .accessibilityIdentifier("artifact.nameField")
            } else {
                Button {
                    draft = artifact.name
                    editing = true
                    nameFocused = true
                } label: {
                    Text(artifact.name)
                        .flowFont(size: 13, weight: .semibold)
                        .foregroundStyle(MC.muted)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                .help("Rename")
                .accessibilityIdentifier("artifact.title")
            }
            if busy { ProgressView().controlSize(.mini) }
            Spacer()
            Text(file.sizeLabel)
                .flowFont(.caption)
                .foregroundStyle(MC.faint)
            Button(action: download) {
                Image(systemName: "arrow.down.to.line")
            }
            .help("Download")
            .accessibilityIdentifier("artifact.download")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 16)
        .frame(height: 38)
    }

    private func saveRename() {
        let next = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        editing = false
        guard !next.isEmpty, next != artifact.name else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await app.engine.renameArtifact(id: artifact.id, name: next)
            } catch {
                app.showError("Couldn't rename artifact: \(error.localizedDescription)")
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

/// Type routing, same order as the web panel (image → video → pdf → html →
/// text → download card).
private struct ArtifactContentView: View {
    let file: FileAttachment

    var body: some View {
        if file.mimeType.hasPrefix("image/") {
            ArtifactImagePane(file: file)
        } else if file.isVideo {
            if file.isPlayableVideo {
                ArtifactVideoPane(file: file)
            } else {
                // webm stays a download card: AVFoundation can't decode it
                // (same deliberate divergence as the chat card; Parity note).
                ArtifactDownloadPane(file: file)
            }
        } else if file.isPDF {
            ArtifactPdfPane(file: file)
        } else if file.isHTML {
            ArtifactHtmlPane(file: file)
        } else if file.isTextPreviewable {
            ArtifactTextPane(file: file)
        } else {
            ArtifactDownloadPane(file: file)
        }
    }
}

private struct ArtifactImagePane: View {
    let file: FileAttachment

    var body: some View {
        Group {
            // GIFs skip the static thumb path and animate from the original.
            if file.mimeType == "image/gif" {
                AnimatedAuthImage(path: "/v1/files/\(file.id)")
            } else {
                AuthImage(path: "/v1/files/\(file.id)") {
                    ProgressView()
                }
                .scaledToFit()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MC.daypill.opacity(0.4))
        .accessibilityIdentifier("artifact.image.\(file.name)")
    }
}

/// Full-pane player. Downloads to disk first (streamed, not RAM) — same
/// whole-file strategy as the chat video card (Parity note re: streaming).
private struct ArtifactVideoPane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var player: AVPlayer?
    @State private var failed = false

    var body: some View {
        Group {
            if let player {
                VideoPlayer(player: player)
            } else if failed {
                ArtifactDownloadPane(file: file)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MC.ink.opacity(0.85))
        .accessibilityIdentifier("artifact.video.\(file.name)")
        .task(id: file.id) { await load() }
        .onDisappear { player?.pause() }
    }

    private func load() async {
        do {
            let url = try await app.engine.downloadFile(file)
            player = AVPlayer(url: url)
        } catch {
            failed = true
        }
    }
}

private struct ArtifactPdfPane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var doc: PDFDocument?
    @State private var failed = false

    var body: some View {
        Group {
            if let doc {
                PDFKitView(document: doc)
            } else if failed {
                ArtifactDownloadPane(file: file)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("artifact.pdf.\(file.name)")
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
}

/// Sandboxed HTML render (web parity with the sandboxed iframe): the bytes
/// are fetched through the authed API, then loaded as a string into an
/// isolated non-persistent WKWebView — no cookies and no baseURL, so the
/// document can never reach the session token or call the API as the user.
private struct ArtifactHtmlPane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var html: String?
    @State private var failed = false

    var body: some View {
        Group {
            if let html {
                SandboxedHTMLView(html: html)
            } else if failed {
                ArtifactDownloadPane(file: file)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("artifact.html.\(file.name)")
        .task(id: file.id) {
            do {
                html = try await app.engine.fileText(file)
            } catch {
                failed = true
            }
        }
    }
}

/// WKWebView bridge with an ephemeral data store (no cookies/credentials).
private struct SandboxedHTMLView: NSViewRepresentable {
    let html: String

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.loadHTMLString(html, baseURL: nil)
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        // Content is static per artifact: the panel is re-created per file
        // (`.id(artifact.fileId)` upstream), so nothing to update in place.
    }
}

// MARK: - Link artifact (co-browsing mini-browser, link artifacts)

/// A shared mini-browser: an editable URL bar above a live WKWebView of the
/// pinned page. Full fidelity (unlike the web iframe): a top-level web view has
/// no X-Frame-Options restriction, and the navigation delegate lets the URL bar
/// follow in-page clicks. Any navigation — typing a URL or clicking a link —
/// PATCHes the artifact, so the server re-points it and every member's viewer
/// follows (co-browse). Remote changes to `artifact.url` load here in turn.
struct LinkArtifactView: View {
    let artifact: Artifact
    @EnvironmentObject private var app: AppState
    @State private var draft: String = ""
    /// Bumped when the URL bar is submitted with the url we're already showing:
    /// nothing changes server-side, so this is what makes it a reload.
    @State private var reloadToken: Int = 0

    private var url: String { artifact.url ?? "" }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                TextField("Address", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .flowFont(size: 12, design: .monospaced)
                    .onSubmit { navigate(to: draft) }
                    .accessibilityIdentifier("artifact.link.urlField")
                if let u = URL(string: url) {
                    Button {
                        NSWorkspace.shared.open(u)
                    } label: {
                        Image(systemName: "arrow.up.right.square")
                    }
                    .buttonStyle(.borderless)
                    .help("Open in default browser")
                    .accessibilityIdentifier("artifact.link.openExternal")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            Rectangle().fill(MC.hairline).frame(height: 1)
            CoBrowserWebView(url: url, reloadToken: reloadToken) { navigated in
                // A navigation inside the web view (link click or form) — broadcast
                // it so everyone follows. Typing in the bar goes through navigate().
                broadcast(navigated)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { draft = url }
        // Follow the shared url when it changes remotely (or via our own echo).
        .onChange(of: url) { _, now in draft = now }
        .accessibilityIdentifier("artifact.link.\(artifact.name)")
    }

    /// Normalize a URL-bar entry (add a scheme to a bare host) and broadcast it.
    private func navigate(to raw: String) {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return }
        let withScheme = s.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil
            ? s : "https://\(s)"
        guard URL(string: withScheme) != nil else { draft = url; return }
        // Submitting the url already showing means "reload", not "no-op" — and it
        // also pulls the view back to the shared url after in-page browsing.
        if withScheme == url { reloadToken += 1; draft = url; return }
        broadcast(withScheme)
    }

    private func broadcast(_ next: String) {
        guard next != url else { return }
        Task {
            do {
                try await app.engine.setArtifactURL(id: artifact.id, url: next)
            } catch {
                draft = url
                app.showError("Couldn't change the page: \(error.localizedDescription)")
            }
        }
    }
}

/// WKWebView bridge that both renders the shared url and reports navigations
/// back. It loads a new url only when it differs from what's already shown, so
/// our own committed navigations (which echo back through `url`) never reload.
private struct CoBrowserWebView: NSViewRepresentable {
    let url: String
    /// Any change forces a fresh load of `url`, even when it's already showing.
    let reloadToken: Int
    let onNavigate: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onNavigate: onNavigate) }

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.navigationDelegate = context.coordinator
        context.coordinator.webView = view
        context.coordinator.lastReloadToken = reloadToken
        if let u = URL(string: url) {
            context.coordinator.lastLoaded = url
            view.load(URLRequest(url: u))
        }
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.onNavigate = onNavigate
        guard let u = URL(string: url) else { return }
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.lastLoaded = url
            view.load(URLRequest(url: u))
            return
        }
        // Load only genuine remote changes: skip when the view already shows this
        // url or we just loaded/committed it (prevents feedback loops).
        let current = view.url?.absoluteString
        if current != url && context.coordinator.lastLoaded != url {
            context.coordinator.lastLoaded = url
            view.load(URLRequest(url: u))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onNavigate: (String) -> Void
        weak var webView: WKWebView?
        var lastLoaded: String?
        var lastReloadToken = 0

        init(onNavigate: @escaping (String) -> Void) { self.onNavigate = onNavigate }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            guard let s = webView.url?.absoluteString else { return }
            // Ignore the programmatic load we issued for the current shared url;
            // report only user-driven navigations (link clicks, form submits).
            if s == lastLoaded { return }
            lastLoaded = s
            onNavigate(s)
        }
    }
}

private struct ArtifactTextPane: View {
    /// Full-pane viewer, roomier than the chat preview's 100 KB cap.
    static let maxChars = 1_000_000

    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var text: String?
    @State private var failed = false

    var body: some View {
        Group {
            if let text {
                ScrollView([.horizontal, .vertical]) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(String(text.prefix(Self.maxChars)))
                            .flowFont(size: 12, design: .monospaced)
                            .foregroundStyle(MC.ink)
                            .textSelection(.enabled)
                        if text.count > Self.maxChars {
                            Text("Showing the first 1 MB — Download for the full file.")
                                .flowFont(.caption2)
                                .foregroundStyle(MC.faint)
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.vertical, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if failed {
                ArtifactDownloadPane(file: file)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("artifact.text.\(file.name)")
        .task(id: file.id) {
            do {
                text = try await app.engine.fileText(file)
            } catch {
                failed = true
            }
        }
    }
}

/// Fallback card for types we can't render inline: click saves to
/// ~/Downloads and reveals in Finder (same behavior as the chat file chip).
private struct ArtifactDownloadPane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var saving = false

    var body: some View {
        Button(action: save) {
            HStack(spacing: 8) {
                Text("📄")
                VStack(alignment: .leading, spacing: 1) {
                    Text(file.name)
                        .flowFont(.callout, weight: .medium)
                        .foregroundStyle(MC.ink)
                        .lineLimit(1)
                    Text("\(file.sizeLabel) — click to download")
                        .flowFont(.caption2)
                        .foregroundStyle(MC.muted)
                }
                if saving {
                    ProgressView().controlSize(.mini)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 10).fill(.white))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(MC.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("artifact.chip.\(file.name)")
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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

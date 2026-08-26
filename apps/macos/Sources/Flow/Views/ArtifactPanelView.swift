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
    @EnvironmentObject private var win: WindowState

    private var artifact: Artifact? {
        win.artifacts().first { $0.id == artifactId }
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
            if now == nil { win.selectArtifact(nil) }
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
    @EnvironmentObject private var win: WindowState
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
    @EnvironmentObject private var win: WindowState
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
    @EnvironmentObject private var win: WindowState
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
    @EnvironmentObject private var win: WindowState
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
///
/// Mini apps (docs/design/MINI_APPS.md): when the artifact is an app, opening it
/// mints a five-minute identity token first and loads `url + ?flow_token=…`, so
/// the app's guard knows which member is looking. Only the *web view* ever sees
/// the token: the URL bar and the co-browsed shared url stay clean, and each
/// viewer mints their own. A reload re-mints, and a failed mint loads nothing at
/// all — see `MiniApp` for the decision and why a top-level web view can do this
/// when the web client's iframe cannot.
struct LinkArtifactView: View {
    let artifact: Artifact
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var win: WindowState
    @State private var draft: String = ""
    /// Bumped when the URL bar is submitted with the url we're already showing:
    /// nothing changes server-side, so this is what makes it a reload. For an
    /// app it also re-mints — a reload is a fresh token.
    @State private var reloadToken: Int = 0
    /// What the pane is showing. A plain link goes straight to `.loaded(url)`
    /// and stays there, so its behaviour is bit-for-bit what it was.
    @State private var frame: FrameState = .idle
    /// The open whose guard session cookie the web view is holding. While this
    /// matches, following the shared url around the app needs no second token —
    /// see `MiniApp.plan(url:isApp:hasAppSession:)` for why that matters.
    @State private var appSession: AppOpen?

    private var url: String { artifact.url ?? "" }

    /// Re-resolve whenever any input to the decision changes. Reload is in here
    /// so that submitting the current url re-mints rather than no-ops.
    private struct LoadKey: Equatable {
        let artifactId: String
        let url: String
        let isApp: Bool
        let reload: Int
    }

    private var loadKey: LoadKey {
        LoadKey(artifactId: artifact.id, url: url, isApp: artifact.isApp == true, reload: reloadToken)
    }

    /// One open of one app. A different artifact, or a reload, is a new open and
    /// mints again; a url change within the same open does not.
    private struct AppOpen: Equatable {
        let artifactId: String
        let reload: Int
    }

    private var currentOpen: AppOpen { AppOpen(artifactId: artifact.id, reload: reloadToken) }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                if artifact.isApp == true {
                    // Says why this artifact behaves differently from a pinned link.
                    Text("APP")
                        .flowFont(size: 9, weight: .semibold)
                        .foregroundStyle(MC.inkSoft)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(MC.daypill, in: RoundedRectangle(cornerRadius: 4))
                        .help("A Flow app — only channel members can open it")
                        .accessibilityIdentifier("artifact.link.appBadge")
                }
                TextField("Address", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .flowFont(size: 12, design: .monospaced)
                    .onSubmit { navigate(to: draft) }
                    .accessibilityIdentifier("artifact.link.urlField")
                if URL(string: url) != nil {
                    Button { openExternally() } label: {
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
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { draft = url }
        // Follow the shared url when it changes remotely (or via our own echo).
        .onChange(of: url) { _, now in draft = now }
        // Cancelled and re-run on every change of `loadKey`, so an in-flight mint
        // for a url we've navigated away from can never land on the web view.
        .task(id: loadKey) { await resolveFrame() }
        .accessibilityIdentifier("artifact.link.\(artifact.name)")
    }

    @ViewBuilder
    private var content: some View {
        switch frame {
        case .idle:
            LinkPanePlaceholder(text: "No URL")
        case .minting:
            LinkPanePlaceholder(text: "Opening app…", showsProgress: true)
                .accessibilityIdentifier("artifact.link.minting")
        case let .failed(message):
            AppMintErrorPane(message: message) { reloadToken += 1 }
        case let .loaded(src):
            CoBrowserWebView(url: src, reloadToken: reloadToken) { navigated in
                // A navigation inside the web view (link click or form) — broadcast
                // it so everyone follows. Typing in the bar goes through navigate().
                broadcast(navigated)
            }
        }
    }

    /// Decide what the web view loads, minting first when this is an app.
    ///
    /// The mint is what gates the load: until it returns, and if it fails, no
    /// request is made to the app's tunnel at all — asking for a page the guard
    /// would answer with its 401 helps nobody and leaks the open attempt.
    private func resolveFrame() async {
        let open = currentOpen
        switch MiniApp.plan(url: url, isApp: artifact.isApp == true, hasAppSession: appSession == open) {
        case .idle:
            appSession = nil
            frame = .idle
        case let .load(plain):
            // Either a plain link, or a co-browse hop inside an app we are
            // already signed in to. Note the web view is *not* torn down here —
            // `.loaded` to `.loaded` keeps it, so a hop doesn't flash.
            frame = .loaded(plain)
        case .mint:
            frame = .minting
            do {
                let minted = try await app.engine.mintAppToken(artifactId: artifact.id)
                guard !Task.isCancelled else { return }
                guard let tokened = withAppToken(url, token: minted.token) else {
                    // No token could be attached, so there is no url the guard
                    // would accept. Say so rather than loading the bare app url
                    // and rendering its 401.
                    frame = .failed("This app's address can't be opened.")
                    return
                }
                appSession = open
                frame = .loaded(tokened.absoluteString)
            } catch {
                guard !Task.isCancelled else { return }
                appSession = nil
                frame = .failed(error.localizedDescription)
            }
        }
    }

    /// Hand the page to the default browser. An app's url is useless on its own,
    /// so that one mints a token first — a fresh one, since the panel's is
    /// already burned.
    private func openExternally() {
        guard let plain = URL(string: url) else { return }
        guard artifact.isApp == true else { NSWorkspace.shared.open(plain); return }
        Task {
            do {
                let minted = try await app.engine.mintAppToken(artifactId: artifact.id)
                guard let tokened = withAppToken(url, token: minted.token) else {
                    app.showError("Couldn't open the app: its address can't carry a token.")
                    return
                }
                NSWorkspace.shared.open(tokened)
            } catch {
                app.showError("Couldn't open the app: \(error.localizedDescription)")
            }
        }
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
        // A minted token belongs to one viewer and is burned on first use, so it
        // must never become the shared url. It reaches here when the guard
        // rejects a token: that answers 401 without redirecting, so the web view
        // commits the url with `?flow_token=…` still on it.
        guard !MiniApp.carriesToken(next) else { return }
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

/// What the mini-browser's viewport is showing. Only `.loaded` puts a request on
/// the wire, so a failed mint never reaches an app's tunnel.
private enum FrameState: Equatable {
    case idle
    case minting
    case loaded(String)
    case failed(String)
}

/// The empty/among-states pane: same centred, muted treatment the panel uses for
/// anything that isn't content yet.
private struct LinkPanePlaceholder: View {
    let text: String
    var showsProgress: Bool = false

    var body: some View {
        VStack(spacing: 8) {
            if showsProgress { ProgressView().controlSize(.small) }
            Text(text)
                .flowFont(size: 12)
                .foregroundStyle(MC.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
    }
}

/// A mint that failed — the member is no longer in the channel, the artifact is
/// gone, or the server is unreachable. Nothing was loaded, so the pane says what
/// happened and offers the retry rather than showing a broken page.
private struct AppMintErrorPane: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Text("Couldn't open this app")
                .flowFont(size: 13, weight: .semibold)
                .foregroundStyle(MC.ink)
            Text(message)
                .flowFont(size: 12)
                .foregroundStyle(MC.inkSoft)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            Button("Try again", action: onRetry)
                .accessibilityIdentifier("artifact.link.appRetry")
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
        .accessibilityIdentifier("artifact.link.appError")
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
            context.coordinator.request(url, on: view, u)
        }
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.onNavigate = onNavigate
        guard let u = URL(string: url) else { return }
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.request(url, on: view, u)
            return
        }
        // Load only genuine remote changes: skip when we already asked for this
        // url, when the view already shows it, or when we just committed it
        // (prevents feedback loops). The "already asked for it" arm is what keeps
        // an app's tokened url from being re-requested after the guard redirects
        // away from it — the token is burned, so a second request would 401.
        let current = view.url?.absoluteString
        if context.coordinator.lastRequested != url,
           current != url,
           context.coordinator.lastLoaded != url {
            context.coordinator.request(url, on: view, u)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onNavigate: (String) -> Void
        weak var webView: WKWebView?
        var lastLoaded: String?
        /// The last url we *asked* the web view to load, which is not always what
        /// it settles on: an app's load is a tokened url the guard immediately
        /// redirects away from.
        var lastRequested: String?
        var lastReloadToken = 0

        /// The navigation `load` handed back for our own request, so we can
        /// still recognise it after a redirect has changed the url out from
        /// under it. An app's open is exactly that: we ask for the tokened url
        /// and the guard 302s us to the clean one.
        var ownNavigation: WKNavigation?

        func request(_ raw: String, on view: WKWebView, _ resolved: URL) {
            lastRequested = raw
            lastLoaded = raw
            ownNavigation = view.load(URLRequest(url: resolved))
        }

        init(onNavigate: @escaping (String) -> Void) { self.onNavigate = onNavigate }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            guard let s = webView.url?.absoluteString else { return }
            let isOwnLoad = navigation != nil && navigation === ownNavigation
            if isOwnLoad { ownNavigation = nil }
            guard MiniApp.isMemberNavigation(committed: s, isOwnLoad: isOwnLoad, lastLoaded: lastLoaded)
            else {
                // Still remember where our own load landed, so a later update
                // carrying that url doesn't re-request it.
                lastLoaded = s
                return
            }
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
    @EnvironmentObject private var win: WindowState
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
    @EnvironmentObject private var win: WindowState
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

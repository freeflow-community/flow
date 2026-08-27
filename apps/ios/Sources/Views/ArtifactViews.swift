import AVKit
import PDFKit
import QuickLook
import SwiftUI
import UIKit
import WebKit

/// iOS artifacts UI (#157). A phone has no room for the macOS/web shape —
/// nested sidebar rows plus a persistent side panel — so the channel header
/// carries the whole affordance: the channel's artifacts listed in the header
/// "⋯" menu (#188), and a full-screen viewer sheet.
///
/// Read-only this round: no pin-as-artifact. Link artifacts do co-browse in a
/// mini-browser, and app artifacts open inline in it without co-browsing at all
/// (#380). See CHANGELOG Parity.

// MARK: - Header menu

/// The channel's artifacts, as a submenu of the header's "⋯" menu (#188 — it
/// used to be a toolbar button of its own). Always present, so the affordance
/// is discoverable in an empty channel too. The count rides in the label, since
/// a submenu row has nowhere to hang a badge.
struct ArtifactsMenu: View {
    let channelId: String
    @EnvironmentObject private var app: AppState

    private var artifacts: [Artifact] { app.artifacts(inChannel: channelId) }

    var body: some View {
        Menu {
            if artifacts.isEmpty {
                Text("No artifacts yet")
            } else {
                ForEach(artifacts) { artifact in
                    Button {
                        app.selectArtifact(artifact.id)
                    } label: {
                        Text("\(artifact.glyph)  \(artifact.name)")
                    }
                    .accessibilityIdentifier("artifact.row.\(artifact.name)")
                }
            }
        } label: {
            // The count rides in the title: a submenu row's accessibilityValue
            // is dropped by the menu, so the label is the only place both
            // VoiceOver and the UI tests can read it.
            Label(artifacts.isEmpty ? "Artifacts" : "Artifacts (\(artifacts.count))",
                  systemImage: "doc.text")
        }
        .accessibilityIdentifier("channel.artifacts")
    }
}

/// `.sheet(item:)` needs an Identifiable; `AppState` holds the selection as a
/// bare id (shared with macOS, where it drives a side panel instead).
struct ArtifactRoute: Identifiable, Equatable {
    let id: String
}

// MARK: - Viewer

/// Full-screen viewer for one artifact. Type routing follows the macOS panel
/// (image → video → pdf → html → text → download card) so the same artifact
/// renders the same way on both; the chrome is a phone sheet, not a tab strip.
struct ArtifactSheet: View {
    let artifactId: String
    @EnvironmentObject private var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var shareItem: ArtifactShareFile?
    @State private var sharing = false

    private var artifact: Artifact? {
        app.artifacts.first { $0.id == artifactId }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let artifact {
                    if artifact.isLink {
                        ArtifactLinkPane(artifact: artifact)
                    } else if let file = artifact.file {
                        ArtifactContentPane(file: file)
                            .id(file.id)
                    } else {
                        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(MC.base)
            .navigationTitle(artifact?.name ?? "Artifact")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityIdentifier("artifact.close")
                    .accessibilityLabel("Close")
                }
                if let file = artifact?.file {
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            share(file)
                        } label: {
                            if sharing {
                                ProgressView()
                            } else {
                                Image(systemName: "square.and.arrow.up")
                            }
                        }
                        .accessibilityIdentifier("artifact.share")
                        .accessibilityLabel("Share")
                    }
                }
            }
        }
        .sheet(item: $shareItem) { item in
            ArtifactActivityView(items: [item.url])
        }
        // Removed here or on another device while we're looking at it: close
        // rather than sit on a stale title.
        .onChange(of: artifact) { _, now in
            if now == nil { dismiss() }
        }
        .accessibilityIdentifier("artifact.sheet")
    }

    private func share(_ file: FileAttachment) {
        guard !sharing else { return }
        sharing = true
        Task {
            defer { sharing = false }
            do {
                shareItem = ArtifactShareFile(url: try await app.engine.downloadFile(file))
            } catch {
                app.showError("Couldn't download \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

private struct ArtifactContentPane: View {
    let file: FileAttachment

    var body: some View {
        // Route on the mime type, not `isImage` (which means "has a thumb") —
        // an agent-generated image may have no thumb but still renders.
        if file.mimeType.hasPrefix("image/") {
            ArtifactImagePane(file: file)
        } else if file.isVideo {
            if file.isPlayableVideo {
                ArtifactVideoPane(file: file)
            } else {
                // webm stays a download card: AVFoundation can't decode it
                // (same deliberate divergence as macOS; Parity note).
                ArtifactFilePane(file: file)
            }
        } else if file.isPDF {
            ArtifactPdfPane(file: file)
        } else if file.isHTML {
            ArtifactHtmlPane(file: file)
        } else if file.isTextPreviewable {
            ArtifactTextPane(file: file)
        } else {
            ArtifactFilePane(file: file)
        }
    }
}

/// Pinch, double-tap and pan come from the shared `ZoomableImageView` — a
/// `UIScrollView` around the image. Nothing here is free: a plain
/// `.scaledToFit` image has no zoom at all, which is what this pane shipped
/// with until #202.
private struct ArtifactImagePane: View {
    let file: FileAttachment
    @State private var zoomed = false

    var body: some View {
        ZoomableImageView(contentId: file.id, isZoomed: $zoomed) {
            if file.mimeType == "image/gif" {
                AnimatedAuthImage(path: "/v1/files/\(file.id)")
            } else {
                AuthImage(path: "/v1/files/\(file.id)") {
                    ProgressView()
                }
                .scaledToFit()
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MC.daypill.opacity(0.4))
        // While zoomed, a downward pan is a pan — not the sheet's dismiss.
        .interactiveDismissDisabled(zoomed)
        .accessibilityIdentifier("artifact.image.\(file.name)")
    }
}

/// Downloads to disk first (streamed, not RAM) — same whole-file strategy as
/// macOS and the chat video card (Parity note re: streaming).
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
                ArtifactFilePane(file: file)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(MC.ink.opacity(0.85))
        .accessibilityIdentifier("artifact.video.\(file.name)")
        .task(id: file.id) {
            do {
                player = AVPlayer(url: try await app.engine.downloadFile(file))
            } catch {
                failed = true
            }
        }
        .onDisappear { player?.pause() }
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
                ArtifactFilePane(file: file)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .accessibilityIdentifier("artifact.pdf.\(file.name)")
        .task(id: file.id) {
            do {
                let url = try await app.engine.downloadFile(file)
                if let loaded = PDFDocument(url: url) { doc = loaded } else { failed = true }
            } catch {
                failed = true
            }
        }
    }
}

private struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.document = document
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document !== document { view.document = document }
    }
}

/// Sandboxed HTML render, same isolation as the macOS panel and the web
/// client's sandboxed iframe: bytes come through the authed API, then load as a
/// string into an ephemeral `WKWebView` with no baseURL — so the document can
/// never reach the session token or call the API as the user.
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
                ArtifactFilePane(file: file)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
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

private struct SandboxedHTMLView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.loadHTMLString(html, baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        // Static per artifact — the pane is re-created per file (`.id(file.id)`
        // upstream), so there's nothing to update in place.
    }
}

private struct ArtifactTextPane: View {
    /// Same full-pane cap as macOS, roomier than the chat preview's 100 KB.
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
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(MC.ink)
                            .textSelection(.enabled)
                        if text.count > Self.maxChars {
                            Text("Showing the first 1 MB — Share for the full file.")
                                .font(.caption2)
                                .foregroundStyle(MC.faint)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if failed {
                ArtifactFilePane(file: file)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
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

/// Fallback for types we don't render inline: hand the file to QuickLook, whose
/// viewer covers most everything else and has share built in. (macOS saves to
/// ~/Downloads and reveals in Finder — a phone has no Finder.)
private struct ArtifactFilePane: View {
    let file: FileAttachment
    @EnvironmentObject private var app: AppState
    @State private var previewURL: URL?
    @State private var busy = false

    var body: some View {
        Button(action: openPreview) {
            VStack(spacing: 10) {
                Image(systemName: "doc")
                    .font(.system(size: 40))
                    .foregroundStyle(.secondary)
                Text(file.name)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(MC.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                Text("\(file.sizeLabel) — tap to open")
                    .font(.caption)
                    .foregroundStyle(MC.muted)
                if busy { ProgressView().controlSize(.small) }
            }
            .padding(24)
            .background(RoundedRectangle(cornerRadius: 12).fill(.background))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(MC.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .quickLookPreview($previewURL)
        .accessibilityIdentifier("artifact.chip.\(file.name)")
    }

    private func openPreview() {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                previewURL = try await app.engine.downloadFile(file)
            } catch {
                app.showError("Couldn't open \(file.name): \(error.localizedDescription)")
            }
        }
    }
}

/// Whether two urls address the same page. Deliberately not string equality:
/// WebKit canonicalizes on commit (`https://host` comes back as
/// `https://host/`), and a literal compare reads that as a user navigation — so
/// merely *opening* a link artifact PATCHed it and re-pointed the page for
/// every other viewer. macOS compares literally and has the same quirk.
private func sameArtifactPage(_ a: String?, _ b: String?) -> Bool {
    guard let a, let b else { return false }
    if a == b { return true }
    guard let ua = URL(string: a), let ub = URL(string: b) else { return false }
    let pathA = ua.path.isEmpty ? "/" : ua.path
    let pathB = ub.path.isEmpty ? "/" : ub.path
    return ua.scheme == ub.scheme && ua.host == ub.host && ua.port == ub.port
        && pathA == pathB && ua.query == ub.query && ua.fragment == ub.fragment
}

/// The co-browsing mini-browser, ported from macOS `LinkArtifactView`: an
/// editable address bar over a live web view of the pinned page. For a *link*
/// artifact any navigation — typing a URL or tapping a link — PATCHes the
/// artifact, so the server re-points it and every member's viewer follows.
/// Remote changes load here in turn. Anything less and a link artifact is just
/// a shared link (operator's call, 2026-07-30 — see decision_log).
///
/// Mini apps (docs/design/MINI_APPS.md, #380) ride in the same pane and behave
/// differently in exactly two ways. Opening one mints a five-minute identity
/// token first and loads `url + ?flow_token=…` **top-level in this web view**,
/// so the app renders already signed in as the viewer — the #371 cookie block
/// is iframe-specific, not WebKit-wide, measured in this very `WKWebView`
/// during #373. And it co-browses nothing: each viewer is in their own guard
/// session, so one member's clicks — or the guard's own 302 on every open —
/// must never re-point the shared artifact for the channel.
private struct ArtifactLinkPane: View {
    let artifact: Artifact
    @EnvironmentObject private var app: AppState
    @Environment(\.openURL) private var openURL
    @State private var draft: String = ""
    /// Bumped when the address bar is submitted with the url already showing:
    /// nothing changes server-side, so this is what makes it a reload. For an
    /// app it also re-mints — a reload is a fresh token.
    @State private var reloadToken: Int = 0
    /// What the pane is showing. A plain link goes straight to `.loaded(url)`
    /// and stays there, so its behaviour is what it always was.
    @State private var frame: FrameState = .idle
    /// The open whose guard session cookie the web view is holding. While this
    /// matches, following the shared url around the app needs no second token —
    /// see `MiniApp.plan(url:isApp:hasAppSession:)` for why that matters.
    @State private var appSession: AppOpen?
    /// Set while the hand-off mint is in flight, so the button can't be
    /// double-tapped into two tokens.
    @State private var handingOff = false

    private var url: String { artifact.url ?? "" }
    private var isApp: Bool { artifact.isApp == true }

    /// Re-resolve whenever any input to the decision changes. Reload is in here
    /// so that submitting the current url re-mints rather than no-ops.
    private struct LoadKey: Equatable {
        let artifactId: String
        let url: String
        let isApp: Bool
        let reload: Int
    }

    private var loadKey: LoadKey {
        LoadKey(artifactId: artifact.id, url: url, isApp: isApp, reload: reloadToken)
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
            HStack(spacing: 8) {
                if isApp {
                    Text("APP")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(MC.muted)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 4).fill(MC.hairline3))
                        .accessibilityIdentifier("artifact.link.appBadge")
                }
                TextField("Address", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.go)
                    .onSubmit { navigate(to: draft) }
                    .accessibilityIdentifier("artifact.link.urlField")
                if let u = URL(string: url) {
                    Button {
                        // The secondary action, kept from #373: an app's url is
                        // useless without a token, so hand-off mints a fresh one
                        // (the pane's is already burned); a plain link opens as
                        // it always did.
                        if isApp { openInBrowser() } else { openURL(u) }
                    } label: {
                        if handingOff {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "safari")
                        }
                    }
                    .disabled(handingOff)
                    .accessibilityIdentifier("artifact.link.open")
                    .accessibilityLabel(isApp ? "Open in Browser" : "Open in Safari")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
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
        // Without `.contain`, the container's identifier overwrites every
        // child's — including the address field's and the Safari button's.
        .accessibilityElement(children: .contain)
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
            CoBrowserWebView(url: src, isApp: isApp, reloadToken: reloadToken, onNavigate: broadcast)
        }
    }

    /// Decide what the web view loads, minting first when this is an app.
    ///
    /// The mint is what gates the load: until it returns, and if it fails, no
    /// request is made to the app's tunnel at all — asking for a page the guard
    /// would answer with its 401 helps nobody and leaks the open attempt.
    private func resolveFrame() async {
        let open = currentOpen
        switch MiniApp.plan(url: url, isApp: isApp, hasAppSession: appSession == open) {
        case .idle:
            appSession = nil
            frame = .idle
        case let .load(plain):
            // Either a plain link, or a url change inside an app we are already
            // signed in to. The web view is *not* torn down here — `.loaded` to
            // `.loaded` keeps it, so the page doesn't flash.
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

    /// The #373 hand-off, now the secondary action: mint a *fresh* token and let
    /// mobile Safari have it (`docs/design/MINI_APPS.md`). The mint comes first
    /// and its failure is terminal: nothing is opened, so the app's origin is
    /// never asked for a page its guard would answer with a 401.
    private func openInBrowser() {
        guard !handingOff, !url.isEmpty else { return }
        handingOff = true
        Task {
            defer { handingOff = false }
            do {
                let minted = try await app.engine.mintAppToken(artifactId: artifact.id)
                guard let tokened = withAppToken(url, token: minted.token) else {
                    app.showError("Couldn't open \(artifact.name): its address isn't a valid url.")
                    return
                }
                openURL(tokened)
            } catch {
                app.showError("Couldn't open \(artifact.name): \(error.localizedDescription)")
            }
        }
    }

    /// Normalize an address-bar entry (add a scheme to a bare host) and broadcast.
    private func navigate(to raw: String) {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return }
        let withScheme = s.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil
            ? s : "https://\(s)"
        guard URL(string: withScheme) != nil else { draft = url; return }
        // An app's address is fixed: it can't be co-browsed (#380), so there is
        // no url to move the artifact to and every submit is a reload — which
        // for an app also means a fresh token.
        if isApp { reloadToken += 1; draft = url; return }
        // Submitting the url already showing means "reload", not "no-op" — and
        // it also pulls the view back to the shared url after in-page browsing.
        if sameArtifactPage(withScheme, url) { reloadToken += 1; draft = url; return }
        broadcast(withScheme)
    }

    private func broadcast(_ next: String) {
        // An app is opened, not co-browsed, and a minted token belongs to one
        // viewer and is burned on first use — neither may become the shared url.
        guard MiniApp.canBroadcast(next, isApp: isApp) else { return }
        guard !sameArtifactPage(next, url) else { return }
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

/// The empty/in-between pane: centred and muted, matching the macOS panel's.
private struct LinkPanePlaceholder: View {
    let text: String
    var showsProgress: Bool = false

    var body: some View {
        VStack(spacing: 8) {
            if showsProgress { ProgressView().controlSize(.small) }
            Text(text)
                .font(.system(size: 13))
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
                .font(.callout.weight(.semibold))
                .foregroundStyle(MC.ink)
            Text(message)
                .font(.footnote)
                .foregroundStyle(MC.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Try again", action: onRetry)
                .accessibilityIdentifier("artifact.link.appRetry")
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
        // Without `.contain`, this identifier swallows the retry button's and the
        // one affordance on the pane becomes unreachable to VoiceOver and to
        // the UI tests (measured on iOS during #380 verification).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("artifact.link.appError")
    }
}

/// Renders what the pane resolved and reports navigations back — the UIKit half
/// of the macOS `CoBrowserWebView`. It loads a new url only when it differs from
/// what's already showing, so our own committed navigations (which echo back
/// through `url`) never reload.
private struct CoBrowserWebView: UIViewRepresentable {
    let url: String
    /// An app's navigations are never co-browsed (#380) — the coordinator is
    /// what decides whether to report one at all, so it has to know.
    let isApp: Bool
    /// Any change forces a fresh load of `url`, even when it's already showing.
    let reloadToken: Int
    let onNavigate: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(isApp: isApp, onNavigate: onNavigate) }

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        context.coordinator.isApp = isApp
        context.coordinator.lastReloadToken = reloadToken
        if let u = URL(string: url) {
            context.coordinator.request(url, on: view, u)
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onNavigate = onNavigate
        context.coordinator.isApp = isApp
        guard let u = URL(string: url) else { return }
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.request(url, on: view, u)
            return
        }
        // Load only genuine changes: skip when we already asked for this url,
        // when the view already shows it, or when we just committed it
        // (prevents feedback loops). The "already asked for it" arm is what
        // keeps an app's tokened url from being re-requested after the guard
        // redirects away from it — the token is burned, so a second request
        // would 401.
        let current = view.url?.absoluteString
        if !Coordinator.samePage(context.coordinator.lastRequested, url),
           !Coordinator.samePage(current, url),
           !Coordinator.samePage(context.coordinator.lastLoaded, url) {
            context.coordinator.request(url, on: view, u)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onNavigate: (String) -> Void
        var isApp: Bool
        var lastLoaded: String?
        /// The last url we *asked* the web view to load, which is not always
        /// what it settles on: an app's load is a tokened url the guard
        /// immediately redirects away from.
        var lastRequested: String?
        var lastReloadToken = 0

        init(isApp: Bool, onNavigate: @escaping (String) -> Void) {
            self.isApp = isApp
            self.onNavigate = onNavigate
        }

        func request(_ raw: String, on view: WKWebView, _ resolved: URL) {
            lastRequested = raw
            lastLoaded = raw
            view.load(URLRequest(url: resolved))
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            guard let s = webView.url?.absoluteString else { return }
            // Ignore the programmatic load we issued for the url on show;
            // report only user-driven navigations (link taps, form submits).
            if Self.samePage(s, lastLoaded) { return }
            // `isOwnLoad: false` is the honest answer here: unlike macOS this
            // coordinator does not match `WKNavigation` identity, so a plain
            // link behaves exactly as it did before apps existed (out of scope
            // for #380). For an app `isApp` settles it without needing to know
            // — including the guard's 302, which lands on a url we never asked
            // for and is otherwise indistinguishable from a tap.
            guard MiniApp.isMemberNavigation(
                committed: s, isApp: isApp, isOwnLoad: false, lastLoaded: lastLoaded
            ) else {
                // Still remember where the load landed, so a later update
                // carrying that url doesn't re-request it.
                lastLoaded = s
                return
            }
            lastLoaded = s
            onNavigate(s)
        }

        static func samePage(_ a: String?, _ b: String?) -> Bool { sameArtifactPage(a, b) }
    }
}

// MARK: - Share plumbing

private struct ArtifactShareFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

private struct ArtifactActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

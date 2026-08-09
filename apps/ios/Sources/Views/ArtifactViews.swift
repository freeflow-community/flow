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
/// Read-only this round: no pin-as-artifact, and link artifacts open in Safari
/// rather than a co-browsing mini-browser (a stray tap on a phone would
/// re-point the artifact for everyone). See CHANGELOG Parity.

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
/// editable address bar over a live web view of the pinned page. Any navigation
/// — typing a URL or tapping a link — PATCHes the artifact, so the server
/// re-points it and every member's viewer follows. Remote changes load here in
/// turn. Anything less and a link artifact is just a shared link (operator's
/// call, 2026-07-30 — see decision_log).
private struct ArtifactLinkPane: View {
    let artifact: Artifact
    @EnvironmentObject private var app: AppState
    @Environment(\.openURL) private var openURL
    @State private var draft: String = ""
    /// Bumped when the address bar is submitted with the url already showing:
    /// nothing changes server-side, so this is what makes it a reload.
    @State private var reloadToken: Int = 0

    private var url: String { artifact.url ?? "" }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
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
                        openURL(u)
                    } label: {
                        Image(systemName: "safari")
                    }
                    .accessibilityIdentifier("artifact.link.open")
                    .accessibilityLabel("Open in Safari")
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            Rectangle().fill(MC.hairline).frame(height: 1)
            CoBrowserWebView(url: url, reloadToken: reloadToken, onNavigate: broadcast)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { draft = url }
        // Follow the shared url when it changes remotely (or via our own echo).
        .onChange(of: url) { _, now in draft = now }
        // Without `.contain`, the container's identifier overwrites every
        // child's — including the address field's and the Safari button's.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("artifact.link.\(artifact.name)")
    }

    /// Normalize an address-bar entry (add a scheme to a bare host) and broadcast.
    private func navigate(to raw: String) {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return }
        let withScheme = s.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil
            ? s : "https://\(s)"
        guard URL(string: withScheme) != nil else { draft = url; return }
        // Submitting the url already showing means "reload", not "no-op" — and
        // it also pulls the view back to the shared url after in-page browsing.
        if sameArtifactPage(withScheme, url) { reloadToken += 1; draft = url; return }
        broadcast(withScheme)
    }

    private func broadcast(_ next: String) {
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

/// Renders the shared url and reports navigations back — the UIKit half of the
/// macOS `CoBrowserWebView`, same coordinator logic. It loads a new url only
/// when it differs from what's already showing, so our own committed
/// navigations (which echo back through `url`) never reload.
private struct CoBrowserWebView: UIViewRepresentable {
    let url: String
    /// Any change forces a fresh load of `url`, even when it's already showing.
    let reloadToken: Int
    let onNavigate: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onNavigate: onNavigate) }

    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        context.coordinator.lastReloadToken = reloadToken
        if let u = URL(string: url) {
            context.coordinator.lastLoaded = url
            view.load(URLRequest(url: u))
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onNavigate = onNavigate
        guard let u = URL(string: url) else { return }
        if context.coordinator.lastReloadToken != reloadToken {
            context.coordinator.lastReloadToken = reloadToken
            context.coordinator.lastLoaded = url
            view.load(URLRequest(url: u))
            return
        }
        // Load only genuine remote changes: skip when the view already shows
        // this url or we just loaded/committed it (prevents feedback loops).
        let current = view.url?.absoluteString
        if !Coordinator.samePage(current, url), !Coordinator.samePage(context.coordinator.lastLoaded, url) {
            context.coordinator.lastLoaded = url
            view.load(URLRequest(url: u))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onNavigate: (String) -> Void
        var lastLoaded: String?
        var lastReloadToken = 0

        init(onNavigate: @escaping (String) -> Void) { self.onNavigate = onNavigate }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            guard let s = webView.url?.absoluteString else { return }
            // Ignore the programmatic load we issued for the current shared url;
            // report only user-driven navigations (link taps, form submits).
            if Self.samePage(s, lastLoaded) { return }
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

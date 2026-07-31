import AVKit
import PDFKit
import QuickLook
import SwiftUI
import UIKit
import WebKit

/// iOS artifacts UI (#157). A phone has no room for the macOS/web shape —
/// nested sidebar rows plus a persistent side panel — so the channel header
/// carries the whole affordance: a Docs button with a count badge, a dropdown
/// of that channel's artifacts, and a full-screen viewer sheet.
///
/// Read-only this round: no pin-as-artifact, and link artifacts open in Safari
/// rather than a co-browsing mini-browser (a stray tap on a phone would
/// re-point the artifact for everyone). See CHANGELOG Parity.

// MARK: - Header button

/// The Docs button: a dropdown of the channel's artifacts, badged with how many
/// there are. Always present, so the affordance is discoverable in an empty
/// channel too; the badge appears only when there's something to count.
struct ArtifactsMenuButton: View {
    let channelId: String
    @EnvironmentObject private var app: AppState

    private var artifacts: [Artifact] { app.artifacts(inChannel: channelId) }

    var body: some View {
        Menu {
            if artifacts.isEmpty {
                Text("No documents yet")
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
            // The badge sits *inside* the label's own bounds (padding, not a
            // negative offset) — a toolbar item clips anything hanging past its
            // frame, which lops the corner off the count.
            Image(systemName: "doc.text")
                .padding(.trailing, artifacts.isEmpty ? 0 : 11)
                .padding(.top, artifacts.isEmpty ? 0 : 6)
                .overlay(alignment: .topTrailing) { badge }
        }
        .accessibilityIdentifier("channel.docs")
        .accessibilityLabel("Documents")
        // The count is the thing worth asserting, and VoiceOver should read it
        // rather than leave the badge as decoration.
        .accessibilityValue("\(artifacts.count)")
    }

    @ViewBuilder
    private var badge: some View {
        if !artifacts.isEmpty {
            Text(artifacts.count > 99 ? "99+" : "\(artifacts.count)")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(Capsule().fill(MC.accent))
                .fixedSize()
                .accessibilityHidden(true)
                .accessibilityIdentifier("channel.docs.badge")
        }
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
            .navigationTitle(artifact?.name ?? "Document")
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

/// Pinch-to-zoom is what a phone expects of a full-screen image, and a
/// `ScrollView` with `magnificationGesture` is more code than it's worth —
/// `.scaledToFit` in a zoomable scroll view is what UIKit gives for free.
private struct ArtifactImagePane: View {
    let file: FileAttachment

    var body: some View {
        Group {
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

/// Link artifacts, read-only. The macOS/web co-browsing mini-browser broadcasts
/// every navigation to all viewers; doing that from a phone means a stray tap
/// re-points the artifact under everyone else, so iOS opens the page in Safari
/// instead and leaves the shared url alone. See CHANGELOG Parity.
private struct ArtifactLinkPane: View {
    let artifact: Artifact
    @Environment(\.openURL) private var openURL

    private var url: URL? { artifact.url.flatMap(URL.init(string:)) }

    var body: some View {
        VStack(spacing: 12) {
            Text("🔗").font(.system(size: 40))
            Text(artifact.url ?? "")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(MC.inkSoft)
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .textSelection(.enabled)
            if let url {
                Button("Open in Safari") { openURL(url) }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("artifact.link.open")
            }
            Text("Co-browsing is Mac and web only — opening it here won't move anyone else's view.")
                .font(.caption2)
                .foregroundStyle(MC.faint)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // `.contain` or the container's identifier overwrites every child's —
        // including the Safari button's, which is the one worth asserting.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("artifact.link.\(artifact.name)")
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
